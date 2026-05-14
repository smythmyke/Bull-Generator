/**
 * Central registry of Gemini prompts for the FTO pipeline.
 *
 * Kept in one file so the examiner-led prompt iteration in Phase 0 has
 * a single place to review and tune. Stages call these functions to
 * assemble final prompt text from runtime inputs.
 */

export function stage1FeatureExtractionPrompt(productDescription: string): string {
  return `You are a senior patent examiner with 10+ years at the USPTO. Your task is to decompose a product description into technical features that a patent claim might cover, so a downstream Freedom-to-Operate search can find potentially-infringing active patents.

PRODUCT DESCRIPTION:
"""
${productDescription}
"""

GUIDANCE
- Aim for 5 to 25 distinct features. Fewer is fine for simple products; more for complex.
- Favor technical specificity over marketing language. "capacitive proximity sensor in housing wall" — yes. "smart sensing" — no.
- Each feature should be searchable: terms that would actually surface relevant patents in a USPTO/Google Patents search.
- Prefer features grounded in physical structure, process steps, material composition, configuration choices, or software algorithms. Skip features that are:
  • Generic to any product in the category (every device has a "housing"; every wearable has a "battery")
  • Marketing claims ("eco-friendly", "ergonomic")
  • Pure public domain ("rectangular shape", "plastic case")
  • Stated as benefits rather than mechanisms ("easier to use", "lighter weight")

FOR EACH FEATURE, RETURN:
- id: string in form "f1", "f2", ... sequential
- name: 2–5 word identifier (e.g., "capacitive hydration sensor")
- description: 1–2 sentence technical description focused on mechanism, not benefit
- category: exactly one of "physical" | "process" | "material" | "configuration" | "software"
- searchTerms: array of 3–6 plain search terms; include common synonyms; do NOT include boolean operators or quotes
- claimRelevant: true if a patent claim could conceivably cover this; false only if you included the feature for context but it would not survive a search-recall filter

VAGUE-INPUT HANDLING
If the description is too vague to identify any claim-relevant features (e.g., "a better water bottle", "an AI tool"), return:
{
  "needsClarification": true,
  "reason": "<one sentence explaining what's missing>",
  "followUps": [3 to 5 specific questions that would unblock]
}

OTHERWISE RETURN:
{
  "features": [ {...}, {...} ]
}

Return ONLY valid JSON. No markdown code fences. No preamble. No commentary after.`;
}
