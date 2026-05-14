/**
 * Product-level CPC classification scope.
 *
 * Before Stage 2 runs its N per-feature searches, we extract 3–6 CPC
 * subclass codes that bracket the product's domain. Each Stage 2 search
 * then AND's these onto its per-feature query, so candidate patents are
 * constrained to the relevant classification space.
 *
 * Why subclass level (e.g. "A47G", not "A47G19/22"):
 *   - Broader = preserves recall (FTO favors recall over precision)
 *   - Fewer codes to choose = lower chance of LLM error
 *   - Still tight enough to drop noise hits in unrelated subclasses
 *
 * One Gemini Flash call. Cost: ~1000 input + ~250 output tokens (~$0.0001).
 */

import { FtoCostTracking, ProgressCallback } from "./types";
import { callGeminiJson, estimateFlashCostUsd } from "./geminiClient";

interface RawCpcResponse {
  cpcCodes?: string[];
  reasoning?: string;
}

export interface ProductCpcScope {
  cpcCodes: string[];
  reasoning: string;
}

const CPC_SUBCLASS_RE = /^[A-H]\d{2}[A-Z]$/;

function buildPrompt(productDescription: string): string {
  return `You are a senior patent examiner with 10+ years at the USPTO. Given a product description, identify the 3–6 CPC subclass codes that best constrain a Freedom-to-Operate search to the relevant technical domain.

PRODUCT DESCRIPTION:
"""
${productDescription}
"""

GUIDANCE
- Return CPC SUBCLASS codes only (4 chars: letter + 2 digits + letter), e.g. "A47G", "G01F", "G16H".
- Do NOT return finer groups like "A47G19/22" — subclass breadth is correct for an FTO scope filter.
- Cover the product's primary technical domains. For a smart water bottle: vessel/container art, level/flow measurement art, eHealth/hydration art, and any unique algorithmic art if applicable.
- Be inclusive on borderline domains (3–6 codes). Excluding the right subclass = missed prior art = lawsuit risk. Including a borderline subclass = a little noise.
- Do not include subclasses for clearly tangential aspects (don't include G06F for an app-bearing product unless the app embodies the inventive concept).

OUTPUT FORMAT
{
  "cpcCodes": ["A47G", "G01F", "G16H"],
  "reasoning": "1-2 sentences explaining the selection"
}

Return ONLY valid JSON. No markdown, no preamble.`;
}

export async function extractProductCpcScope(
  productDescription: string,
  cost: FtoCostTracking,
  onProgress: ProgressCallback
): Promise<ProductCpcScope> {
  onProgress("stage1.5", "Identifying CPC classification scope…");

  const result = await callGeminiJson<RawCpcResponse>({
    prompt: buildPrompt(productDescription),
    label: "cpc-scope",
    temperature: 0.2,
    maxOutputTokens: 1024,
  });

  cost.geminiCalls += 1;
  cost.inputTokens += result.inputTokens;
  cost.outputTokens += result.outputTokens;
  cost.estimatedCostUsd += estimateFlashCostUsd(
    result.inputTokens,
    result.outputTokens
  );

  const validCodes = (result.parsed.cpcCodes || [])
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => CPC_SUBCLASS_RE.test(c));

  const uniqueCodes = Array.from(new Set(validCodes));
  const reasoning = (result.parsed.reasoning || "").trim();

  onProgress(
    "stage1.5",
    uniqueCodes.length > 0
      ? `CPC scope: ${uniqueCodes.join(", ")}`
      : "CPC scope: none (search will run unconstrained — recall will suffer)"
  );

  return { cpcCodes: uniqueCodes, reasoning };
}
