/**
 * Stage 1 — Feature Extraction.
 *
 * Input: product description.
 * Output: 5–25 claim-relevant Features, OR a needsClarification signal.
 *
 * One Gemini Flash call. Cost tracking populated.
 */

import {
  Feature,
  FeatureCategory,
  FtoCostTracking,
  FtoRunInput,
  ProgressCallback,
} from "./types";
import { callGeminiJson, estimateFlashCostUsd } from "./geminiClient";
import { stage1FeatureExtractionPrompt } from "./prompts";

interface Stage1RawFeature {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  searchTerms?: string[];
  claimRelevant?: boolean;
}

interface Stage1RawResponse {
  needsClarification?: { reason?: string; followUps?: string[] };
  features?: Stage1RawFeature[];
}

export interface Stage1Result {
  features: Feature[];
  needsClarification?: { reason: string; followUps: string[] };
}

const VALID_CATEGORIES: ReadonlySet<FeatureCategory> = new Set([
  "physical",
  "process",
  "material",
  "configuration",
  "software",
]);

function isCategory(s: unknown): s is FeatureCategory {
  return typeof s === "string" && VALID_CATEGORIES.has(s as FeatureCategory);
}

function sanitizeFeature(
  raw: Stage1RawFeature,
  index: number
): Feature | null {
  if (!raw.name || !raw.description) return null;
  if (!isCategory(raw.category)) return null;
  if (!Array.isArray(raw.searchTerms) || raw.searchTerms.length === 0) return null;

  const searchTerms = raw.searchTerms
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());
  if (searchTerms.length === 0) return null;

  return {
    id: raw.id && /^f\d+$/.test(raw.id) ? raw.id : `f${index + 1}`,
    name: raw.name.trim(),
    description: raw.description.trim(),
    category: raw.category,
    searchTerms,
    claimRelevant: raw.claimRelevant !== false,
  };
}

export async function runStage1FeatureExtraction(
  input: FtoRunInput,
  cost: FtoCostTracking,
  onProgress: ProgressCallback
): Promise<Stage1Result> {
  onProgress("stage1", "Extracting product features…");

  const prompt = stage1FeatureExtractionPrompt(input.productDescription);
  const result = await callGeminiJson<Stage1RawResponse>({
    prompt,
    label: "stage1",
    temperature: 0.3,
    maxOutputTokens: 4096,
  });

  cost.geminiCalls += 1;
  cost.inputTokens += result.inputTokens;
  cost.outputTokens += result.outputTokens;
  cost.estimatedCostUsd += estimateFlashCostUsd(
    result.inputTokens,
    result.outputTokens
  );

  if (result.parsed.needsClarification) {
    const nc = result.parsed.needsClarification;
    onProgress("stage1", "Description too vague — clarification required.");
    return {
      features: [],
      needsClarification: {
        reason: nc.reason || "Product description was insufficient.",
        followUps: nc.followUps || [],
      },
    };
  }

  const raw = result.parsed.features || [];
  const sanitized = raw
    .map((r, i) => sanitizeFeature(r, i))
    .filter((f): f is Feature => f !== null);

  const claimRelevant = sanitized.filter((f) => f.claimRelevant);

  onProgress(
    "stage1",
    `Extracted ${claimRelevant.length} claim-relevant features (${sanitized.length - claimRelevant.length} filtered as too generic)`
  );

  return { features: claimRelevant };
}
