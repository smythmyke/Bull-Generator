/**
 * CPC suggestion endpoint — POST /cpc-suggest
 *
 * Description text → suggested CPC codes via Gemini Flash over the curated
 * dataset in cpc.ts. Returns top 3-5 candidates with confidence + reasoning.
 *
 * Pricing: 1 credit per call. Cached by description hash for 30 days.
 *
 * Known limit: curated dataset covers ~80 common subclasses + 9 sections.
 * Niche tech (e.g., narrow chemistry, narrow biotech) may not have a good
 * match. Future v1.2 will load the full USPTO CPC scheme.
 */

import * as admin from "firebase-admin";
import {GoogleGenerativeAI} from "@google/generative-ai";
import crypto from "crypto";
import {SECTIONS, SUBCLASSES} from "./cpc";

const CACHE_COLLECTION = "cpcSuggestCache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CpcSuggestion {
  code: string;           // e.g. "H01M" or "G06N"
  title: string;          // human-readable title from the curated dataset
  confidence: "high" | "medium" | "low";
  reasoning: string;      // 1 sentence explaining why this code matches
}

export interface CpcSuggestResult {
  description?: string;
  suggestions?: CpcSuggestion[];
  cached?: boolean;
  notes?: string;
  error?: string;
  code?: "invalid_input" | "ai_failed" | "no_api_key";
}

function descriptionHash(description: string): string {
  return crypto.createHash("sha256")
    .update(description.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

async function readCache(
  db: admin.firestore.Firestore,
  key: string
): Promise<CpcSuggestion[] | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return data.suggestions as CpcSuggestion[];
}

async function writeCache(
  db: admin.firestore.Firestore,
  key: string,
  suggestions: CpcSuggestion[]
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(key).set({
    suggestions,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function buildDatasetSnippet(): string {
  // Compact, model-friendly listing: section header + subclasses under it.
  const bySection: Record<string, string[]> = {};
  for (const [code, title] of Object.entries(SUBCLASSES)) {
    const section = code[0];
    (bySection[section] ||= []).push(`  ${code}: ${title}`);
  }
  const lines: string[] = [];
  for (const [section, sectionTitle] of Object.entries(SECTIONS)) {
    lines.push(`${section} — ${sectionTitle}`);
    if (bySection[section]) {
      lines.push(...bySection[section]);
    }
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a patent classifier. Given a plain-English description of a technology or invention, suggest the best CPC (Cooperative Patent Classification) codes from the dataset below.

DATASET (the ONLY codes you may suggest):

${buildDatasetSnippet()}

Return STRICT JSON matching exactly this schema (no markdown, no prose outside the JSON):

{
  "suggestions": [
    {
      "code": "string — MUST be a code from the dataset above",
      "title": "string — exact title from the dataset",
      "confidence": "high | medium | low",
      "reasoning": "1 sentence explaining why this code matches the described technology"
    }
  ]
}

Rules:
- Return 3 to 5 suggestions, ordered by confidence (highest first).
- ONLY use codes from the dataset. Do not invent codes.
- If the description doesn't match any code in the dataset well, return fewer suggestions (or empty array) with low confidence and mention the gap in reasoning.
- "high" = the code is clearly the primary classification.
- "medium" = the code is plausible but the description spans multiple areas.
- "low" = weak match; included only because nothing better exists in the dataset.`;

interface AiResponse {
  suggestions?: Array<{
    code?: string;
    title?: string;
    confidence?: string;
    reasoning?: string;
  }>;
}

function normalizeConfidence(raw?: string): "high" | "medium" | "low" {
  const v = (raw || "").toLowerCase().trim();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

export async function handleCpcSuggestRequest(
  body: { description?: string }
): Promise<CpcSuggestResult> {
  const description = (body.description || "").trim();
  if (!description || description.length < 5) {
    return {error: "description is required (min 5 characters)", code: "invalid_input"};
  }
  if (description.length > 2000) {
    return {error: "description too long (max 2000 characters)", code: "invalid_input"};
  }

  const db = admin.firestore();
  const key = descriptionHash(description);

  const cached = await readCache(db, key);
  if (cached) {
    return {description, suggestions: cached, cached: true};
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {error: "AI service not configured", code: "no_api_key"};
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {responseMimeType: "application/json"},
  });

  let raw: string;
  try {
    const result = await model.generateContent(description);
    raw = result.response.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[CpcSuggest] Gemini call failed: ${message}`);
    return {error: "AI request failed", code: "ai_failed"};
  }

  let parsed: AiResponse;
  try {
    parsed = JSON.parse(raw) as AiResponse;
  } catch {
    console.warn(`[CpcSuggest] Failed to parse Gemini JSON: ${raw.slice(0, 200)}`);
    return {error: "AI response invalid", code: "ai_failed"};
  }

  const validCodes = new Set(Object.keys(SUBCLASSES));
  const suggestions: CpcSuggestion[] = (parsed.suggestions || [])
    .filter((s): s is { code: string; title?: string; confidence?: string; reasoning?: string } =>
      !!s && typeof s.code === "string" && validCodes.has(s.code))
    .slice(0, 5)
    .map((s) => ({
      code: s.code,
      title: SUBCLASSES[s.code] || s.title || "",
      confidence: normalizeConfidence(s.confidence),
      reasoning: (s.reasoning || "").trim(),
    }));

  writeCache(db, key, suggestions).catch((e) => {
    console.warn(`[CpcSuggest] Cache write failed for ${key}:`, e);
  });

  const notes = suggestions.length === 0
    ? "No good match in the v1.0 curated dataset (~80 subclasses). The full USPTO CPC scheme (planned v1.2) may have a better fit."
    : undefined;

  return {description, suggestions, cached: false, notes};
}
