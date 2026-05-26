/**
 * /v1/search (execute mode) endpoint.
 *
 * End-to-end search: takes a natural-language description, generates queries
 * via existing AI endpoints (extract-concepts + generate-strategy-searches),
 * executes the top queries against Google Patents server-side, dedupes hits
 * by publication number, and returns ranked results.
 *
 * Upstream: https://patents.google.com/xhr/query?url=q%3D... (same domain as
 * the dossier XHR — uses the same browser-realistic headers).
 *
 * Cost: 1 credit per call (covers AI for concept extraction + query gen).
 * GP search execution itself adds no per-call cost on our side.
 */

import { handleAIRequest } from "./ai";
import { GOOGLE_PATENTS_HEADERS } from "./httpHeaders";

interface SearchHit {
  publicationNumber: string;
  title: string;
  snippet: string;
  assignee: string;
  inventor: string;
  priorityDate: string;
  publicationDate: string;
  countryCode: string;
  /** Which query (label) produced this hit first */
  foundByQueryLabel: string;
  /** Position in the GP results for that query (1-indexed) */
  rankInQuery: number;
}

interface ExecuteResult {
  description?: string;
  strategy?: string;
  concepts?: { name: string; synonyms: string[] }[];
  queries?: { label: string; query: string; hitCount: number }[];
  hits?: SearchHit[];
  totalHits?: number;
  warnings?: string[];
  error?: string;
  code?: "invalid_input" | "ai_failed" | "fetch_failed" | "rate_limited";
}

const MAX_QUERIES_TO_EXECUTE = 3;
const HITS_PER_QUERY = 30;

interface GoogleSearchResultItem {
  patent?: {
    publication_number?: string;
    title?: string;
    snippet?: string;
    assignee?: string | string[];
    inventor?: string | string[];
    priority_date?: string;
    publication_date?: string;
    country_code?: string;
  };
}

interface GoogleSearchResponse {
  results?: {
    cluster?: Array<{
      result?: GoogleSearchResultItem[];
    }>;
  };
  total_num_results?: number;
}

function joinList(v: string | string[] | undefined): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return v;
}

async function runOneGoogleSearch(
  query: string,
  label: string
): Promise<{ hits: SearchHit[]; warning?: string }> {
  const inner = `q=${encodeURIComponent(query)}&num=${HITS_PER_QUERY}`;
  const url = `https://patents.google.com/xhr/query?url=${encodeURIComponent(inner)}&exp=`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: GOOGLE_PATENTS_HEADERS,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { hits: [], warning: `[${label}] fetch failed: ${msg}` };
  }

  if (!response.ok) {
    return { hits: [], warning: `[${label}] upstream HTTP ${response.status}` };
  }

  let body: GoogleSearchResponse;
  try {
    body = await response.json() as GoogleSearchResponse;
  } catch (e) {
    return { hits: [], warning: `[${label}] response was not JSON` };
  }

  const clusters = body?.results?.cluster ?? [];
  const items: GoogleSearchResultItem[] = clusters.flatMap((c) => c.result ?? []);
  const hits: SearchHit[] = items.map((it, idx) => ({
    publicationNumber: (it.patent?.publication_number || "").trim(),
    title: (it.patent?.title || "").trim(),
    snippet: (it.patent?.snippet || "").trim(),
    assignee: joinList(it.patent?.assignee),
    inventor: joinList(it.patent?.inventor),
    priorityDate: (it.patent?.priority_date || "").trim(),
    publicationDate: (it.patent?.publication_date || "").trim(),
    countryCode: (it.patent?.country_code || "").trim(),
    foundByQueryLabel: label,
    rankInQuery: idx + 1,
  })).filter((h) => h.publicationNumber);

  return { hits };
}

interface ExtractedConcept {
  name: string;
  category?: string;
  importance?: string;
  modifiers?: string[];
  nouns?: string[];
  synonyms?: string[];
  enabled?: boolean;
}

interface StrategyQuery {
  label: string;
  query: string;
}

