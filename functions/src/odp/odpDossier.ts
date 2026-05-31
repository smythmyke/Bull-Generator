/**
 * ODP-backed patent dossier — the API/MCP replacement for the Google Patents
 * dossier path. Produces the SAME `PatentDossier` shape as `patentDossier.ts`
 * so every downstream consumer (claim chart, OA analyzer, IDS, summary) works
 * unchanged, but sources everything from USPTO ODP (public-domain data) instead
 * of scraping Google Patents.
 *
 * Scope (v1, locked 2026-05-31 — see planning/PLAN-API-DATA-MIGRATION.md):
 *   - US patents only (file-wrapper coverage: applications filed >= 2001).
 *   - similar documents: dropped (Google ML feature, no ODP equivalent).
 *   - citations: backward only (grant XML); forward unavailable in ODP.
 *   - family: US continuity only (parent/child); not international INPADOC.
 *
 * Data assembly per request:
 *   1. search by patent number  -> full wrapper (biblio, assignment, grant URI, child continuity)
 *   2. fetch grant XML          -> abstract, claims, backward citations
 *   3. fetch continuity         -> parent + child family (best-effort)
 * Steps 2 and 3 run in parallel after step 1.
 */

import * as admin from "firebase-admin";
import {
  normalizePatentNumber,
  type PatentDossier,
  type PatentDossierRequest,
  type PatentDossierResult,
  type PatentStatus,
  type DossierCpc,
  type DossierFamilyMember,
  type SimilarResult,
  type CitationsResult,
  type FamilyResult,
  type ClaimsResult,
} from "../patentDossier";
import { parseGrantXml } from "./grantXmlParser";
import {
  searchByPatentNumber,
  fetchGrantXml,
  fetchContinuity,
  OdpAuthError,
  OdpRateLimitedError,
  type OdpWrapper,
  type OdpContinuityChild,
  type OdpContinuityParent,
} from "./odpClient";

// ── US patent-number extraction ────────────────────────────────────────

/**
 * Extract the bare US patent digits from a normalized number, or null if it
 * isn't a US patent. normalizePatentNumber yields e.g. "US10867416B2" or
 * "US10000000"; ODP's patentNumber field is digits only.
 */
export function toUsPatentDigits(normalized: string): string | null {
  const us = normalized.match(/^US(\d{6,8})(?:[A-Z]\d?)?$/);
  if (us) return us[1];
  const bare = normalized.match(/^(\d{6,8})$/);
  return bare ? bare[1] : null;
}

// ── Field mapping helpers ──────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function firstStr(v: unknown): string {
  return Array.isArray(v) ? str(v[0]) : str(v);
}

function mapCpc(bag: unknown): DossierCpc[] {
  if (!Array.isArray(bag)) return [];
  return bag
    .map((raw, i) => {
      const code = str(raw).replace(/\s+/g, " ").trim();
      return code ? { code, label: "", primary: i === 0 } : null;
    })
    .filter((c): c is DossierCpc => c !== null);
}

