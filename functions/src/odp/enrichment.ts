/**
 * ODP enrichment endpoints (Phase 7) — net-new data the Google Patents scrape
 * never exposed, all read from the same file-wrapper fetch:
 *
 *   /v1/term               (patent_term)            — PTA-adjusted expiration
 *   /v1/prosecution-timeline (patent_timeline)      — full USPTO event log
 *   /v1/attorney           (patent_attorney)        — attorneys of record
 *   /v1/entity-status      (patent_entity_status)   — small/micro/large
 *   /v1/pregrant-pub       (patent_pregrant)        — as-filed pub claims/abstract
 *
 * US-only, public-domain, free in v1. See PLAN-API-DATA-MIGRATION.md Phase 7.
 */

import { normalizePatentNumber, type DossierClaim } from "../patentDossier";
import { toUsPatentDigits, str, firstStr, computeExpiration } from "./util";
import { parseGrantXml } from "./grantXmlParser";
import {
  searchByPatentNumber,
  fetchGrantXml,
  OdpAuthError,
  OdpRateLimitedError,
  type OdpWrapper,
} from "./odpClient";

type ErrCode = "invalid_number" | "not_found" | "fetch_failed" | "rate_limited";
interface ErrResult { error: string; code: ErrCode }

/**
 * Shared front door: validate, US-gate, fetch the wrapper. Returns the wrapper +
 * normalized number, or an error result the caller spreads into its own type.
 */