export async function handleSearchExecuteRequest(body: {
  description?: string;
  strategy?: string;
  limit?: number;
}): Promise<ExecuteResult> {
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length < 10) {
    return {
      error: "description must be at least 10 characters of natural-language invention/technology text",
      code: "invalid_input",
    };
  }

  const strategy = body.strategy === "telescoping" || body.strategy === "onion-ring" || body.strategy === "faceted"
    ? body.strategy
    : "telescoping";

  const limit = typeof body.limit === "number" && body.limit > 0
    ? Math.min(100, Math.floor(body.limit))
    : 20;

  const warnings: string[] = [];

  // Step 1 — extract concepts from the description
  let concepts: ExtractedConcept[];
  try {
    const extractResult = await handleAIRequest("/extract-concepts", { paragraph: description }) as { concepts?: ExtractedConcept[] };
    concepts = extractResult.concepts ?? [];
    if (concepts.length === 0) {
      return { error: "Failed to extract concepts from description", code: "ai_failed" };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Concept extraction failed: ${msg}`, code: "ai_failed" };
  }

  // The strategy generator expects {name, synonyms, category, importance, enabled}.
  // Concepts come back with modifiers + nouns; synthesize a synonyms array.
  const conceptsForStrategy = concepts.map((c) => ({
    name: c.name,
    category: c.category || "device",
    importance: c.importance || "medium",
    enabled: c.enabled !== false,
    synonyms: c.synonyms && c.synonyms.length > 0
      ? c.synonyms
      : [...(c.modifiers || []), ...(c.nouns || [])].filter(Boolean),
  }));

  // Step 2 — generate queries via the strategy
  let queries: StrategyQuery[];
  try {
    const strategyResult = await handleAIRequest("/generate-strategy-searches", {
      concepts: conceptsForStrategy,
      strategy,
    }) as { queries?: StrategyQuery[] };
    queries = (strategyResult.queries ?? []).filter((q) => q.query && q.label);
    if (queries.length === 0) {
      return { error: "Strategy returned no queries", code: "ai_failed" };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Query generation failed: ${msg}`, code: "ai_failed" };
  }

  // Step 3 — execute the top N queries against Google Patents
  const queriesToRun = queries.slice(0, MAX_QUERIES_TO_EXECUTE);
  const queryResults = await Promise.all(
    queriesToRun.map((q) => runOneGoogleSearch(q.query, q.label))
  );

  // Step 4 — dedupe by publication number, preserving the first label that found it
  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  const perQueryCounts: number[] = [];

  for (let i = 0; i < queryResults.length; i++) {
    const { hits, warning } = queryResults[i];
    if (warning) warnings.push(warning);
    perQueryCounts.push(hits.length);
    for (const h of hits) {
      if (seen.has(h.publicationNumber)) continue;
      seen.add(h.publicationNumber);
      merged.push(h);
    }
  }

  // Concept slim-down for the response
  const conceptsForResponse = conceptsForStrategy.map((c) => ({
    name: c.name,
    synonyms: c.synonyms,
  }));

  return {
    description,
    strategy,
    concepts: conceptsForResponse,
    queries: queriesToRun.map((q, i) => ({
      label: q.label,
      query: q.query,
      hitCount: perQueryCounts[i] ?? 0,
    })),
    hits: merged.slice(0, limit),
    totalHits: merged.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// Query-only mode — wraps /optimize-query, returns the optimized Boolean
// string without executing. Used by the `query` MCP tool.
export interface QueryOnlyResult {
  optimizedQuery?: string;
  reasoning?: string;
  error?: string;
  code?: "invalid_input" | "ai_failed";
}

export async function handleSearchQueryRequest(body: {
  description?: string;
}): Promise<QueryOnlyResult> {
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length < 10) {
    return {
      error: "description must be at least 10 characters of natural-language invention/technology text",
      code: "invalid_input",
    };
  }
  try {
    const result = await handleAIRequest("/optimize-query", { text: description }) as { optimizedQuery?: string; reasoning?: string };
    return {
      optimizedQuery: result.optimizedQuery || "",
      reasoning: result.reasoning || "",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Query optimization failed: ${msg}`, code: "ai_failed" };
  }
}