function inventorNames(bag: unknown): string[] {
  if (!Array.isArray(bag)) return [];
  return bag
    .map((inv) => {
      const o = inv as Record<string, unknown>;
      return str(o.inventorNameText) ||
        [str(o.firstName), str(o.lastName)].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

/** Most-recent recorded assignee from the assignment chain, if any. */
function currentAssignee(assignmentBag: unknown): string {
  if (!Array.isArray(assignmentBag) || assignmentBag.length === 0) return "";
  // assignmentBag is returned newest-first by ODP; take the first with an assignee.
  for (const a of assignmentBag) {
    const ab = (a as Record<string, unknown>).assigneeBag;
    if (Array.isArray(ab) && ab.length > 0) {
      const o = ab[0] as Record<string, unknown>;
      const name = str(o.assigneeNameText) || str(o.nameLineOneText) || str(o.organizationName);
      if (name) return name;
    }
  }
  return "";
}

function computeExpiration(filingDate: string, priorityDate: string): string {
  const base = filingDate || priorityDate;
  if (!base) return "";
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + 20);
  return d.toISOString().slice(0, 10);
}

function mapStatus(desc: string, expiration: string): { status: PatentStatus; statusLabel: string } {
  const d = desc.toLowerCase();
  let status: PatentStatus = "unknown";
  if (d.includes("patented")) status = "active";
  else if (d.includes("expired")) status = "expired";
  else if (d.includes("abandon")) status = "lapsed";
  else if (d.includes("pending") || d.includes("docketed") || d.includes("examination") || d.includes("non-final")) {
    status = "pending";
  }
  // A granted patent past its 20-year term is expired regardless of label.
  if (status === "active" && expiration) {
    const today = new Date().toISOString().slice(0, 10);
    if (expiration < today) status = "expired";
  }
  return { status, statusLabel: desc || status };
}

function familyMembers(
  parents: OdpContinuityParent[],
  children: OdpContinuityChild[]
): DossierFamilyMember[] {
  const out: DossierFamilyMember[] = [];
  for (const p of parents) {
    const num = str(p.parentApplicationNumberText);
    if (!num) continue;
    out.push({
      jurisdiction: "US",
      publicationNumber: num,
      type: str(p.claimParentageTypeCodeDescriptionText) || str(p.claimParentageTypeCode) || "parent",
      status: str(p.parentApplicationStatusDescriptionText),
      date: str(p.parentApplicationFilingDate),
    });
  }
  for (const c of children) {
    const num = str(c.childApplicationNumberText);
    if (!num) continue;
    out.push({
      jurisdiction: "US",
      publicationNumber: num,
      type: str(c.claimParentageTypeCodeDescriptionText) || str(c.claimParentageTypeCode) || "child",
      status: str(c.childApplicationStatusDescriptionText),
      date: str(c.childApplicationFilingDate),
    });
  }
  return out;
}

// ── Dossier assembly ───────────────────────────────────────────────────

function buildDossier(
  patentNumber: string,
  wrapper: OdpWrapper,
  grantXml: string,
  family: { parents: OdpContinuityParent[]; children: OdpContinuityChild[] }
): PatentDossier {
  const md = (wrapper.applicationMetaData ?? {}) as Record<string, unknown>;
  const parsed = parseGrantXml(grantXml);

  const filingDate = str(md.filingDate);
  const priorityDate = str(md.effectiveFilingDate) || filingDate;
  const grantDate = str(md.grantDate);
  const publicationDate = firstStr(md.publicationDateBag) || str(md.earliestPublicationDate);
  const expiration = computeExpiration(filingDate, priorityDate);
  const applicantName = firstStr(
    Array.isArray(md.applicantBag)
      ? (md.applicantBag as Array<Record<string, unknown>>).map((a) => str(a.applicantNameText))
      : []
  );
  const assignedName = currentAssignee(wrapper.assignmentBag);
  // Mirror the Google Patents path: fall back across the two sources so neither
  // field is blank when at least one is known.
  const original = applicantName || assignedName;
  const current = assignedName || applicantName;
  const { status, statusLabel } = mapStatus(str(md.applicationStatusDescriptionText), expiration);

  const independentNumbers = parsed.claims.filter((c) => c.isIndependent).map((c) => c.number);

  return {
    patentNumber,
    fetchedAt: new Date().toISOString(),
    cached: false,
    header: {
      title: str(md.inventionTitle),
      abstract: parsed.abstract,
      inventors: inventorNames(md.inventorBag),
      originalAssignee: original,
      currentAssignee: current,
      applicationNumber: str(wrapper.applicationNumberText),
      priorityDate,
      filingDate,
      publicationDate,
      grantDate,
      anticipatedExpiration: expiration,
      status,
      statusLabel,
    },
    legalStatus: [{ jurisdiction: "US", status: statusLabel, keyDate: grantDate || publicationDate }],
    family: {
      familyId: str(wrapper.applicationNumberText),
      members: familyMembers(family.parents, family.children),
    },
    claims: {
      totalCount: parsed.claims.length,
      independentNumbers,
      items: parsed.claims,
    },
    citations: {
      forwardCount: 0, // forward citations not available from ODP (v1 limitation)
      backwardCount: parsed.backwardCitations.length,
      forward: [],
      backward: parsed.backwardCitations,
    },
    classification: { cpcCodes: mapCpc(md.cpcClassificationBag) },
    similar: [], // dropped for v1 — Google ML feature, no ODP equivalent
  };
}

// ── Cache layer (separate collection from the extension's dossierCache) ──

const CACHE_COLLECTION = "odpDossierCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function readCache(
  db: admin.firestore.Firestore,
  patentNumber: string
): Promise<PatentDossier | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(patentNumber).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.dossier as PatentDossier), cached: true };
}