async function resolveWrapper(
  patentNumber: string | undefined
): Promise<{ wrapper: OdpWrapper; normalized: string } | ErrResult> {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) return { error: "USPTO ODP API key not configured", code: "fetch_failed" };

  const normalized = normalizePatentNumber(patentNumber || "");
  if (!normalized || normalized.length < 5) return { error: "Invalid patent number", code: "invalid_number" };
  const digits = toUsPatentDigits(normalized);
  if (!digits) {
    return { error: `Only US patents are supported (v1). '${normalized}' is not a US patent number.`, code: "invalid_number" };
  }

  let wrapper;
  try {
    wrapper = await searchByPatentNumber(digits, apiKey);
  } catch (e) {
    if (e instanceof OdpAuthError) return { error: "USPTO ODP authentication failed", code: "fetch_failed" };
    if (e instanceof OdpRateLimitedError) return { error: "USPTO ODP is throttling requests. Try again in a minute.", code: "rate_limited" };
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Fetch failed: ${message}`, code: "fetch_failed" };
  }
  if (!wrapper) {
    return { error: `No US patent ${digits} found in USPTO ODP (may pre-date 2001 coverage or not exist).`, code: "not_found" };
  }
  return { wrapper, normalized };
}

function isErr(r: { wrapper: OdpWrapper } | ErrResult): r is ErrResult {
  return (r as ErrResult).error !== undefined;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(str(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function addDays(isoDate: string, days: number): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── /v1/term — Patent Term Adjustment ──────────────────────────────────

export interface TermResult {
  patentNumber?: string;
  filingDate?: string;
  grantDate?: string;
  baseExpiration?: string;       // filing + 20 years
  ptaAdjustmentDays?: number;    // adjustmentTotalQuantity
  adjustedExpiration?: string;   // base + PTA days
  delayBreakdown?: { usptoADelay: number; usptoBDelay: number; usptoCDelay: number; applicantDelay: number };
  cached?: boolean;
  error?: string;
  code?: ErrCode;
}

export async function handleTermRequest(body: { patentNumber?: string }): Promise<TermResult> {
  const r = await resolveWrapper(body.patentNumber);
  if (isErr(r)) return r;
  const md = (r.wrapper.applicationMetaData ?? {}) as Record<string, unknown>;
  const pta = (r.wrapper.patentTermAdjustmentData ?? {}) as Record<string, unknown>;

  const filingDate = str(md.filingDate);
  const baseExpiration = computeExpiration(filingDate, str(md.effectiveFilingDate) || filingDate);
  const ptaDays = num(pta.adjustmentTotalQuantity);

  return {
    patentNumber: r.normalized,
    filingDate,
    grantDate: str(md.grantDate),
    baseExpiration,
    ptaAdjustmentDays: ptaDays,
    adjustedExpiration: ptaDays ? addDays(baseExpiration, ptaDays) : baseExpiration,
    delayBreakdown: {
      usptoADelay: num(pta.aDelayQuantity),
      usptoBDelay: num(pta.bDelayQuantity),
      usptoCDelay: num(pta.cDelayQuantity),
      applicantDelay: num(pta.applicantDayDelayQuantity),
    },
    cached: false,
  };
}

// ── /v1/prosecution-timeline — full USPTO event log ────────────────────

export interface TimelineEvent { date: string; code: string; description: string }
export interface TimelineResult {
  patentNumber?: string;
  eventCount?: number;
  events?: TimelineEvent[];
  cached?: boolean;
  error?: string;
  code?: ErrCode;
}

export async function handleProsecutionTimelineRequest(body: { patentNumber?: string }): Promise<TimelineResult> {
  const r = await resolveWrapper(body.patentNumber);
  if (isErr(r)) return r;
  const events: TimelineEvent[] = (r.wrapper.eventDataBag ?? [])
    .map((e) => ({ date: str(e.eventDate), code: str(e.eventCode), description: str(e.eventDescriptionText) }))
    .filter((e) => e.date || e.code)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "")); // chronological
  return { patentNumber: r.normalized, eventCount: events.length, events, cached: false };
}

// ── /v1/attorney — attorneys of record ─────────────────────────────────

export interface AttorneyOfRecord { name: string; registrationNumber: string; active: boolean }
export interface AttorneyResult {
  patentNumber?: string;
  customerNumber?: string;
  docketNumber?: string;
  attorneyCount?: number;
  attorneys?: AttorneyOfRecord[];
  cached?: boolean;
  error?: string;
  code?: ErrCode;
}

export async function handleAttorneyRequest(body: { patentNumber?: string }): Promise<AttorneyResult> {
  const r = await resolveWrapper(body.patentNumber);
  if (isErr(r)) return r;
  const md = (r.wrapper.applicationMetaData ?? {}) as Record<string, unknown>;
  const ra = (r.wrapper.recordAttorney ?? {}) as Record<string, unknown>;
  const bag = Array.isArray(ra.attorneyBag) ? (ra.attorneyBag as Array<Record<string, unknown>>) : [];

  const attorneys: AttorneyOfRecord[] = bag
    .map((a) => ({
      name: [str(a.firstName), str(a.lastName)].filter(Boolean).join(" ") || str(a.nameLineOneText),
      registrationNumber: str(a.registrationNumber),
      active: str(a.activeIndicator).toUpperCase() === "ACTIVE",
    }))
    .filter((a) => a.name);

  return {
    patentNumber: r.normalized,
    customerNumber: str(md.customerNumber),
    docketNumber: str(md.docketNumber),
    attorneyCount: attorneys.length,
    attorneys,
    cached: false,
  };
}

// ── /v1/entity-status — small / micro / large ──────────────────────────

export interface EntityStatusResult {
  patentNumber?: string;
  smallEntity?: boolean;
  category?: string;             // e.g. "Regular Undiscounted"
  cached?: boolean;
  error?: string;
  code?: ErrCode;
}

export async function handleEntityStatusRequest(body: { patentNumber?: string }): Promise<EntityStatusResult> {
  const r = await resolveWrapper(body.patentNumber);
  if (isErr(r)) return r;
  const md = (r.wrapper.applicationMetaData ?? {}) as Record<string, unknown>;
  const esd = (md.entityStatusData ?? {}) as Record<string, unknown>;
  return {
    patentNumber: r.normalized,
    smallEntity: esd.smallEntityStatusIndicator === true,
    category: str(esd.businessEntityStatusCategory),
    cached: false,
  };
}

// ── /v1/pregrant-pub — as-filed publication ────────────────────────────

export interface PregrantPubResult {
  patentNumber?: string;
  publicationNumber?: string;
  publicationDate?: string;
  asFiledAbstract?: string;
  asFiledClaimCount?: number;
  asFiledClaims?: DossierClaim[];
  cached?: boolean;
  error?: string;
  code?: ErrCode;
}

export async function handlePregrantPubRequest(body: { patentNumber?: string }): Promise<PregrantPubResult> {
  const r = await resolveWrapper(body.patentNumber);
  if (isErr(r)) return r;
  const md = (r.wrapper.applicationMetaData ?? {}) as Record<string, unknown>;
  const uri = r.wrapper.pgpubDocumentMetaData?.fileLocationURI;

  const out: PregrantPubResult = {
    patentNumber: r.normalized,
    publicationNumber: str(md.earliestPublicationNumber),
    publicationDate: str(md.earliestPublicationDate) || firstStr(md.publicationDateBag),
    cached: false,
  };
  if (!uri) {
    // No pre-grant publication (e.g. filed under a non-publication request).
    return { ...out, asFiledClaimCount: 0, asFiledClaims: [] };
  }

  const apiKey = process.env.USPTO_ODP_API_KEY as string;
  try {
    const xml = await fetchGrantXml(uri, apiKey); // same XML claim structure as grants
    const parsed = parseGrantXml(xml);
    out.asFiledAbstract = parsed.abstract;
    out.asFiledClaims = parsed.claims;
    out.asFiledClaimCount = parsed.claims.length;
  } catch (e) {
    if (e instanceof OdpRateLimitedError) return { error: "USPTO ODP is throttling requests. Try again in a minute.", code: "rate_limited" };
    // Metadata still useful even if the XML fetch failed.
    console.warn(`[Pregrant] XML fetch/parse failed for ${r.normalized}:`, e instanceof Error ? e.message : e);
    out.asFiledClaimCount = 0;
    out.asFiledClaims = [];
  }
  return out;
}
