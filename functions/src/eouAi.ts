/**
 * EOU-specific AI endpoints: claim decomposition and evidence evaluation.
 *
 * Uses Gemini 2.5 Flash with JSON response mode.
 */

import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ── Types ──

interface ClaimElement {
  element_id: string;
  text: string;
  description: string;
  search_keywords: string[];
}

interface DecomposeResult {
  patent_number: string;
  claim_number: number;
  elements: ClaimElement[];
}

interface EvaluateResult {
  relevance: "strong" | "moderate" | "weak" | "none";
  confidence: number;
  extracted_quote: string;
  explanation: string;
  matching_limitations: string[];
  missing_limitations: string[];
}

// ── Prompts ──

const DECOMPOSE_PROMPT = `You are a patent analyst. Decompose the following patent claim into its discrete elements (limitations).

For each element, provide:
1. "element_id" — A short label like "preamble", "step_a", "step_b", etc.
2. "text" — The exact claim language for this element
3. "description" — A plain-language explanation of what this element means
4. "search_keywords" — An array of search terms useful for finding evidence that a product practices this element. Include technical synonyms, related product features, and specific terms a product page might use.

Return valid JSON in this format:
{
  "patent_number": "...",
  "claim_number": 1,
  "elements": [
    {
      "element_id": "preamble",
      "text": "...",
      "description": "...",
      "search_keywords": ["...", "..."]
    }
  ]
}

Patent Number: {PATENT_NUMBER}
Claim {CLAIM_NUMBER}:
{CLAIM_TEXT}`;

const EVALUATE_PROMPT = `You are a patent infringement analyst evaluating whether a piece of evidence shows that a product practices a specific patent claim element.

Analyze the source text and determine:
1. Whether the source text describes functionality that matches the claim element
2. The specific quote(s) from the source that are most relevant
3. How strong the match is

Return valid JSON in this format:
{
  "relevance": "strong" | "moderate" | "weak" | "none",
  "confidence": 0.0-1.0,
  "extracted_quote": "the exact quote from the source text that best supports the match (empty string if none)",
  "explanation": "2-3 sentences explaining why this is or isn't a match, using patent claim construction principles",
  "matching_limitations": ["which specific words/phrases from the claim element are matched by the evidence"],
  "missing_limitations": ["which specific words/phrases from the claim element are NOT addressed by the evidence"]
}

Scoring guide:
- "strong": The source explicitly describes the exact functionality in the claim element. Clear, unambiguous match.
- "moderate": The source strongly implies the functionality but uses different terminology, or matches most but not all aspects.
- "weak": The source tangentially relates to the claim element, partial match, or vague reference.
- "none": The source does not describe anything related to the claim element.

IMPORTANT: Be conservative. Do not hallucinate matches. If the evidence doesn't clearly support the claim element, score it lower.

Claim Element:
{CLAIM_ELEMENT}

Source (from {SOURCE_URL}, type: {SOURCE_TYPE}):
{SOURCE_TEXT}`;

// ── Helpers ──

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error("Failed to parse AI response as JSON");
  }
}

// ── Handlers ──

export async function handleDecompose(
  body: Record<string, unknown>
): Promise<DecomposeResult> {
  const patentNumber = body.patentNumber as string;
  const claimNumber = body.claimNumber as number;
  const claimText = body.claimText as string;

  if (!claimText || !claimNumber) {
    throw new Error("claimNumber and claimText are required");
  }

  const prompt = DECOMPOSE_PROMPT
    .replace("{PATENT_NUMBER}", patentNumber || "")
    .replace("{CLAIM_NUMBER}", String(claimNumber))
    .replace("{CLAIM_TEXT}", claimText);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = parseJsonResponse(text) as DecomposeResult;

  if (!parsed.elements || !Array.isArray(parsed.elements)) {
    throw new Error("AI response missing elements array");
  }

  console.log(
    `[EOU-AI] Decomposed claim ${claimNumber}: ${parsed.elements.length} elements`
  );

  return {
    patent_number: patentNumber || "",
    claim_number: claimNumber,
    elements: parsed.elements,
  };
}

export async function handleEvaluate(
  body: Record<string, unknown>
): Promise<EvaluateResult> {
  const claimElement = body.claimElement as string;
  const sourceText = body.sourceText as string;
  const sourceUrl = body.sourceUrl as string || "";
  const sourceType = body.sourceType as string || "unknown";

  if (!claimElement || !sourceText) {
    throw new Error("claimElement and sourceText are required");
  }

  const prompt = EVALUATE_PROMPT
    .replace("{CLAIM_ELEMENT}", claimElement)
    .replace("{SOURCE_URL}", sourceUrl)
    .replace("{SOURCE_TYPE}", sourceType)
    .replace("{SOURCE_TEXT}", sourceText.substring(0, 10000));

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = parseJsonResponse(text) as EvaluateResult;

  console.log(
    `[EOU-AI] Evaluated evidence: relevance=${parsed.relevance}, confidence=${parsed.confidence}`
  );

  return parsed;
}
