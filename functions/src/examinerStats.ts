/**
 * Examiner statistics from USPTO ODP.
 *
 * For a given application number, returns the examiner who handled it plus
 * aggregate stats about that examiner's docket: total applications, allowance
 * rate, average pendency, art unit. Surfaces in the dossier as § 9.
 *
 * Endpoint: POST /examiner-stats
 *   body: { applicationNumber: string }
 *   credits: 0 (free, bundled with dossier)
 *   auth: Bearer (verified in index.ts)
 *
 * Data source: USPTO ODP (PatentsView migrated into ODP on 2026-03-20).
 * Uses the same X-API-KEY as the prosecution history feature.
 */

import * as admin from "firebase-admin";
import { normalizeApplicationNumber } from "./usptoOdp";

const ODP_BASE_URL = "https://api.uspto.gov";
const REQUEST_TIMEOUT_MS = 20000;
const PENDENCY_SAMPLE_SIZE = 100;

// ── Types ──────────────────────────────────────────────────────────────

export interface ExaminerStats {
  applicationNumber: string;
  examinerName: string;
  artUnit: string;
  patentNumber?: string;
  totalApplications: number;
  patentedCount: number;
  allowanceRate: number;          // 0..1, patented / total
  avgPendencyDays: number;        // mean filing→grant from sample
  pendencySampleSize: number;
  fetchedAt: string;
  cached: boolean;
}

export interface ExaminerStatsRequest {
  applicationNumber?: string;
}

export type ExaminerStatsErrorCode =
  | "invalid_input"
  | "not_found"
  | "fetch_failed"
  | "no_api_key"
  | "no_examiner";

export interface ExaminerStatsResult {
  stats?: ExaminerStats;
  error?: string;
  code?: ExaminerStatsErrorCode;
}

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_COLLECTION = "examinerStatsCache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;

async function readCache(
  db: admin.firestore.Firestore,
  key: string
): Promise<ExaminerStats | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (data.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.stats as ExaminerStats), cached: true };
}

