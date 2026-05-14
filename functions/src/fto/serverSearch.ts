/**
 * Server-side Google Patents search.
 *
 * Hits the XHR query endpoint that Google Patents' React app uses internally:
 *   https://patents.google.com/xhr/query?url=q%3D{query}%26num%3D{n}
 *
 * Returns structured JSON. Modeled after fetchPatentHtml in patentDossier.ts:
 *   - browser-realistic headers (no bot UA)
 *   - retry with exponential-ish backoff on 429/5xx
 *   - 20-second per-attempt timeout
 *
 * Endpoint format confirmed working 2026-05-13 via probe script.
 */

import { GOOGLE_PATENTS_HEADERS } from "../httpHeaders";

const THROTTLE_STATUSES = new Set([429, 502, 503, 504]);
// Search endpoint is more rate-sensitive than the patent-detail endpoint.
// Longer waits help us recover from 503 bursts that 3-second backoff couldn't clear.
const RETRY_DELAYS_MS = [2000, 5000, 12000];

export interface GpSearchResult {
  patentNumber: string;                // e.g. "US8418550B2"
  resourceId: string;                  // raw "patent/US8418550B2/en"
  title: string;
  snippet?: string;
  assignee?: string;
  inventor?: string;
  priorityDate?: string;
  filingDate?: string;
  grantDate?: string;
  publicationDate?: string;
  language?: string;
  /** Per-country active-status flags reported by Google. Phase-3 reuses this. */
  countryStatus: Array<{ country: string; active: boolean }>;
  /** Google's "is this really similar?" flag. False = broader recall hit. */
  isSimilarDocument: boolean;
}

class SearchThrottledError extends Error {
  upstreamStatus: number;
  constructor(query: string, upstreamStatus: number) {
    super(
      `Google Patents throttled search for "${query.slice(0, 80)}" (HTTP ${upstreamStatus})`
    );
    this.name = "SearchThrottledError";
    this.upstreamStatus = upstreamStatus;
  }
}

interface RawSearchResponse {
  results?: {
    total_num_results?: number;
    cluster?: Array<{
      result?: Array<{
        id?: string;
        rank?: number;
        is_similar_document?: boolean;
        patent?: {
          title?: string;
          snippet?: string;
          assignee?: string;
          inventor?: string;
          priority_date?: string;
          filing_date?: string;
          grant_date?: string;
          publication_date?: string;
          publication_number?: string;
          language?: string;
          family_metadata?: {
            aggregated?: {
              country_status?: Array<{
                country_code?: string;
                best_patent_stage?: { state?: string };
              }>;
            };
          };
        };
      }>;
    }>;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSearchResponse(raw: RawSearchResponse): GpSearchResult[] {
  const out: GpSearchResult[] = [];
  const clusters = raw.results?.cluster || [];
  for (const cluster of clusters) {
    for (const item of cluster.result || []) {
      const id = item.id || "";
      const p = item.patent;
      if (!id || !p) continue;
      const patentNumber = p.publication_number || id.replace(/^patent\//, "").replace(/\/[a-z]+$/i, "");
      const countryStatus =
        (p.family_metadata?.aggregated?.country_status || [])
          .filter((c) => c.country_code && c.best_patent_stage?.state)
          .map((c) => ({
            country: c.country_code as string,
            active: c.best_patent_stage?.state === "ACTIVE",
          }));
      out.push({
        patentNumber,
        resourceId: id,
        title: (p.title || "").trim(),
        snippet: p.snippet?.trim(),
        assignee: p.assignee?.trim(),
        inventor: p.inventor?.trim(),
        priorityDate: p.priority_date,
        filingDate: p.filing_date,
        grantDate: p.grant_date,
        publicationDate: p.publication_date,
        language: p.language,
        countryStatus,
        isSimilarDocument: item.is_similar_document !== false,
      });
    }
  }
  return out;
}

export interface SearchOptions {
  query: string;
  limit?: number;                      // default 30, capped at 100
}

export interface SearchOutcome {
  results: GpSearchResult[];
  fetched: number;                     // how many we successfully retrieved
  totalAvailable?: number;             // Google's reported total_num_results
  query: string;
}

export async function searchGooglePatents(
  opts: SearchOptions
): Promise<SearchOutcome> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const innerParams = `q=${opts.query}&num=${limit}`;
  const url = `https://patents.google.com/xhr/query?url=${encodeURIComponent(innerParams)}`;

  let lastStatus = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, {
      headers: GOOGLE_PATENTS_HEADERS,
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      const text = await response.text();
      let raw: RawSearchResponse;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        throw new Error(
          `Search response not JSON for "${opts.query.slice(0, 60)}": ${text.slice(0, 200)}`
        );
      }
      const results = parseSearchResponse(raw);
      return {
        results,
        fetched: results.length,
        totalAvailable: raw.results?.total_num_results,
        query: opts.query,
      };
    }
    lastStatus = response.status;
    if (!THROTTLE_STATUSES.has(response.status)) {
      throw new Error(
        `HTTP ${response.status} searching for "${opts.query.slice(0, 60)}"`
      );
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      const base = RETRY_DELAYS_MS[attempt];
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }
  throw new SearchThrottledError(opts.query, lastStatus);
}