async function writeCache(
  db: admin.firestore.Firestore,
  patentNumber: string,
  dossier: PatentDossier
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(patentNumber).set({
    dossier,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Request handler (mirrors handlePatentDossierRequest's contract) ─────

export async function handleOdpDossierRequest(
  body: PatentDossierRequest
): Promise<PatentDossierResult> {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    return { error: "USPTO ODP API key not configured", code: "fetch_failed" };
  }

  const normalized = normalizePatentNumber(body.patentNumber || "");
  if (!normalized || normalized.length < 5) {
    return { error: "Invalid patent number", code: "invalid_number" };
  }

  const digits = toUsPatentDigits(normalized);
  if (!digits) {
    return {
      error: `Only US patents are supported in this API (v1). '${normalized}' is not a US patent number.`,
      code: "invalid_number",
    };
  }

  const db = admin.firestore();
  const cached = await readCache(db, normalized);
  if (cached) return { dossier: cached };

  let wrapper: OdpWrapper | null;
  try {
    wrapper = await searchByPatentNumber(digits, apiKey);
  } catch (e) {
    return mapFetchError(e, normalized);
  }
  if (!wrapper) {
    return {
      error: `No US patent ${digits} found in USPTO ODP. It may pre-date ODP coverage (applications filed before 2001) or not exist.`,
      code: "not_found",
    };
  }

  const grantUri = wrapper.grantDocumentMetaData?.fileLocationURI;
  if (!grantUri) {
    return {
      error: `US patent ${digits} has no grant full-text in ODP (may be an unpublished/pending application).`,
      code: "not_found",
    };
  }

  const appNumber = wrapper.applicationNumberText || "";
  let grantXml: string;
  let family: { parents: OdpContinuityParent[]; children: OdpContinuityChild[] };
  try {
    // Grant XML is required; continuity is best-effort (family degrades, dossier survives).
    const [xml, cont] = await Promise.all([
      fetchGrantXml(grantUri, apiKey),
      appNumber
        ? fetchContinuity(appNumber, apiKey).catch((e) => {
            console.warn(`[ODP] Continuity fetch failed for ${appNumber}:`, e);
            return { parents: [], children: wrapper!.childContinuityBag ?? [] };
          })
        : Promise.resolve({ parents: [], children: wrapper.childContinuityBag ?? [] }),
    ]);
    grantXml = xml;
    family = cont;
  } catch (e) {
    return mapFetchError(e, normalized);
  }

  let dossier: PatentDossier;
  try {
    dossier = buildDossier(normalized, wrapper, grantXml, family);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Parse failed: ${message}`, code: "parse_failed" };
  }

  if (!dossier.header.title && dossier.claims.totalCount === 0) {
    return { error: `Could not assemble a dossier for US patent ${digits}.`, code: "parse_failed" };
  }

  writeCache(db, normalized, dossier).catch((e) => {
    console.warn(`[ODP] Cache write failed for ${normalized}:`, e);
  });

  return { dossier };
}

function mapFetchError(e: unknown, normalized: string): PatentDossierResult {
  if (e instanceof OdpAuthError) {
    return { error: "USPTO ODP authentication failed", code: "fetch_failed" };
  }
  if (e instanceof OdpRateLimitedError) {
    return {
      error: "USPTO ODP is throttling requests right now. Please try again in a minute.",
      code: "rate_limited",
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`[ODP] Fetch failed for ${normalized}:`, message);
  return { error: `Fetch failed: ${message}`, code: "fetch_failed" };
}

// ── Targeted-slice handlers (mirror the Google Patents slice contracts) ──

export async function handleOdpSimilarRequest(
  body: { patentNumber?: string; limit?: number }
): Promise<SimilarResult> {
  // Similar documents are not available from ODP (v1). Resolve the dossier so
  // not-found / invalid errors still surface, then return an empty list.
  const result = await handleOdpDossierRequest({ patentNumber: body.patentNumber });
  if (result.error) return { error: result.error, code: result.code };
  return { patentNumber: result.dossier!.patentNumber, similar: [], cached: result.dossier!.cached };
}

export async function handleOdpCitationsRequest(
  body: { patentNumber?: string; direction?: string }
): Promise<CitationsResult> {
  const result = await handleOdpDossierRequest({ patentNumber: body.patentNumber });
  if (result.error) return { error: result.error, code: result.code };
  const dossier = result.dossier!;
  // ODP supplies backward citations only; forward is always empty in v1.
  const dir = body.direction === "forward" ? "forward" : body.direction === "both" ? "both" : "backward";
  const out: CitationsResult = { patentNumber: dossier.patentNumber, direction: dir, cached: dossier.cached };
  if (dir === "backward" || dir === "both") {
    out.backward = dossier.citations.backward;
    out.backwardCount = dossier.citations.backwardCount;
  }
  if (dir === "forward" || dir === "both") {
    out.forward = [];
    out.forwardCount = 0;
  }
  return out;
}

export async function handleOdpFamilyRequest(
  body: { patentNumber?: string }
): Promise<FamilyResult> {
  const result = await handleOdpDossierRequest({ patentNumber: body.patentNumber });
  if (result.error) return { error: result.error, code: result.code };
  return { patentNumber: result.dossier!.patentNumber, family: result.dossier!.family, cached: result.dossier!.cached };
}

export async function handleOdpClaimsRequest(
  body: { patentNumber?: string }
): Promise<ClaimsResult> {
  const result = await handleOdpDossierRequest({ patentNumber: body.patentNumber });
  if (result.error) return { error: result.error, code: result.code };
  const dossier = result.dossier!;
  return { patentNumber: dossier.patentNumber, claims: dossier.claims, cached: dossier.cached };
}
