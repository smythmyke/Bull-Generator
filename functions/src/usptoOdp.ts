/**
 * USPTO Open Data Portal (ODP) integration.
 *
 * Fetches a patent application's file wrapper (prosecution history) from
 * api.uspto.gov and returns a normalized list of documents (Office Actions,
 * IDS, responses, amendments, etc.) for the dossier UI.
 *
 * Endpoint: POST /prosecution-history
 *   body: { applicationNumber: string, filingDate?: string }
 *   auth: Bearer (verified in index.ts)
 *   credits: 0 (free; AI-heavy OA analysis charges in a later slice)
 *
 * Reference: https://data.uspto.gov/apis/patent-file-wrapper/documents
 * Coverage: applications filed on or after 2001-01-01 only.
 */

import * as admin from "firebase-admin";

const ODP_BASE_URL = "https://api.uspto.gov";
const REQUEST_TIMEOUT_MS = 20000;
const COVERAGE_START_DATE = "2001-01-01";

// ── Types ──────────────────────────────────────────────────────────────

export interface FileWrapperDocument {
  documentId: string;
  date: string;                  // YYYY-MM-DD
  code: string;                  // USPTO document code (e.g. "CTNF")
  description: string;           // Human-readable (e.g. "Non-Final Rejection")
  category: DocumentCategory;    // Coarse bucket for filtering
  pdfUrl?: string;
  pages?: number;
}

export type DocumentCategory =
  | "office-action"
  | "response"
  | "ids"
  | "claim-amendment"
  | "notice"
  | "filing"
  | "other";

export interface ProsecutionHistory {
  applicationNumber: string;     // normalized digits-only form
  documentCount: number;
  documents: FileWrapperDocument[];
  fetchedAt: string;
  cached: boolean;
}

export interface ProsecutionHistoryRequest {
  applicationNumber?: string;
  filingDate?: string;           // ISO YYYY-MM-DD; if pre-coverage, we skip the API call
}

export interface ProsecutionHistoryResult {
  history?: ProsecutionHistory;
  error?: string;
  code?:
    | "invalid_number"
    | "out_of_coverage"
    | "not_found"
    | "fetch_failed"
    | "no_api_key";
}

// ── Application number normalization ───────────────────────────────────

/**
 * USPTO ODP expects an 8-digit application number with no separators.
 * Google Patents publishes it as "16/223,104" or similar — strip everything
 * that isn't a digit.
 */
export function normalizeApplicationNumber(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input.replace(/\D/g, "");
}

// ── Document classification ────────────────────────────────────────────

/**
 * Coarse-grained category based on USPTO document codes. Used for filtering
 * and color-coding in the UI. Codes documented at
 * https://www.uspto.gov/patents/docx.
 */
function categorize(code: string): DocumentCategory {
  const c = code.toUpperCase();
  // Office actions: CTNF non-final, CTFR final, CTAV advisory, CTRS restriction
  if (c === "CTNF" || c === "CTFR" || c === "CTAV" || c === "CTRS") {
    return "office-action";
  }
  // Applicant responses / remarks
  if (c === "A..." || c === "A.NE" || c === "REM." || c === "A.PE") {
    return "response";
  }
  // Claim amendments (CLM during prosecution is an amendment, not the original)
  if (c === "CLM" || c === "CLM.") return "claim-amendment";
  // IDS submissions
  if (c === "IDS" || c === "1449" || c === "SB08A" || c === "SB08B") return "ids";
  // Notices: allowance, abandonment, etc.
  if (c === "NOA" || c === "ABN" || c === "N271" || c.startsWith("N.")) return "notice";
  // Initial filing artifacts
  if (c === "SPEC" || c === "DRW" || c === "ABST" || c === "OATH" || c === "ADS") {
    return "filing";
  }
  return "other";
}

// ── ODP HTTP layer ─────────────────────────────────────────────────────

