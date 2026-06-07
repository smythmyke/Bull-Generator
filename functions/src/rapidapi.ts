/**
 * RapidAPI marketplace gateway shim (Door 1). Mirrors the JackpotKeywords
 * pattern (see JK's RAPIDAPI-REPLICATION-RUNBOOK.md), adapted to Bull-Generator's
 * credit system. Additive + gated behind the proxy-secret header, so the
 * extension (Door 2) and direct/MCP API traffic are untouched.
 *
 * Money flow: developers pay RapidAPI on its marketplace; RapidAPI proxies their
 * calls here (stamped with X-RapidAPI-Proxy-Secret), meters them against our
 * `Credits` quota via the X-RapidAPI-Billing response header, and pays us 75%
 * via PayPal. RapidAPI is the ledger for this surface — these calls bind to a
 * billing-exempt "house" account and never deduct internal credits.
 *
 * Inert until configured: if PSG_RAPIDAPI_PROXY_SECRET / PSG_RAPIDAPI_HOUSE_UID
 * are unset, any request bearing the proxy-secret header is rejected (401) and
 * normal traffic (no such header) is unaffected.
 */

import * as functions from "firebase-functions";
import * as crypto from "crypto";

// Minimal structural res type (the express Response from https.onRequest).
interface BillableRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  json(body?: unknown): unknown;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * If the request carries an X-RapidAPI-Proxy-Secret header, it claims to come
 * from the RapidAPI gateway. Validate it (timing-safe) and return the house uid.
 * Present-but-invalid (or path unconfigured) → throws 401. Absent → null (caller
 * falls through to normal auth).
 */
export function tryResolveRapidApi(
  req: { headers: Record<string, string | string[] | undefined> }
): { uid: string } | null {
  const raw = req.headers["x-rapidapi-proxy-secret"];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (typeof provided !== "string") return null; // not a RapidAPI-proxied call

  const secret = process.env.PSG_RAPIDAPI_PROXY_SECRET || "";
  const houseUid = process.env.PSG_RAPIDAPI_HOUSE_UID || "";
  if (!secret || !houseUid || !timingSafeEqualStr(provided, secret)) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Request did not originate from the RapidAPI gateway."
    );
  }
  return { uid: houseUid };
}

/**
 * RapidAPI "Credits" charged per endpoint, in JackpotKeywords' convention of
 * 1 Credit = 1 US cent. Keyed by the internal dispatch path; absent = 0 (free).
 * These are relative per-call weights — the actual $/Credit and plan tiers are
 * set in the RapidAPI console (Monetize tab). Independent of internal credits
 * (RapidAPI traffic is billing-exempt here).
 */
const RAPIDAPI_CREDITS: Readonly<Record<string, number>> = {
  "/patent-dossier": 50,    // $0.50
  "/dossier-summary": 0,    // bundled
  "/claim-chart": 50,
  "/oa-analyze": 25,
  "/claims": 10,
  "/search-execute": 20,
  "/search-query": 10,
  // Legal intelligence — the premium draw
  "/challenges": 35,
  "/litigation": 35,
  "/company-litigation": 35,
  // Enrichment
  "/examiner-stats": 20,     // computed aggregation (pricing research 2026-06-07)
  "/legal-status": 10,
  "/assignments": 10,
  "/term": 10,
  "/prosecution-timeline": 10,
  "/attorney": 10,
  "/entity-status": 5,
  "/pregrant-pub": 15,
  "/legal-bundle": 75,      // all 9 per-patent legal slices in one call
  "/risk-profile": 90,      // legal-bundle + AI risk verdict (DD-1)
  // similar / citations / family / prosecution-history / cpc* = 0 (free)
};

export function rapidApiCreditsFor(path: string): number {
  return RAPIDAPI_CREDITS[path] ?? 0;
}

/**
 * Patch res.json so RapidAPI-sourced responses emit the X-RapidAPI-Billing
 * header at send time (after the status is known):
 *   2xx → Credits = the route's cost; non-2xx → Credits = 0 (don't bill the dev
 *   for their own bad input; RapidAPI ignores >=500 anyway — refund-on-failure).
 */
export function applyRapidApiBilling(res: BillableRes, path: string): void {
  const cost = rapidApiCreditsFor(path);
  const originalJson = res.json.bind(res);
  res.json = (body?: unknown) => {
    const credits = res.statusCode >= 200 && res.statusCode < 300 ? cost : 0;
    res.setHeader("X-RapidAPI-Billing", `Credits=${credits}`);
    return originalJson(body);
  };
}
