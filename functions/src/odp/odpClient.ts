/**
 * Low-level USPTO ODP HTTP client for the dossier data path.
 *
 * Wraps the Patent File Wrapper API (`https://api.uspto.gov/api/v1/patent/...`)
 * with the `X-API-KEY` header, a 20s timeout, and retry-with-backoff on the
 * throttle statuses ODP returns under load (429/5xx). Verified against ODP
 * 2026-05-31; the 60 req/key/min limit is real and was hit during probing,
 * hence the backoff.
 *
 * ODP-backed API/MCP path only — not used by the extension's Google Patents path.
 */

const ODP_BASE = "https://api.uspto.gov/api/v1/patent/applications";
const REQUEST_TIMEOUT_MS = 20000;
const THROTTLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_DELAYS_MS = [600, 1800];

export class OdpNotFoundError extends Error {
  constructor(what: string) {
    super(`Not found in USPTO ODP: ${what}`);
    this.name = "OdpNotFoundError";
  }
}

export class OdpAuthError extends Error {
  constructor() {
    super("USPTO ODP API key missing or rejected");
    this.name = "OdpAuthError";
  }
}

export class OdpRateLimitedError extends Error {
  constructor() {
    super("USPTO ODP is throttling requests (HTTP 429/5xx after retries)");
    this.name = "OdpRateLimitedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OdpRequestOpts {
  method?: string;
  /** JSON body — serialized and sent with Content-Type: application/json. */
  body?: unknown;
  accept?: string;
}

/**
 * Authenticated ODP request with retry on throttle statuses. Returns the
 * Response on a 2xx; throws OdpAuthError / OdpRateLimitedError. 404 is returned
 * to the caller (response.status === 404) so it can decide not-found vs empty.
 * Exported so the PTAB module (POST search) shares the same backoff + auth.
 */
export async function odpRequest(
  url: string,
  apiKey: string,
  opts: OdpRequestOpts = {}
): Promise<Response> {
  const { method = "GET", body, accept = "application/json" } = opts;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, {
      method,
      headers: {
        "X-API-KEY": apiKey,
        Accept: accept,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      throw new OdpAuthError();
    }
    if (response.ok || response.status === 404) {
      return response;
    }
    lastStatus = response.status;
    if (!THROTTLE_STATUSES.has(response.status)) {
      throw new Error(`USPTO ODP returned HTTP ${response.status} for ${url}`);
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  console.warn(`[ODP] Throttled after retries (last status ${lastStatus}) for ${url}`);
  throw new OdpRateLimitedError();
}

// ── Wrapper shapes (only the fields we consume) ────────────────────────

export interface OdpContinuityChild {
  parentApplicationNumberText?: string;
  childApplicationNumberText?: string;
  claimParentageTypeCode?: string;
  claimParentageTypeCodeDescriptionText?: string;
  childApplicationFilingDate?: string;
  childApplicationStatusDescriptionText?: string;
}

export interface OdpContinuityParent {
  parentApplicationNumberText?: string;
  childApplicationNumberText?: string;
  claimParentageTypeCode?: string;
  claimParentageTypeCodeDescriptionText?: string;
  parentApplicationFilingDate?: string;
  parentApplicationStatusDescriptionText?: string;
}

export interface OdpEvent {
  eventCode?: string;
  eventDescriptionText?: string;
  eventDate?: string;
}

export interface OdpWrapper {
  applicationNumberText?: string;
  applicationMetaData?: Record<string, unknown>;
  grantDocumentMetaData?: { fileLocationURI?: string };
  pgpubDocumentMetaData?: { fileLocationURI?: string };
  assignmentBag?: Array<Record<string, unknown>>;
  eventDataBag?: OdpEvent[];
  patentTermAdjustmentData?: Record<string, unknown>;
  recordAttorney?: Record<string, unknown>;
  childContinuityBag?: OdpContinuityChild[];
  parentContinuityBag?: OdpContinuityParent[];
}

interface OdpSearchResponse {
  count?: number;
  patentFileWrapperDataBag?: OdpWrapper[];
}

/**
 * Resolve a US patent number (digits only) to its file wrapper via the search
 * endpoint. The search response embeds the full wrapper — biblio, assignment,
 * grant-XML URI, and child continuity — so this single call covers most of the
 * dossier. Returns null when the patent isn't found.
 */
export async function searchByPatentNumber(
  patentDigits: string,
  apiKey: string
): Promise<OdpWrapper | null> {
  const url = `${ODP_BASE}/search?q=applicationMetaData.patentNumber:${encodeURIComponent(patentDigits)}`;
  const response = await odpRequest(url, apiKey);
  if (response.status === 404) return null;
  const body = (await response.json()) as OdpSearchResponse;
  const bag = body.patentFileWrapperDataBag;
  if (!bag || bag.length === 0) return null;
  return bag[0];
}

/**
 * Fetch the grant full-text XML. The `fileLocationURI` 302-redirects to a CDN
 * object; Node's fetch follows redirects by default. Returns the XML string.
 */
export async function fetchGrantXml(fileLocationUri: string, apiKey: string): Promise<string> {
  const response = await odpRequest(fileLocationUri, apiKey, { accept: "application/xml" });
  if (response.status === 404) {
    throw new OdpNotFoundError(`grant XML at ${fileLocationUri}`);
  }
  const xml = await response.text();
  if (!xml || xml.length < 200) {
    throw new Error(`Empty/short grant XML (${xml.length} bytes)`);
  }
  return xml;
}

/**
 * Fetch US continuity (parent + child applications). Best-effort: the dossier
 * still returns if this throws, so family degrades gracefully rather than
 * failing the whole request.
 */
export async function fetchContinuity(
  appNumber: string,
  apiKey: string
): Promise<{ parents: OdpContinuityParent[]; children: OdpContinuityChild[] }> {
  const url = `${ODP_BASE}/${encodeURIComponent(appNumber)}/continuity`;
  const response = await odpRequest(url, apiKey);
  if (response.status === 404) return { parents: [], children: [] };
  const body = (await response.json()) as OdpSearchResponse;
  const w = body.patentFileWrapperDataBag?.[0];
  return {
    parents: w?.parentContinuityBag ?? [],
    children: w?.childContinuityBag ?? [],
  };
}
