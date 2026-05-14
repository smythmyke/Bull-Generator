/**
 * Shared Gemini client for FTO stages.
 *
 * Wraps GoogleGenerativeAI with:
 *   - JSON-mode response
 *   - Retry once at higher token cap on JSON parse failure
 *     (same pattern just shipped for patentDossier.generateSummary)
 *   - Token-count reporting for the FTO cost tracker
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_RETRY_MAX_TOKENS = 6144;

export interface GeminiJsonCallOptions {
  prompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  retryMaxTokens?: number;
  label?: string;
}

export interface GeminiJsonCallResult<T> {
  parsed: T;
  inputTokens: number;
  outputTokens: number;
  retried: boolean;
  rawText: string;
}

function getApiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY not set in environment");
  return k;
}

export async function callGeminiJson<T = unknown>(
  opts: GeminiJsonCallOptions
): Promise<GeminiJsonCallResult<T>> {
  const apiKey = getApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: opts.model || DEFAULT_MODEL,
  });

  const callOnce = async (maxOutputTokens: number) => {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        maxOutputTokens,
        responseMimeType: "application/json",
      },
    });
    const text = result.response.text();
    const usage = result.response.usageMetadata;
    return {
      text,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
    };
  };

  const firstCap = opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const retryCap = opts.retryMaxTokens ?? DEFAULT_RETRY_MAX_TOKENS;

  let { text, inputTokens, outputTokens } = await callOnce(firstCap);
  let retried = false;
  let parsed: T;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn(
      `[gemini${opts.label ? `/${opts.label}` : ""}] JSON parse failed at ${firstCap} tokens, retrying at ${retryCap}. Preview: ${text.slice(0, 120)}`
    );
    retried = true;
    const retry = await callOnce(retryCap);
    text = retry.text;
    inputTokens += retry.inputTokens;
    outputTokens += retry.outputTokens;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Gemini returned non-JSON after retry: ${text.slice(0, 200)}`
      );
    }
  }

  return { parsed, inputTokens, outputTokens, retried, rawText: text };
}

// Rough cost calc (Gemini 2.5 Flash pricing as of 2026-05-13)
const FLASH_INPUT_USD_PER_1M = 0.075;
const FLASH_OUTPUT_USD_PER_1M = 0.30;

export function estimateFlashCostUsd(
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens * FLASH_INPUT_USD_PER_1M) / 1_000_000 +
    (outputTokens * FLASH_OUTPUT_USD_PER_1M) / 1_000_000
  );
}
