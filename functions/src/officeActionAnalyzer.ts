/**
 * Office Action Analyzer.
 *
 * Given a USPTO file-wrapper document ID for an Office Action (CTNF/CTFR/CTAV/CTRS),
 * fetches the PDF via the ODP proxy, extracts text, and asks Gemini to produce a
 * structured analysis: rejections by statute, cited art, examiner reasoning,
 * and suggested response arguments.
 *
 * Endpoint: POST /oa-analyze
 *   body: { applicationNumber: string, documentId: string }
 *   credits: 1 per fresh analysis; 0 on cache hit (30-day TTL)
 *   auth: Bearer (verified in index.ts)
 */

import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { handleOdpDocumentRequest, normalizeApplicationNumber } from "./usptoOdp";

// ── Types ──────────────────────────────────────────────────────────────

export type RejectionStatute =
  | "102" | "103" | "112" | "101" | "double-patenting" | "other";

export interface OaRejection {
  statute: RejectionStatute;
  claimsAffected: string;     // e.g. "1, 5-7, 9"
  citedReferences: string[];  // patent numbers or examiner shortnames
  reasoning: string;          // examiner's stated rationale
}

export interface OaCitedArt {
  patentNumber: string;       // may be inventor surname if number not extracted
  shortName?: string;         // examiner shorthand, e.g. "Smith"
}

export interface OfficeActionAnalysis {
  applicationNumber: string;
  documentId: string;
  examinerName?: string;
  artUnit?: string;
  mailDate?: string;
  summary: string;
  rejections: OaRejection[];
  citedArt: OaCitedArt[];
  suggestedArguments: string;
  generatedAt: string;
  cached: boolean;
}

export interface OaAnalysisRequest {
  applicationNumber?: string;
  documentId?: string;
}

export type OaAnalysisErrorCode =
  | "invalid_input"
  | "not_found"
  | "fetch_failed"
  | "no_api_key"
  | "ai_failed";

export interface OaQuotaState {
  analysesUsed: number;   // distinct OA docIds analyzed for this (user, application)
  freeQuota: number;      // free analyses included per application
}

export interface OaAnalysisResult {
  analysis?: OfficeActionAnalysis;
  quota?: OaQuotaState;
  billed?: boolean;       // true when this call should deduct 1 credit
  error?: string;
  code?: OaAnalysisErrorCode;
}

// ── Quota tracking ─────────────────────────────────────────────────────

const FREE_OA_QUOTA = 5;
const QUOTA_COLLECTION = "oaAnalysisQuota";

function quotaDocId(userId: string, appNumber: string): string {
  return `${userId}_${appNumber}`;
}

async function readQuota(
  db: admin.firestore.Firestore,
  userId: string,
  appNumber: string
): Promise<{ analyzedDocIds: string[] }> {
  const snap = await db.collection(QUOTA_COLLECTION).doc(quotaDocId(userId, appNumber)).get();
  if (!snap.exists) return { analyzedDocIds: [] };
  const data = snap.data();
  return { analyzedDocIds: (data?.analyzedDocIds as string[]) || [] };
}

