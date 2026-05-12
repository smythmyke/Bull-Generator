/**
 * Claim Chart endpoint — POST /claim-chart
 *
 * Per-claim element decomposition + mapping to examiner-cited art from the
 * Office Action analyzer. Reuses cached dossier claims + lifted OA analyses
 * already on the client. Free, bundled with dossier; 24h cache keyed by
 * (patentNumber + sorted analyzed-OA doc IDs).
 */

import * as admin from "firebase-admin";
import {GoogleGenerativeAI} from "@google/generative-ai";
import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────

interface DossierClaim {
  number: number;
  text: string;
  isIndependent: boolean;
  dependsOn?: number;
}

type RejectionStatute = "102" | "103" | "112" | "101" | "double-patenting" | "other";

interface OaRejection {
  statute: RejectionStatute;
  claimsAffected: string;
  citedReferences: string[];
  reasoning: string;
}

interface OaCitedArt {
  patentNumber: string;
  shortName?: string;
}

interface OaAnalysisInput {
  documentId: string;
  mailDate?: string;
  rejections: OaRejection[];
  citedArt: OaCitedArt[];
}

export interface ClaimChartReference {
  patentNumber: string;            // examiner shorthand OK ("Smith") if no pub#
  rejectionStatute: RejectionStatute;
  examinerReasoning: string;       // verbatim slice from OA
  oaDocumentId?: string;
  oaMailDate?: string;
}

export interface ClaimChartElement {
  label: string;          // "1.a", "1.b" …
  text: string;           // verbatim element text from the claim
  citedReferences: ClaimChartReference[];
}

export type ClaimStatus = "allowed" | "rejected" | "pending" | "unknown";

export interface ClaimChartItem {
  claimNumber: number;
  isIndependent: boolean;
  dependsOn?: number;
  elements: ClaimChartElement[];   // empty for dependents (inherit from parent in UI)
  status: ClaimStatus;
  statusReasoning: string;         // 1-2 sentences synthesized from OA history
  generationError?: string;        // populated if Gemini failed for this claim
}

export interface ClaimChart {
  patentNumber: string;
  generatedAt: string;
  cached: boolean;
  claimCharts: ClaimChartItem[];
  analyzedOaCount: number;
}

export interface ClaimChartRequest {
  patentNumber?: string;
  claims?: DossierClaim[];
  oaAnalyses?: OaAnalysisInput[];
}

export interface ClaimChartResult {
  chart?: ClaimChart;
  error?: string;
  code?: "invalid_input" | "ai_failed";
}

// ── Cache ─────────────────────────────────────────────────────────────────

const CACHE_COLLECTION = "claimChartCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(patentNumber: string, oaDocIds: string[]): string {
  const sortedIds = [...oaDocIds].sort().join(",");
  const hash = crypto.createHash("sha256").update(sortedIds).digest("hex").slice(0, 12);
  return `${patentNumber}:${hash}`;
}

async function readCache(
  db: admin.firestore.Firestore,
  key: string
): Promise<ClaimChart | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return {...(data.chart as ClaimChart), cached: true};
}

