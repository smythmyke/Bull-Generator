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