async function writeCache(
  db: admin.firestore.Firestore,
  key: string,
  stats: ExaminerStats
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(key).set({
    stats,
    schemaVersion: CACHE_SCHEMA_VERSION,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── ODP calls ──────────────────────────────────────────────────────────

interface OdpAppMetaData {
  examinerNameText?: string;
  groupArtUnitNumber?: string;
  patentNumber?: string;
  filingDate?: string;
  grantDate?: string;
  applicationStatusDescriptionText?: string;
}

interface OdpAppRecord {
  applicationNumberText?: string;
  applicationMetaData?: OdpAppMetaData;
}

interface OdpAppResponse {
  count?: number;
  patentFileWrapperDataBag?: OdpAppRecord[];
}

async function odpGet(url: string, apiKey: string): Promise<OdpAppResponse> {
  const res = await fetch(url, {
    headers: { "X-API-KEY": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("ODP_AUTH");
  }
  if (res.status === 404) {
    throw new Error("ODP_NOT_FOUND");
  }
  if (!res.ok) throw new Error(`ODP_HTTP_${res.status}`);
  return res.json() as Promise<OdpAppResponse>;
}

async function odpPost(
  url: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<OdpAppResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new Error("ODP_AUTH");
  if (res.status === 404) throw new Error("ODP_NOT_FOUND");
  if (!res.ok) throw new Error(`ODP_HTTP_${res.status}`);
  return res.json() as Promise<OdpAppResponse>;
}

async function fetchAppBibliographic(
  appNumber: string,
  apiKey: string
): Promise<OdpAppMetaData | null> {
  const url = `${ODP_BASE_URL}/api/v1/patent/applications/${appNumber}`;
  const data = await odpGet(url, apiKey);
  return data.patentFileWrapperDataBag?.[0]?.applicationMetaData ?? null;
}

/**
 * Quote and escape the examiner name for an ODP query string. The query is
 * Lucene-like; double quotes terminate the phrase, so we strip them defensively.
 */
function quoteExaminerName(name: string): string {
  return `"${name.replace(/"/g, "")}"`;
}

async function fetchExaminerTotalCount(
  examinerName: string,
  apiKey: string
): Promise<number> {
  const url = `${ODP_BASE_URL}/api/v1/patent/applications/search`;
  const data = await odpPost(url, apiKey, {
    q: `applicationMetaData.examinerNameText:${quoteExaminerName(examinerName)}`,
    fields: ["applicationNumberText"],
    pagination: { offset: 0, limit: 1 },
  });
  return data.count ?? 0;
}

async function fetchExaminerPatentedSample(
  examinerName: string,
  apiKey: string,
  limit: number
): Promise<{ count: number; records: OdpAppMetaData[] }> {
  const url = `${ODP_BASE_URL}/api/v1/patent/applications/search`;
  const data = await odpPost(url, apiKey, {
    q:
      `applicationMetaData.examinerNameText:${quoteExaminerName(examinerName)} ` +
      `AND applicationMetaData.applicationStatusDescriptionText:"Patented Case"`,
    fields: [
      "applicationNumberText",
      "applicationMetaData.examinerNameText",
      "applicationMetaData.filingDate",
      "applicationMetaData.grantDate",
      "applicationMetaData.applicationStatusDescriptionText",
    ],
    sort: [{ field: "applicationMetaData.grantDate", order: "desc" }],
    pagination: { offset: 0, limit },
  });
  const records = (data.patentFileWrapperDataBag || [])
    .map((r) => r.applicationMetaData)
    .filter((m): m is OdpAppMetaData => !!m);
  return { count: data.count ?? 0, records };
}

// ── Stats computation ──────────────────────────────────────────────────

function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.round((tb - ta) / (1000 * 60 * 60 * 24));
}

function avgPendency(records: OdpAppMetaData[]): {
  avgDays: number;
  sampleSize: number;
} {
  let total = 0;
  let n = 0;
  for (const r of records) {
    if (!r.filingDate || !r.grantDate) continue;
    const d = daysBetween(r.filingDate, r.grantDate);
    if (d === null || d < 0 || d > 365 * 20) continue;  // sanity cap at 20 years
    total += d;
    n += 1;
  }
  if (n === 0) return { avgDays: 0, sampleSize: 0 };
  return { avgDays: Math.round(total / n), sampleSize: n };
}

// ── Request handler ────────────────────────────────────────────────────

export async function handleExaminerStatsRequest(
  body: ExaminerStatsRequest
): Promise<ExaminerStatsResult> {
  const appNumber = normalizeApplicationNumber(body.applicationNumber || "");
  if (!appNumber || appNumber.length < 6) {
    return { error: "Invalid application number", code: "invalid_input" };
  }

  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    return { error: "USPTO ODP API key not configured", code: "no_api_key" };
  }

  const db = admin.firestore();

  // Cached by application number — examiner identity is fixed per app, so this
  // keys correctly across multiple users viewing the same patent.
  const cached = await readCache(db, appNumber);
  if (cached) return { stats: cached };

  // 1) Find the examiner who handled this application
  let meta: OdpAppMetaData | null;
  try {
    meta = await fetchAppBibliographic(appNumber, apiKey);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "ODP_AUTH") {
      return { error: "USPTO ODP authentication failed", code: "no_api_key" };
    }
    if (message === "ODP_NOT_FOUND") {
      return {
        error: `No USPTO record found for application ${appNumber}`,
        code: "not_found",
      };
    }
    return { error: `Bibliographic fetch failed: ${message}`, code: "fetch_failed" };
  }
  if (!meta || !meta.examinerNameText) {
    return {
      error: "No examiner is recorded for this application in USPTO ODP",
      code: "no_examiner",
    };
  }

  const examinerName = meta.examinerNameText;
  const artUnit = meta.groupArtUnitNumber || "—";

  // 2 + 3) In parallel: total count + most-recent patented sample
  let totalCount = 0;
  let patentedSample: { count: number; records: OdpAppMetaData[] } = { count: 0, records: [] };
  try {
    [totalCount, patentedSample] = await Promise.all([
      fetchExaminerTotalCount(examinerName, apiKey),
      fetchExaminerPatentedSample(examinerName, apiKey, PENDENCY_SAMPLE_SIZE),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Examiner search failed: ${message}`, code: "fetch_failed" };
  }

  const patentedCount = patentedSample.count;
  const allowanceRate = totalCount > 0 ? patentedCount / totalCount : 0;
  const { avgDays, sampleSize } = avgPendency(patentedSample.records);

  const stats: ExaminerStats = {
    applicationNumber: appNumber,
    examinerName,
    artUnit,
    ...(meta.patentNumber ? { patentNumber: meta.patentNumber } : {}),
    totalApplications: totalCount,
    patentedCount,
    allowanceRate,
    avgPendencyDays: avgDays,
    pendencySampleSize: sampleSize,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  writeCache(db, appNumber, stats).catch((e) => {
    console.warn(`[ExaminerStats] Cache write failed for ${appNumber}:`, e);
  });

  return { stats };
}