async function writeCache(
  db: admin.firestore.Firestore,
  key: string,
  chart: ClaimChart
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(key).set({
    chart,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Gemini prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a patent prosecution analyst building a claim chart for a granted US patent.

You will be given:
1. The text of ONE independent claim.
2. Office Action history for the application — rejections raised by the examiner against this specific claim, with their cited references and reasoning.

Your job: decompose the claim into discrete elements (preamble + body parts) and, for each element, identify which cited references from the OA history the examiner mapped to it.

Return STRICT JSON matching exactly this schema (no markdown, no prose outside the JSON):

{
  "elements": [
    {
      "label": "1.pre" | "1.a" | "1.b" | ...   — preamble = ".pre", body parts in lower-case alphabetical order,
      "text": "verbatim element text from the claim",
      "citedReferences": [
        {
          "patentNumber": "string — pub# (e.g. US7123456) OR examiner shorthand (e.g. Smith) if no pub# was extracted",
          "rejectionStatute": "102 | 103 | 112 | 101 | double-patenting | other",
          "examinerReasoning": "string — 1-2 sentences, verbatim from the OA reasoning, explaining WHY this reference reads on THIS element"
        }
      ]
    }
  ],
  "status": "allowed | rejected | pending | unknown",
  "statusReasoning": "string — 1-2 sentences synthesizing the prosecution status from the OAs: how many rejections, on what grounds, whether the claim ultimately issued"
}

Rules:
- Element decomposition: split at conventional boundaries (preamble, "comprising:", "wherein", semicolons separating limitations). Aim for 3-8 elements per claim. Do not over-fragment.
- citedReferences may be empty for elements the OAs did not specifically target.
- examinerReasoning must come from the supplied OA reasoning text. Do NOT invent reasoning.
- If no OA history is supplied, set status to "allowed" (assume issued without rejection) and leave citedReferences empty for every element.
- If OA history shows §102/§103 rejections that were addressed (later docs show allowance), set status to "allowed" but still populate citedReferences from the historical rejections — they're informative.
- patentNumber values come ONLY from the supplied citedReferences / citedArt lists. Never invent a patent number.`;

interface AiResponse {
  elements?: Array<{
    label?: string;
    text?: string;
    citedReferences?: Array<{
      patentNumber?: string;
      rejectionStatute?: string;
      examinerReasoning?: string;
    }>;
  }>;
  status?: string;
  statusReasoning?: string;
}

function normalizeStatute(raw?: string): RejectionStatute {
  const v = (raw || "").toLowerCase().trim();
  if (v === "102" || v === "103" || v === "112" || v === "101" || v === "double-patenting") {
    return v;
  }
  return "other";
}

function normalizeStatus(raw?: string): ClaimStatus {
  const v = (raw || "").toLowerCase().trim();
  if (v === "allowed" || v === "rejected" || v === "pending" || v === "unknown") {
    return v;
  }
  return "unknown";
}

function buildClaimPrompt(
  claim: DossierClaim,
  oaAnalyses: OaAnalysisInput[]
): string {
  const claimNum = claim.number;

  const relevantRejections: string[] = [];
  for (const analysis of oaAnalyses) {
    for (const rejection of analysis.rejections) {
      // claimsAffected can be "1, 5-7, 9" — naive contains check is good enough
      // since we also re-check by number in the LLM step
      const affected = rejection.claimsAffected || "";
      if (claimNumberInList(claimNum, affected)) {
        relevantRejections.push(
          `OA ${analysis.documentId}${analysis.mailDate ? ` (${analysis.mailDate})` : ""}:\n` +
          `  §${rejection.statute} — claims: ${rejection.claimsAffected}\n` +
          `  Cited refs: ${rejection.citedReferences.join(", ") || "(none extracted)"}\n` +
          `  Reasoning: ${rejection.reasoning}`
        );
      }
    }
  }

  const oaSection = relevantRejections.length === 0
    ? "(No Office Action rejections target this claim — assume allowed or pre-allowance.)"
    : relevantRejections.join("\n\n");

  return `INDEPENDENT CLAIM ${claimNum}:
${claim.text}

OFFICE ACTION HISTORY (rejections targeting claim ${claimNum} only):
${oaSection}`;
}

function claimNumberInList(num: number, list: string): boolean {
  // Parse "1, 5-7, 9" style lists
  const parts = list.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map((s) => parseInt(s.trim(), 10));
      if (!isNaN(lo) && !isNaN(hi) && num >= lo && num <= hi) return true;
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n) && n === num) return true;
    }
  }
  return false;
}

async function chartOneClaim(
  claim: DossierClaim,
  oaAnalyses: OaAnalysisInput[],
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>
): Promise<ClaimChartItem> {
  try {
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{text: SYSTEM_PROMPT + "\n\n" + buildClaimPrompt(claim, oaAnalyses)}],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const text = result.response.text();
    let parsed: AiResponse;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Non-JSON response: ${text.slice(0, 150)}`);
    }

    const elements: ClaimChartElement[] = (parsed.elements || []).map((el, idx) => ({
      label: (el.label || `${claim.number}.${String.fromCharCode(97 + idx)}`).trim(),
      text: (el.text || "").trim(),
      citedReferences: (el.citedReferences || []).map((ref) => ({
        patentNumber: (ref.patentNumber || "").trim(),
        rejectionStatute: normalizeStatute(ref.rejectionStatute),
        examinerReasoning: (ref.examinerReasoning || "").trim(),
      })).filter((r) => r.patentNumber && r.examinerReasoning),
    })).filter((el) => el.text);

    return {
      claimNumber: claim.number,
      isIndependent: true,
      elements,
      status: normalizeStatus(parsed.status),
      statusReasoning: (parsed.statusReasoning || "").trim(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      claimNumber: claim.number,
      isIndependent: true,
      elements: [],
      status: "unknown",
      statusReasoning: "",
      generationError: message,
    };
  }
}

// Run up to N claim-decomposition calls in parallel
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleClaimChartRequest(
  body: ClaimChartRequest
): Promise<ClaimChartResult> {
  const patentNumber = (body.patentNumber || "").trim();
  const claims = Array.isArray(body.claims) ? body.claims : [];
  const oaAnalyses = Array.isArray(body.oaAnalyses) ? body.oaAnalyses : [];

  if (!patentNumber || claims.length === 0) {
    return {error: "Missing patentNumber or claims", code: "invalid_input"};
  }

  const db = admin.firestore();
  const key = cacheKey(patentNumber, oaAnalyses.map((a) => a.documentId));

  const cached = await readCache(db, key);
  if (cached) return {chart: cached};

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {error: "AI service not configured", code: "ai_failed"};
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({model: "gemini-2.5-flash"});

  const independents = claims.filter((c) => c.isIndependent);

  const independentCharts = await runWithConcurrency(
    independents,
    5,
    (claim) => chartOneClaim(claim, oaAnalyses, model)
  );

  // Dependents inherit from their parent in the UI; we still return them as
  // stubs so the UI can render the tree without separate state.
  const dependents: ClaimChartItem[] = claims
    .filter((c) => !c.isIndependent)
    .map((c) => ({
      claimNumber: c.number,
      isIndependent: false,
      dependsOn: c.dependsOn,
      elements: [],
      status: "unknown",
      statusReasoning: "",
    }));

  const all = [...independentCharts, ...dependents].sort(
    (a, b) => a.claimNumber - b.claimNumber
  );

  const chart: ClaimChart = {
    patentNumber,
    generatedAt: new Date().toISOString(),
    cached: false,
    claimCharts: all,
    analyzedOaCount: oaAnalyses.length,
  };

  writeCache(db, key, chart).catch((e) => {
    console.warn(`[ClaimChart] Cache write failed for ${key}:`, e);
  });

  return {chart};
}
