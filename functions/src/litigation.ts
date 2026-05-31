/**
 * /v1/litigation (MCP `patent_litigation`) — district-court infringement
 * history for a patent. Answers "who sued who over this patent, where, and
 * over what."
 *
 * Backed by the USPTO Patent Litigation Dataset (PTLITIG 2020) pre-ingested
 * into Firestore `litigationByPatent/{digits}` (see scripts/ingest-litigation.js).
 * The dataset is bulk-only — there is no per-patent USPTO litigation API — so
 * unlike the ODP endpoints this reads from our own ingested store.
 *
 * Coverage: comprehensive 2003-2016, partial to 2020. Public-domain, US-only.
 * Phase 8b — see PLAN-API-DATA-MIGRATION.md.
 */

import * as admin from "firebase-admin";
import { normalizePatentNumber } from "./patentDossier";
import { toUsPatentDigits } from "./odp/util";

const COVERAGE_NOTE =
  "Source: USPTO Patent Litigation Dataset (district-court). Comprehensive coverage 2003-2016, partial to 2020; no cases after 2020 or before 2003.";

export interface LitigationCase {
  caseNumber: string;
  court: string;
  district: string;
  dateFiled: string;
  dateClosed: string;
  caseName: string;
  plaintiffs: string[];
  defendants: string[];
  cause: string;
  natureOfSuit: string;
  settlement: boolean;
}

export interface LitigationResult {
  patentNumber?: string;
  caseCount?: number;
  cases?: LitigationCase[];
  truncated?: boolean;
  coverageNote?: string;
  error?: string;
  code?: "invalid_number";
}

export async function handleLitigationRequest(
  body: { patentNumber?: string; limit?: number }
): Promise<LitigationResult> {
  const normalized = normalizePatentNumber(body.patentNumber || "");
  if (!normalized || normalized.length < 5) {
    return { error: "Invalid patent number", code: "invalid_number" };
  }
  const digits = toUsPatentDigits(normalized);
  if (!digits) {
    return {
      error: `Only US patents are supported (v1). '${normalized}' is not a US patent number.`,
      code: "invalid_number",
    };
  }

  const db = admin.firestore();
  const snap = await db.collection("litigationByPatent").doc(digits).get();
  const data = snap.data();

  // No doc = the patent has no district-court litigation on record. That's a
  // valid answer (not an error): return an empty, clearly-scoped result.
  if (!data) {
    return { patentNumber: normalized, caseCount: 0, cases: [], coverageNote: COVERAGE_NOTE };
  }

  const allCases = (data.cases as LitigationCase[]) || [];
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.floor(body.limit) : allCases.length;
  return {
    patentNumber: normalized,
    caseCount: (data.caseCount as number) ?? allCases.length,
    cases: allCases.slice(0, limit),
    truncated: (data.truncated as boolean) || allCases.length > limit,
    coverageNote: COVERAGE_NOTE,
  };
}

// ── Reverse lookup: company -> litigation (/v1/company-litigation) ───────
// Backed by litigationByParty/{normName} (see scripts/ingest-company-litigation.js).
// NOTE: this normalization MUST stay identical to that script's normName().

const COMPANY_SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|llc|ltd|limited|lp|llp|plc|gmbh|sa|ag|nv|bv)\b/g;

function normCompanyName(s: string): string {
  return (s || "").toLowerCase()
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[.,'"]/g, "")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

export interface PartyLitigationCase {
  role: "plaintiff" | "defendant";
  caseNumber: string;
  court: string;
  dateFiled: string;
  cause: string;
  patents: string[];
  opposing: string[];
}

export interface CompanyLitigationResult {
  query?: string;
  matchedName?: string;
  displayNames?: string[];
  caseCount?: number;
  asPlaintiffCount?: number;
  asDefendantCount?: number;
  cases?: PartyLitigationCase[];
  truncated?: boolean;
  related?: { name: string; displayNames: string[]; caseCount: number }[];
  suggestions?: { name: string; displayNames: string[]; caseCount: number }[];
  coverageNote?: string;
  error?: string;
  code?: "invalid_input";
}

export async function handleCompanyLitigationRequest(
  body: { company?: string; limit?: number }
): Promise<CompanyLitigationResult> {
  const q = normCompanyName(body.company || "");
  if (!q || q.length < 2) {
    return { error: "Provide a company name (e.g. 'Microsoft')", code: "invalid_input" };
  }

  const db = admin.firestore();
  const col = db.collection("litigationByParty");

  // 1. Exact normalized match -> full record. Also surface bigger siblings so a
  //    small exact entity (e.g. "samsung") doesn't hide "samsung electronics".
  const exact = await col.doc(q.slice(0, 1400)).get();
  if (exact.exists) {
    const d = exact.data()!;
    const cases = (d.cases as PartyLitigationCase[]) || [];
    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.floor(body.limit) : Math.min(cases.length, 100);
    const sib = await col.orderBy("normalizedName").startAt(q).endAt(q + "").limit(20).get();
    const related = sib.docs.map((doc) => doc.data())
      .filter((r) => (r.normalizedName as string) !== q)
      .map((r) => ({ name: r.normalizedName as string, displayNames: (r.displayNames as string[]) || [], caseCount: (r.caseCount as number) || 0 }))
      .sort((a, b) => b.caseCount - a.caseCount).slice(0, 6);
    return {
      query: body.company,
      matchedName: d.normalizedName as string,
      displayNames: (d.displayNames as string[]) || [],
      caseCount: (d.caseCount as number) ?? cases.length,
      asPlaintiffCount: d.asPlaintiffCount as number,
      asDefendantCount: d.asDefendantCount as number,
      cases: cases.slice(0, limit),
      truncated: (d.truncated as boolean) || cases.length > limit,
      ...(related.length ? { related } : {}),
      coverageNote: COVERAGE_NOTE,
    };
  }

  // 2. No exact match — prefix search for candidate companies to disambiguate.
  const snap = await col.orderBy("normalizedName").startAt(q).endAt(q + "").limit(10).get();
  const suggestions = snap.docs.map((doc) => {
    const d = doc.data();
    return { name: d.normalizedName as string, displayNames: (d.displayNames as string[]) || [], caseCount: (d.caseCount as number) || 0 };
  }).sort((a, b) => b.caseCount - a.caseCount);

  return {
    query: body.company,
    caseCount: 0,
    suggestions,
    coverageNote: suggestions.length
      ? "No exact match; showing companies whose name starts with your query. Re-query with one of these."
      : `No litigation on record for a company matching '${body.company}' (repeat-litigant index, ${COVERAGE_NOTE})`,
  };
}