async function recordQuotaUsage(
  db: admin.firestore.Firestore,
  userId: string,
  appNumber: string,
  docId: string
): Promise<void> {
  await db.collection(QUOTA_COLLECTION).doc(quotaDocId(userId, appNumber)).set({
    userId,
    applicationNumber: appNumber,
    analyzedDocIds: admin.firestore.FieldValue.arrayUnion(docId),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ── Cache layer ────────────────────────────────────────────────────────

const CACHE_COLLECTION = "officeActionAnalysisCache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;

function cacheKey(appNumber: string, docId: string): string {
  return `${appNumber}_${docId}`;
}

async function readCache(
  db: admin.firestore.Firestore,
  key: string
): Promise<OfficeActionAnalysis | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (data.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.analysis as OfficeActionAnalysis), cached: true };
}

async function writeCache(
  db: admin.firestore.Firestore,
  key: string,
  analysis: OfficeActionAnalysis
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(key).set({
    analysis,
    schemaVersion: CACHE_SCHEMA_VERSION,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Gemini prompt ──────────────────────────────────────────────────────

const ANALYZER_SYSTEM_PROMPT = `You are a US patent prosecution analyst. The attached PDF is a USPTO Office Action (or restriction requirement). Read it directly — many USPTO PDFs are scanned images, so rely on visual OCR if needed. Then extract a structured analysis.

Return a STRICT JSON object matching exactly this schema:

{
  "examinerName": "string | null — name of the examiner who signed the OA, or null if not present",
  "artUnit": "string | null — 4-digit art unit number, or null",
  "mailDate": "string | null — mail date in YYYY-MM-DD, or null",
  "summary": "string — 2 to 3 short paragraphs of plain-English overview: what got rejected, on what grounds, key references. No legal jargon. No 'this Office Action' boilerplate.",
  "rejections": [
    {
      "statute": "102 | 103 | 112 | 101 | double-patenting | other",
      "claimsAffected": "string — claim numbers/ranges as shown in the OA, e.g. '1, 5-7, 9'",
      "citedReferences": ["string", ...] — patent numbers or examiner shortnames (e.g., 'Smith') referenced FOR THIS REJECTION specifically,
      "reasoning": "string — 1 to 3 sentences capturing the examiner's stated rationale for this rejection"
    }
  ],
  "citedArt": [
    {
      "patentNumber": "string — patent number if extracted (e.g., 'US 7,123,456'); otherwise the inventor surname the examiner uses",
      "shortName": "string | optional — examiner's shorthand reference like 'Smith'"
    }
  ],
  "suggestedArguments": "string — 1 short paragraph of practical response strategies a prosecutor might consider (claim amendments, distinguishing features, missing elements in the cited art). General prosecution-savvy suggestions, not legal advice."
}

Rules:
- Return ONLY the JSON object. No markdown fences. No prose before or after.
- If the OA contains only a restriction requirement (no substantive rejections), set rejections=[] and put the restriction summary in "summary".
- statute "double-patenting" covers both nonstatutory and statutory double patenting.
- statute "other" covers § 132 informalities, § 251 reissue, § 305 reexam, and anything not in the enumerated list.
- citedArt should be deduplicated across all rejections — list each cited reference exactly once at the top level.
- Be conservative: only extract facts present in the text. Never invent a claim number, statute, or reference.`;

interface RawAiAnalysis {
  examinerName?: string | null;
  artUnit?: string | null;
  mailDate?: string | null;
  summary?: string;
  rejections?: {
    statute?: string;
    claimsAffected?: string;
    citedReferences?: string[];
    reasoning?: string;
  }[];
  citedArt?: { patentNumber?: string; shortName?: string }[];
  suggestedArguments?: string;
}

function normalizeStatute(raw?: string): RejectionStatute {
  const v = (raw || "").toLowerCase().trim();
  if (v === "102" || v === "103" || v === "112" || v === "101") return v;
  if (v.includes("double")) return "double-patenting";
  return "other";
}

function normalizeAnalysis(
  raw: RawAiAnalysis,
  appNumber: string,
  docId: string
): OfficeActionAnalysis {
  const rejections: OaRejection[] = (raw.rejections || []).map((r) => ({
    statute: normalizeStatute(r.statute),
    claimsAffected: (r.claimsAffected || "").trim(),
    citedReferences: Array.isArray(r.citedReferences)
      ? r.citedReferences.map((s) => String(s).trim()).filter(Boolean)
      : [],
    reasoning: (r.reasoning || "").trim(),
  }));

  const citedArt: OaCitedArt[] = (raw.citedArt || [])
    .map((c) => ({
      patentNumber: (c.patentNumber || "").trim(),
      ...(c.shortName ? { shortName: c.shortName.trim() } : {}),
    }))
    .filter((c) => c.patentNumber.length > 0);

  return {
    applicationNumber: appNumber,
    documentId: docId,
    ...(raw.examinerName ? { examinerName: raw.examinerName } : {}),
    ...(raw.artUnit ? { artUnit: String(raw.artUnit) } : {}),
    ...(raw.mailDate ? { mailDate: raw.mailDate } : {}),
    summary: (raw.summary || "").trim(),
    rejections,
    citedArt,
    suggestedArguments: (raw.suggestedArguments || "").trim(),
    generatedAt: new Date().toISOString(),
    cached: false,
  };
}

async function runAnalyzer(
  pdfBuffer: Buffer,
  appNumber: string,
  docId: string
): Promise<OfficeActionAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [
        { text: ANALYZER_SYSTEM_PROMPT },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: pdfBuffer.toString("base64"),
          },
        },
      ],
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  const responseText = result.response.text();
  let parsed: RawAiAnalysis;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${responseText.slice(0, 200)}`);
  }
  if (!parsed.summary) {
    throw new Error("Gemini response missing required 'summary' field");
  }

  return normalizeAnalysis(parsed, appNumber, docId);
}

// ── Request handler ────────────────────────────────────────────────────

export async function handleOfficeActionAnalysisRequest(
  body: OaAnalysisRequest,
  userId: string
): Promise<OaAnalysisResult> {
  const appNumber = normalizeApplicationNumber(body.applicationNumber || "");
  const docId = (body.documentId || "").trim();
  if (!appNumber || appNumber.length < 6 || !docId || !/^[A-Za-z0-9_-]+$/.test(docId)) {
    return { error: "Invalid applicationNumber or documentId", code: "invalid_input" };
  }

  const db = admin.firestore();
  const key = cacheKey(appNumber, docId);

  // Pull quota state up-front so we can return current numbers regardless of
  // which code path runs (cache hit, free analysis, billed analysis).
  const quotaSnap = await readQuota(db, userId, appNumber);
  const previouslyAnalyzed = quotaSnap.analyzedDocIds.includes(docId);

  // Cache hit: free, no quota change. Surface current quota state for UI.
  const cached = await readCache(db, key);
  if (cached) {
    return {
      analysis: cached,
      quota: { analysesUsed: quotaSnap.analyzedDocIds.length, freeQuota: FREE_OA_QUOTA },
      billed: false,
    };
  }

  // Fetch the PDF via our existing ODP proxy logic
  const pdfResult = await handleOdpDocumentRequest({
    applicationNumber: appNumber,
    documentId: docId,
  });
  if (pdfResult.error || !pdfResult.buffer) {
    return {
      error: pdfResult.error || "PDF fetch failed",
      code:
        pdfResult.code === "no_api_key" ? "no_api_key" :
        pdfResult.code === "not_found" ? "not_found" :
        "fetch_failed",
    };
  }

  // Send the PDF straight to Gemini — Gemini 2.5 Flash handles both text-mode
  // and scanned/image-only PDFs (does OCR natively), so we skip a separate
  // text-extraction step.
  let analysis: OfficeActionAnalysis;
  try {
    analysis = await runAnalyzer(pdfResult.buffer, appNumber, docId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Analyzer failed: ${message}`, code: "ai_failed" };
  }

  writeCache(db, key, analysis).catch((e) => {
    console.warn(`[OA] Cache write failed for ${key}:`, e);
  });

  // Billing decision: bill 1 credit only when this is a *new* docId for this
  // user+application AND they've already used their 5 free slots. Re-runs of
  // previously analyzed OAs (e.g., cache expired) are always free.
  const newDocId = !previouslyAnalyzed;
  const overQuota = quotaSnap.analyzedDocIds.length >= FREE_OA_QUOTA;
  const billed = newDocId && overQuota;

  if (newDocId) {
    recordQuotaUsage(db, userId, appNumber, docId).catch((e) => {
      console.warn(`[OA] Quota write failed for ${key}:`, e);
    });
  }

  const analysesUsed = newDocId
    ? quotaSnap.analyzedDocIds.length + 1
    : quotaSnap.analyzedDocIds.length;

  return {
    analysis,
    quota: { analysesUsed, freeQuota: FREE_OA_QUOTA },
    billed,
  };
}