interface RawOdpDocumentFormat {
  mimeTypeIdentifier?: string;
  downloadUrl?: string;
  pageTotalQuantity?: number;
}

interface RawOdpDocument {
  documentIdentifier?: string;
  officialDate?: string;
  documentCode?: string;
  documentCodeDescriptionText?: string;
  directionCategory?: "OUTGOING" | "INCOMING";
  downloadOptionBag?: RawOdpDocumentFormat[];
}

interface RawOdpDocumentResponse {
  documentBag?: RawOdpDocument[];
}

class OdpNotFoundError extends Error {
  constructor(appNumber: string) {
    super(`Application ${appNumber} not found in USPTO ODP`);
    this.name = "OdpNotFoundError";
  }
}

class OdpAuthError extends Error {
  constructor() {
    super("USPTO ODP API key missing or rejected");
    this.name = "OdpAuthError";
  }
}

async function fetchOdpDocuments(
  appNumber: string,
  apiKey: string
): Promise<RawOdpDocument[]> {
  const url =
    `${ODP_BASE_URL}/api/v1/patent/applications/${appNumber}/documents`;
  const response = await fetch(url, {
    headers: {
      "X-API-KEY": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new OdpAuthError();
  }
  if (response.status === 404) {
    throw new OdpNotFoundError(appNumber);
  }
  if (!response.ok) {
    throw new Error(`USPTO ODP returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as RawOdpDocumentResponse;
  return body.documentBag ?? [];
}

function pickPdf(formats?: RawOdpDocumentFormat[]):
  { pdfUrl?: string; pages?: number } {
  if (!formats || !formats.length) return {};
  const pdf =
    formats.find((f) => (f.mimeTypeIdentifier || "").toUpperCase() === "PDF") ||
    formats[0];
  return {
    ...(pdf.downloadUrl ? { pdfUrl: pdf.downloadUrl } : {}),
    ...(pdf.pageTotalQuantity ? { pages: pdf.pageTotalQuantity } : {}),
  };
}

function normalizeDate(raw?: string): string {
  if (!raw) return "";
  // ODP returns "2023-05-15" or "2023-05-15T00:00:00" — keep date portion only
  return raw.slice(0, 10);
}

function transformDocuments(raw: RawOdpDocument[]): FileWrapperDocument[] {
  const out: FileWrapperDocument[] = [];
  for (const r of raw) {
    const code = (r.documentCode || "").trim();
    if (!code) continue;
    const description = (r.documentCodeDescriptionText || "").trim();
    const date = normalizeDate(r.officialDate);
    const { pdfUrl, pages } = pickPdf(r.downloadOptionBag);
    out.push({
      documentId: r.documentIdentifier || `${code}-${date}`,
      date,
      code,
      description: description || code,
      category: categorize(code),
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(pages ? { pages } : {}),
    });
  }
  // Newest first
  out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return out;
}

// ── Cache layer ────────────────────────────────────────────────────────

const CACHE_COLLECTION = "prosecutionHistoryCache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Bump when the cached payload shape changes so old entries are treated as misses.
// v2: correctly populates pdfUrl from downloadOptionBag/downloadUrl (was missing in v1 due to wrong ODP field names).
const CACHE_SCHEMA_VERSION = 2;

async function readCache(
  db: admin.firestore.Firestore,
  appNumber: string
): Promise<ProsecutionHistory | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(appNumber).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (data.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.history as ProsecutionHistory), cached: true };
}

async function writeCache(
  db: admin.firestore.Firestore,
  appNumber: string,
  history: ProsecutionHistory
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(appNumber).set({
    history,
    schemaVersion: CACHE_SCHEMA_VERSION,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Request handler ────────────────────────────────────────────────────

export async function handleProsecutionHistoryRequest(
  body: ProsecutionHistoryRequest
): Promise<ProsecutionHistoryResult> {
  const normalized = normalizeApplicationNumber(body.applicationNumber || "");
  if (!normalized || normalized.length < 6) {
    return { error: "Invalid application number", code: "invalid_number" };
  }

  // Cheap pre-check: ODP coverage starts 2001-01-01. If we have a filing date
  // from the dossier and it's earlier, fail fast without burning a quota call.
  if (body.filingDate && body.filingDate < COVERAGE_START_DATE) {
    return {
      error:
        `Application ${normalized} was filed before USPTO ODP coverage begins (${COVERAGE_START_DATE}). File wrapper not available.`,
      code: "out_of_coverage",
    };
  }

  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    return { error: "USPTO ODP API key not configured", code: "no_api_key" };
  }

  const db = admin.firestore();
  const cached = await readCache(db, normalized);
  if (cached) return { history: cached };

  let raw: RawOdpDocument[];
  try {
    raw = await fetchOdpDocuments(normalized, apiKey);
  } catch (e) {
    if (e instanceof OdpAuthError) {
      return { error: "USPTO ODP authentication failed", code: "no_api_key" };
    }
    if (e instanceof OdpNotFoundError) {
      return {
        error:
          `No USPTO file wrapper found for application ${normalized}. The application may be pre-2001 or unpublished.`,
        code: "not_found",
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { error: `USPTO ODP fetch failed: ${message}`, code: "fetch_failed" };
  }

  const documents = transformDocuments(raw);
  const history: ProsecutionHistory = {
    applicationNumber: normalized,
    documentCount: documents.length,
    documents,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  writeCache(db, normalized, history).catch((e) => {
    console.warn(`[ODP] Cache write failed for ${normalized}:`, e);
  });

  return { history };
}

// ── PDF download proxy ─────────────────────────────────────────────────
//
// ODP file-wrapper PDF URLs are themselves API endpoints (X-API-KEY required),
// so the browser can't link to them directly. This proxy fetches with the key
// on the server and streams the PDF back to the authenticated extension user.

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

export interface OdpDocumentRequest {
  applicationNumber?: string;
  documentId?: string;
}

export type OdpDocumentErrorCode =
  | "invalid_input"
  | "not_found"
  | "fetch_failed"
  | "no_api_key"
  | "too_large";

export interface OdpDocumentResult {
  buffer?: Buffer;
  contentType?: string;
  filename?: string;
  error?: string;
  code?: OdpDocumentErrorCode;
}

export async function handleOdpDocumentRequest(
  body: OdpDocumentRequest
): Promise<OdpDocumentResult> {
  const appNumber = normalizeApplicationNumber(body.applicationNumber || "");
  const docId = (body.documentId || "").trim();
  // Document IDs from ODP are opaque alphanumeric — guard against path injection.
  if (!appNumber || appNumber.length < 6 || !docId || !/^[A-Za-z0-9_-]+$/.test(docId)) {
    return { error: "Invalid request", code: "invalid_input" };
  }

  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    return { error: "USPTO ODP API key not configured", code: "no_api_key" };
  }

  const url =
    `${ODP_BASE_URL}/api/v1/download/applications/${appNumber}/${docId}.pdf`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "X-API-KEY": apiKey, Accept: "application/pdf" },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `USPTO ODP fetch failed: ${message}`, code: "fetch_failed" };
  }

  if (response.status === 401 || response.status === 403) {
    return { error: "USPTO ODP authentication failed", code: "no_api_key" };
  }
  if (response.status === 404) {
    return { error: "Document not found at USPTO ODP", code: "not_found" };
  }
  if (!response.ok) {
    return { error: `USPTO ODP returned HTTP ${response.status}`, code: "fetch_failed" };
  }

  // Reject early if the server advertises a too-large response.
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && parseInt(lengthHeader, 10) > MAX_PDF_BYTES) {
    return { error: "Document exceeds 25 MB proxy limit", code: "too_large" };
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_PDF_BYTES) {
    return { error: "Document exceeds 25 MB proxy limit", code: "too_large" };
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/pdf",
    filename: `${appNumber}-${docId}.pdf`,
  };
}
