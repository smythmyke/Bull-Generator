import { optimizeQuery, enrichNPL, EnrichedNPLItem, analyzeRound, AnalyzeRoundResponse, CPCSuggestion, TerminologySwap, ConceptHealth, generateStrategySearches, SearchStrategy, SearchDepth, StrategySearchQuery } from "../services/apiService";
import { ConceptForSearch, buildGroup } from "./conceptSearchBuilder";
import { buildTelescopingQueries, buildOnionRingQueries, buildFacetedQueries, getStrategyCreditCost } from "./searchStrategy";
import { mergeConcepts, MergeableConcept, MergeResult } from "./conceptMerger";
import { scoreConceptCoverage } from "./scoringUtils";

/** Thrown when Google Patents is unavailable (503, error pages, etc.) */
export class GoogleUnavailableError extends Error {
  queries: { label: string; query: string }[];
  creditsUsed: number;
  constructor(message: string, queries: { label: string; query: string }[], creditsUsed: number) {
    super(message);
    this.name = "GoogleUnavailableError";
    this.queries = queries;
    this.creditsUsed = creditsUsed;
  }
}

/**
 * Convert an Orbit/Quartet-syntax boolean query to Google Patents-compatible syntax.
 *
 * Strips: Orbit-only field prefixes (FT=, TAC=, CA=), country codes (AND CC=XX).
 * Preserves: Google Patents field operators (TI=, AB=, CL=), proximity (NEAR/N, ADJ/N, WITH, SAME),
 *   truncation wildcards ($ and *), AND, OR, NOT operators.
 * Converts: Orbit-only nD proximity → NEAR/N (Google Patents syntax).
 *   Orbit `*` (single-char wildcard) is left as-is; callers should prefer `$` for stemming.
 *
 * Note: Google Patents proximity + field operators are "not robust" per docs.
 *   Simple keyword proximity works. Complex nested field+proximity may not.
 */
export function sanitizeForGooglePatents(query: string): string {
  let q = query;

  // Extract CPC codes before stripping field prefixes
  const cpcCodes: string[] = [];
  q = q.replace(/\bCPC\s*=\s*([A-Z]\d{2}[A-Z]?\d{0,4}(?:\/\d+)?)/gi, (_match, code) => {
    cpcCodes.push(code);
    return "";
  });

  // Remove Orbit-only field prefixes (FT=fulltext, TAC=title+abstract+claims, CA=assignee)
  // Preserve Google Patents field operators: TI=, AB=, CL=
  q = q.replace(/\b(?:FT|TAC|CA)\s*=/gi, "");

  // Remove country code clause: AND CC=XX (with optional parens/spaces)
  q = q.replace(/\s+AND\s+CC\s*=\s*[A-Z]{2}/gi, "");

  // Convert Orbit nD proximity → NEAR/N (Google Patents syntax)
  q = q.replace(/\s+(\d+)D\s+/gi, (_match, n) => ` NEAR/${n} `);

  // Clean up double spaces and stray parens
  q = q.replace(/\(\s*\)/g, "");
  q = q.replace(/\s{2,}/g, " ");
  q = q.trim();

  // Append extracted CPC codes using Google Patents cpc:() syntax
  if (cpcCodes.length > 0) {
    const cpcClause = `cpc:(${cpcCodes.join(" OR ")})`;
    q = q ? `${q} AND ${cpcClause}` : cpcClause;
  }

  return q;
}

/**
 * Enforce reasonable query complexity limits for Google Patents.
 * Empirical testing (March 2026) confirmed:
 *   - 5 AND groups + 5 OR terms/group works reliably
 *   - No documented hard limit on AND groups up to 5+
 *   - 8 OR terms per group works fine
 * Conservative limits to avoid rate-limiting on very complex queries:
 *   - Max 5 AND groups, max 20 total OR operators
 * Also deduplicates redundant quoted/unquoted terms.
 */
export function enforceGooglePatentsLimits(query: string): string {
  let q = query.trim();

  // Split on top-level AND operators
  const andPattern = /\s+AND\s+/gi;
  const parts: string[] = [];
  const operators: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  andPattern.lastIndex = 0;
  while ((match = andPattern.exec(q)) !== null) {
    parts.push(q.slice(lastIndex, match.index).trim());
    operators.push("AND");
    lastIndex = match.index + match[0].length;
  }
  parts.push(q.slice(lastIndex).trim());

  // Filter out empty parts
  const realParts: { text: string; op: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cleaned = parts[i].trim();
    if (!cleaned) continue;
    realParts.push({ text: cleaned, op: i > 0 ? (operators[i - 1] || "AND") : "" });
  }

  // Tested March 2026: 6-8 AND groups work on Google Patents (curl + extension)
  const MAX_AND_GROUPS = 10;
  const MAX_TOTAL_OR = 40;

  console.log(`[PSG-Enforcer] Input groups: ${realParts.length}`);
  realParts.forEach((p, i) => {
    const orCount = (p.text.match(/\sOR\s/gi) || []).length;
    console.log(`[PSG-Enforcer]   group[${i}]: ${orCount} ORs, text="${p.text.substring(0, 80)}${p.text.length > 80 ? '...' : ''}"`);
  });

  if (realParts.length > MAX_AND_GROUPS) {
    console.warn(`[PSG-Enforcer] Trimming from ${realParts.length} to ${MAX_AND_GROUPS} AND groups`);
  }
  const limitedParts = realParts.slice(0, MAX_AND_GROUPS);

  // Process each group: deduplicate OR terms
  const processedGroups = limitedParts.map(part => {
    let groupText = part.text;

    // Strip outer parens
    const hasParens = groupText.startsWith("(") && groupText.endsWith(")");
    if (hasParens) groupText = groupText.slice(1, -1);

    // Split on OR
    const orTerms = groupText.split(/\s+OR\s+/i).map(t => t.trim()).filter(Boolean);

    if (orTerms.length > 1) {
      // Deduplicate: normalize by removing quotes and wildcards, keep best version
      const seen = new Map<string, string>();
      for (const term of orTerms) {
        const normalized = term.replace(/["$*]/g, "").toLowerCase().trim();
        if (!seen.has(normalized)) {
          seen.set(normalized, term);
        } else {
          const existing = seen.get(normalized)!;
          // Prefer truncated version ($) over exact, then * over exact
          if ((term.includes("$") && !existing.includes("$")) ||
              (term.includes("*") && !existing.includes("*") && !existing.includes("$"))) {
            seen.set(normalized, term);
          }
        }
      }
      return { ...part, terms: Array.from(seen.values()) };
    }

    // Not an OR group — single term
    return { ...part, terms: [hasParens ? `(${groupText})` : groupText] };
  });

  // Enforce total OR budget: distribute OR slots across groups
  let totalOrTerms = processedGroups.reduce((sum, g) => sum + g.terms.length, 0);
  const totalOrOps = totalOrTerms - processedGroups.length; // each group uses (terms-1) OR operators

  if (totalOrOps > MAX_TOTAL_OR) {
    console.warn(`[PSG-Enforcer] Total OR operators: ${totalOrOps}, exceeds budget of ${MAX_TOTAL_OR}. Trimming terms.`);

    // Distribute OR budget proportionally across groups
    const numGroups = processedGroups.length;
    // Each group gets at least 1 term, remaining OR budget distributed evenly
    const maxTermsPerGroup = Math.max(2, Math.floor((MAX_TOTAL_OR + numGroups) / numGroups));

    for (const group of processedGroups) {
      if (group.terms.length > maxTermsPerGroup) {
        console.log(`[PSG-Enforcer]   Trimming group from ${group.terms.length} to ${maxTermsPerGroup} terms`);
        group.terms = group.terms.slice(0, maxTermsPerGroup);
      }
    }
  }

  // Reassemble groups
  const assembledGroups = processedGroups.map(g => {
    if (g.terms.length === 1) return { ...g, text: g.terms[0] };
    return { ...g, text: `(${g.terms.join(" OR ")})` };
  });

  let result = assembledGroups[0]?.text || "";
  for (let i = 1; i < assembledGroups.length; i++) {
    result += ` AND ${assembledGroups[i].text}`;
  }


  // Final cleanup
  result = result.replace(/\s{2,}/g, " ").trim();

  // Count final structure for diagnostics
  const finalAndCount = (result.match(/\sAND\s/gi) || []).length + 1;
  const finalOrCount = (result.match(/\sOR\s/gi) || []).length;
  console.log(`[PSG-Enforcer] Output: ${finalAndCount} groups, ${finalOrCount} total OR operators, len=${result.length}ch`);

  return result;
}

// BigQuery enrichment removed — was costing too much. Deep scrape provides CPC/claims data instead.

/** Ensure Google Patents tab exists, return its ID */
export async function ensurePatentsTab(): Promise<number> {
  console.log("[PSG] ensurePatentsTab: querying for existing Google Patents tabs...");
  const tabs = await chrome.tabs.query({ url: "https://patents.google.com/*" });
  console.log(
    `[PSG] ensurePatentsTab: found ${tabs.length} existing tabs`,
    tabs.map((t) => ({ id: t.id, url: t.url, status: t.status }))
  );

  if (tabs.length > 0 && tabs[0].id) {
    console.log(`[PSG] ensurePatentsTab: reusing existing tab ${tabs[0].id} (url: ${tabs[0].url})`);
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }

  console.log("[PSG] ensurePatentsTab: no existing tab, creating new one...");
  const newTab = await chrome.tabs.create({ url: "https://patents.google.com/?num=100" });
  const tabId = newTab.id!;
  console.log(`[PSG] ensurePatentsTab: created tab ${tabId}, waiting for load...`);

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[PSG] ensurePatentsTab: tab ${tabId} load TIMED OUT after 20s`);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        console.log(`[PSG] ensurePatentsTab: tab ${tabId} load complete`);
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  console.log(`[PSG] ensurePatentsTab: returning tab ${tabId}`);
  return tabId;
}

/** Verify tab still exists and is on Google Patents */
export async function verifyTab(tabId: number, label: string): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const isPatents = tab.url?.startsWith("https://patents.google.com");
    console.log(
      `[PSG] verifyTab(${label}): tab ${tabId} exists, url=${tab.url}, status=${tab.status}, isPatents=${isPatents}`
    );
    if (!isPatents) {
      console.error(`[PSG] verifyTab(${label}): TAB NAVIGATED AWAY from Google Patents!`);
    }
    return !!isPatents;
  } catch (err) {
    console.error(`[PSG] verifyTab(${label}): tab ${tabId} NO LONGER EXISTS`, err);
    return false;
  }
}

/** Run a single search on Google Patents and scrape results */
export interface SingleSearchResult {
  results: any[];
  googleUnavailable: boolean;
  reason?: string;
}

/** Full single search returning results + Google availability status */
async function runSingleSearchFull(
  tabId: number,
  query: string,
  limit: number = 35
): Promise<SingleSearchResult> {
  const searchLabel = query.substring(0, 60) + (query.length > 60 ? "..." : "");
  console.log(`[PSG] runSingleSearch: START query="${searchLabel}", tabId=${tabId}, limit=${limit}`);
  console.log(`[PSG] runSingleSearch: FULL QUERY (${query.length}ch): ${query}`);

  // Verify tab is still valid before sending message
  const tabValid = await verifyTab(tabId, "pre-search");
  if (!tabValid) {
    console.error("[PSG] runSingleSearch: tab invalid before search, aborting");
    return { results: [], googleUnavailable: false };
  }

  // Trigger search
  console.log(`[PSG] runSingleSearch: sending SEARCH_PATENTS message...`);
  try {
    const searchResponse = await chrome.tabs.sendMessage(tabId, { type: "SEARCH_PATENTS", query });
    console.log(`[PSG] runSingleSearch: SEARCH_PATENTS response:`, searchResponse);
  } catch (err) {
    console.error(`[PSG] runSingleSearch: SEARCH_PATENTS message FAILED:`, err);
    return { results: [], googleUnavailable: false };
  }

  // Wait for results page to load
  console.log(`[PSG] runSingleSearch: waiting for page load (15s timeout)...`);
  let loadMethod = "unknown";
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      loadMethod = "timeout";
      console.warn(`[PSG] runSingleSearch: page load TIMED OUT after 15s`);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId) {
        console.log(
          `[PSG] runSingleSearch: tab ${tabId} update event: status=${info.status}, url=${info.url || "(unchanged)"}`
        );
        if (info.status === "complete") {
          loadMethod = "complete";
          console.log(`[PSG] runSingleSearch: page load COMPLETE`);
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  console.log(`[PSG] runSingleSearch: page load resolved via: ${loadMethod}`);

  // Verify tab after navigation
  const tabStillValid = await verifyTab(tabId, "post-navigation");
  if (!tabStillValid) {
    console.error("[PSG] runSingleSearch: tab invalid after navigation, aborting");
    return { results: [], googleUnavailable: false };
  }

  // Poll for results immediately — no hard sleep, use short interval then back off
  let attempts = 0;
  const maxAttempts = 20;
  console.log(`[PSG] runSingleSearch: starting poll (max ${maxAttempts} attempts, adaptive interval)...`);

  let googleUnavailable = false;
  let unavailableReason = "";

  const poll = async (): Promise<any[]> => {
    attempts++;
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_RESULTS", limit });
      console.log(
        `[PSG] runSingleSearch: poll #${attempts} response: status=${response?.status}, count=${response?.count}`
      );
      if (response?.status === "ok" && response.count > 0) {
        console.log(
          `[PSG] runSingleSearch: SUCCESS - scraped ${response.count} results after ${attempts} attempts`
        );
        return response.results;
      }
      if (response?.status === "ok" && response.noResults) {
        console.log(`[PSG] runSingleSearch: "No results found" detected in DOM, skipping further polls`);
        return [];
      }
      if (response?.status === "google-unavailable") {
        console.error(`[PSG] runSingleSearch: Google Patents unavailable: ${response.reason}`);
        googleUnavailable = true;
        unavailableReason = response.reason || "Google Patents is temporarily unavailable";
        return [];
      }
      if (response?.status === "error") {
        console.error(`[PSG] runSingleSearch: poll #${attempts} SCRAPE error:`, response.error);
      }
    } catch (err) {
      console.warn(`[PSG] runSingleSearch: poll #${attempts} sendMessage FAILED:`, err);
    }

    if (attempts < maxAttempts) {
      // Short interval for first 3 attempts (DOM likely ready), then back off
      const delay = attempts <= 3 ? 300 : 500;
      await new Promise((r) => setTimeout(r, delay));
      return poll();
    }

    console.warn(`[PSG] runSingleSearch: EXHAUSTED all ${maxAttempts} poll attempts, returning empty`);
    return [];
  };

  const results = await poll();
  console.log(`[PSG] runSingleSearch: END - returning ${results.length} results for query="${searchLabel}"`);
  return { results, googleUnavailable, reason: unavailableReason };
}

/**
 * Public runSingleSearch — returns just the results array for most callers.
 * Use runSingleSearchFull() internally when you need Google availability status.
 */
export async function runSingleSearch(
  tabId: number,
  query: string,
  limit: number = 35
): Promise<any[]> {
  const result = await runSingleSearchFull(tabId, query, limit);
  return result.results;
}

export interface TripleSearchParams {
  rawText: string;
  booleanQuery: string;
  includeNPL: boolean;
  concepts?: { name: string; synonyms: string[] }[];
  onProgress?: (msg: string) => void;
}

/** Full triple-search pipeline orchestrator */
export async function runTripleSearch(params: TripleSearchParams): Promise<void> {
  const { rawText, booleanQuery, includeNPL, concepts: paramConcepts, onProgress } = params;

  console.log(`[PSG] ========== TRIPLE SEARCH START ==========`);
  console.log(`[PSG] runTripleSearch: rawText="${rawText.substring(0, 80)}..."`);
  console.log(`[PSG] runTripleSearch: booleanQuery="${booleanQuery.substring(0, 80)}..."`);

  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];
  onProgress?.("Preparing triple search...");

  // Step 0: Get tab
  console.log("[PSG] Step 0: Getting Google Patents tab...");
  const tabId = await ensurePatentsTab();
  console.log(`[PSG] Step 0: Got tab ${tabId}`);

  // Ensure search config
  console.log(`[PSG] Step 0b: Sending ENSURE_SEARCH_CONFIG (includeNPL=${includeNPL})...`);
  try {
    const configResponse = await chrome.tabs.sendMessage(tabId, {
      type: "ENSURE_SEARCH_CONFIG",
      includeNPL,
    });
    console.log("[PSG] Step 0b: ENSURE_SEARCH_CONFIG response:", configResponse);
  } catch (err) {
    console.warn("[PSG] Step 0b: ENSURE_SEARCH_CONFIG failed (may be expected on landing page):", err);
  }

  // Step 1: Raw text search + AI optimization in parallel
  console.log("[PSG] Step 1: Starting raw text search + AI optimization in parallel...");
  onProgress?.("Search 1/3: User's raw text...");

  const optimizeStart = Date.now();
  const [optimizedResult, search1] = await Promise.all([
    optimizeQuery(rawText)
      .then((r) => {
        console.log(
          `[PSG] Step 1: AI optimization complete (${Date.now() - optimizeStart}ms): query="${r.optimizedQuery?.substring(0, 80)}..."`
        );
        return r;
      })
      .catch((err) => {
        console.error(`[PSG] Step 1: AI optimization FAILED (${Date.now() - optimizeStart}ms):`, err);
        return { optimizedQuery: "", reasoning: "" };
      }),
    runSingleSearchFull(tabId, rawText, 35),
  ]);
  const search1Count = search1.results.length;
  console.log(`[PSG] Step 1 COMPLETE: ${search1Count} results from raw text search`);
  searchLog.push({ round: 1, label: "Raw text", query: rawText, resultCount: search1Count, durationMs: Date.now() - optimizeStart });

  // Track Google unavailability across all searches
  let googleUnavailableCount = 0;
  if (search1.googleUnavailable) googleUnavailableCount++;

  // Verify tab before search 2
  const tabOkForSearch2 = await verifyTab(tabId, "between-search-1-and-2");
  if (!tabOkForSearch2) {
    throw new Error("Tab lost between search 1 and 2");
  }

  // Step 2: Boolean search string (sanitized for Google Patents)
  const gpBooleanQuery = sanitizeForGooglePatents(booleanQuery);
  console.log(`[PSG] Step 2: Starting boolean search...`);
  console.log(`[PSG] Step 2: original="${booleanQuery.substring(0, 100)}..."`);
  console.log(`[PSG] Step 2: sanitized="${gpBooleanQuery.substring(0, 100)}..."`);
  onProgress?.(`Search 2/3: Boolean query... (${search1Count} from search 1)`);
  const s2Start = Date.now();
  const search2 = await runSingleSearchFull(tabId, gpBooleanQuery, 35);
  const search2Count = search2.results.length;
  console.log(`[PSG] Step 2 COMPLETE: ${search2Count} results from boolean search`);
  searchLog.push({ round: 1, label: "Boolean", query: gpBooleanQuery, resultCount: search2Count, durationMs: Date.now() - s2Start });
  if (search2.googleUnavailable) googleUnavailableCount++;

  // Step 3: AI-optimized query
  let search3: SingleSearchResult = { results: [], googleUnavailable: false };
  let search3Count = 0;
  if (optimizedResult.optimizedQuery) {
    const tabOkForSearch3 = await verifyTab(tabId, "between-search-2-and-3");
    if (!tabOkForSearch3) {
      throw new Error("Tab lost between search 2 and 3");
    }

    console.log(
      `[PSG] Step 3: Starting AI-optimized search... query="${optimizedResult.optimizedQuery.substring(0, 80)}..."`
    );
    onProgress?.(`Search 3/3: AI-optimized query... (${search1Count + search2Count} so far)`);
    const s3Start = Date.now();
    search3 = await runSingleSearchFull(tabId, optimizedResult.optimizedQuery, 35);
    search3Count = search3.results.length;
    console.log(`[PSG] Step 3 COMPLETE: ${search3Count} results from AI-optimized search`);
    searchLog.push({ round: 1, label: "AI-optimized", query: optimizedResult.optimizedQuery, resultCount: search3Count, durationMs: Date.now() - s3Start });
    if (search3.googleUnavailable) googleUnavailableCount++;
  } else {
    console.warn("[PSG] Step 3: SKIPPED (no AI-optimized query available)");
    onProgress?.("Search 3/3: Skipped (optimization failed)");
    searchLog.push({ round: 1, label: "AI-optimized", query: "(skipped — optimization failed)", resultCount: 0 });
  }

  // Check if Google Patents was unavailable for all searches
  const totalSearches = optimizedResult.optimizedQuery ? 3 : 2;
  if (googleUnavailableCount >= totalSearches) {
    const queries = [
      { label: "Raw Text", query: rawText },
      { label: "Boolean", query: gpBooleanQuery },
    ];
    if (optimizedResult.optimizedQuery) {
      queries.push({ label: "AI-Optimized", query: optimizedResult.optimizedQuery });
    }
    throw new GoogleUnavailableError(
      "Google Patents is temporarily unavailable. Your generated queries are shown below.",
      queries,
      1 // 1 credit used for the optimizeQuery AI call
    );
  }

  // Step 4: Deduplicate by patentId and track sources
  console.log(`[PSG] Step 4: Deduplicating... raw=${search1Count}, boolean=${search2Count}, ai=${search3Count}`);
  onProgress?.("Deduplicating results...");
  const patentMap = new Map<string, any & { foundBy: string[] }>();

  const addResults = (results: any[], source: string) => {
    let added = 0;
    let merged = 0;
    for (const patent of results) {
      const id = patent.patentId;
      if (!id) {
        console.warn(`[PSG] Step 4: patent with no ID from ${source}:`, patent.title);
        continue;
      }
      if (patentMap.has(id)) {
        patentMap.get(id)!.foundBy.push(source);
        merged++;
      } else {
        patentMap.set(id, { ...patent, foundBy: [source] });
        added++;
      }
    }
    console.log(`[PSG] Step 4: ${source} -> ${added} new, ${merged} merged`);
  };

  addResults(search1.results, "raw-text");
  addResults(search2.results, "boolean");
  addResults(search3.results, "ai-optimized");

  const uniquePatents = Array.from(patentMap.values());
  const totalFound = search1Count + search2Count + search3Count;
  console.log(
    `[PSG] Step 4 COMPLETE: ${uniquePatents.length} unique patents (${totalFound} total, ${totalFound - uniquePatents.length} dupes)`
  );

  if (uniquePatents.length === 0) {
    console.error("[PSG] Step 4: NO RESULTS from any search - aborting");
    onProgress?.("");
    throw new Error("No results found across all 3 searches.");
  }

  // Step 5: Deep scrape patents + enrich NPL in parallel
  const nplItems = uniquePatents.filter((p: any) => p.countries?.includes("NPL"));
  const patentItems = uniquePatents.filter((p: any) => !p.countries?.includes("NPL"));
  console.log(
    `[PSG] Step 5: Deep scraping ${patentItems.length} patents + enriching ${nplItems.length} NPL in parallel...`
  );
  onProgress?.(`Processing ${patentItems.length} patents + ${nplItems.length} publications...`);

  const tabOkForDeep = await verifyTab(tabId, "pre-deep-scrape");
  if (!tabOkForDeep) {
    throw new Error("Tab lost before deep scrape");
  }

  const [deepResponse, nplEnrichResult] = await Promise.all([
    (async () => {
      try {
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: "DEEP_SCRAPE",
          patents: patentItems,
        });
        console.log(
          `[PSG] Step 5a: DEEP_SCRAPE response: status=${resp?.status}, resultCount=${resp?.results?.length}`
        );
        return resp;
      } catch (err) {
        console.error("[PSG] Step 5a: DEEP_SCRAPE sendMessage FAILED:", err);
        return { status: "error", error: String(err), results: [] };
      }
    })(),
    (async () => {
      if (nplItems.length === 0) return { enriched: [] };
      try {
        const items = nplItems.map((p: any) => ({
          patentId: p.patentId,
          title: p.title,
          doi: p.doi || undefined,
        }));
        console.log(`[PSG] Step 5b: Enriching ${items.length} NPL items...`);
        const result = await enrichNPL(items);
        console.log(
          `[PSG] Step 5b: NPL enrichment complete:`,
          result.enriched.map(
            (e: EnrichedNPLItem) => `${e.patentId}: ${e.enrichedVia}, citations=${e.citationCount}`
          )
        );
        return result;
      } catch (err) {
        console.error("[PSG] Step 5b: NPL enrichment FAILED:", err);
        return { enriched: [] };
      }
    })(),
  ]);

  if (deepResponse?.status !== "ok" && patentItems.length > 0) {
    console.error("[PSG] Step 5: DEEP_SCRAPE returned non-ok status:", deepResponse);
    throw new Error(`Deep scrape failed: ${deepResponse?.error || "unknown"}`);
  }

  // Merge deep-scraped patents with foundBy
  const deepPatents = (deepResponse?.results || []).map((dp: any) => ({
    ...dp,
    foundBy: patentMap.get(dp.patentId)?.foundBy || ["unknown"],
  }));

  // Merge enriched NPL with original data
  const enrichedMap = new Map<string, EnrichedNPLItem>();
  for (const e of nplEnrichResult.enriched || []) {
    enrichedMap.set(e.patentId, e);
  }
  const enrichedNPLPatents = nplItems.map((npl: any) => {
    const enrichment = enrichedMap.get(npl.patentId);
    return {
      ...npl,
      fullAbstract: enrichment?.fullAbstract || npl.abstract || "",
      cpcCodes: [],
      firstClaim: "",
      citationCount: enrichment?.citationCount || 0,
      venue: enrichment?.venue || "",
      doi: enrichment?.doi || npl.doi || "",
      fieldsOfStudy: enrichment?.fieldsOfStudy || [],
      enrichedVia: enrichment?.enrichedVia || "none",
      foundBy: patentMap.get(npl.patentId)?.foundBy || ["unknown"],
    };
  });

  const allPatents = [...deepPatents, ...enrichedNPLPatents];
  console.log(
    `[PSG] Step 5 COMPLETE: ${deepPatents.length} patents + ${enrichedNPLPatents.length} NPL enriched (${enrichedNPLPatents.filter((n: any) => n.enrichedVia !== "none").length} successfully)`
  );

  const bqEnrichedPatents = allPatents; // BigQuery removed — deep scrape provides enrichment

  // Step 6: Store results and open results page
  console.log("[PSG] Step 6: Storing results and opening results page...");
  onProgress?.("Opening results page...");

  const storagePayload = {
    patentResults: {
      query: rawText,
      patents: bqEnrichedPatents,
      totalAvailable: 100,
      page: 1,
      concepts: paramConcepts,
      searchMeta: {
        mode: 'quick' as const,
        rawTextCount: search1Count,
        booleanCount: search2Count,
        aiOptimizedCount: search3Count,
        uniqueCount: uniquePatents.length,
        aiQuery: optimizedResult.optimizedQuery,
        searchLog,
        totalDurationMs: Date.now() - searchStartTime,
      },
    },
  };
  console.log(`[PSG] Step 6: Storage payload size: ${JSON.stringify(storagePayload).length} bytes`);

  await chrome.storage.local.set(storagePayload);
  console.log("[PSG] Step 6: Data stored in chrome.storage.local");

  const resultsTab = await chrome.tabs.create({
    url: chrome.runtime.getURL("results.html"),
    active: true,
  });
  if (resultsTab.id) {
    await chrome.tabs.update(resultsTab.id, { active: true });
    if (resultsTab.windowId) {
      await chrome.windows.update(resultsTab.windowId, { focused: true });
    }
  }
  console.log(`[PSG] Step 6: Results page opened in tab ${resultsTab.id}`);

  onProgress?.("Done!");
  console.log(`[PSG] ========== TRIPLE SEARCH COMPLETE ==========`);
}

// ── Unified Telescoping Search ──

export interface UnifiedTelescopingParams {
  rawText: string;
  broadQuery: string;
  moderateQuery: string;
  narrowQuery: string;
  enabledQueries: { raw: boolean; broad: boolean; moderate: boolean; narrow: boolean; aiOptimized: boolean };
  concepts: { name: string; synonyms: string[] }[];
  originalParagraph: string;
  onProgress: (progress: ProSearchProgress) => void;
  cachedAiQuery?: string;
}

export interface UnifiedTelescopingResult {
  aiOptimizedQuery?: string;
}

export async function runUnifiedTelescopingSearch(params: UnifiedTelescopingParams): Promise<UnifiedTelescopingResult> {
  const { rawText, broadQuery, moderateQuery, narrowQuery, enabledQueries, concepts, originalParagraph, onProgress, cachedAiQuery } = params;

  console.log(`[PSG-Unified] ========== UNIFIED TELESCOPING START ==========`);

  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];

  // Count enabled queries for progress
  const enabledCount = Object.values(enabledQueries).filter(Boolean).length;
  let searchIndex = 0;

  // Step 0: Get tab
  onProgress({ phase: "round1", message: "Opening Google Patents...", percent: 2 });
  const tabId = await ensurePatentsTab();
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SEARCH_CONFIG", includeNPL: true });
  } catch { /* may fail on landing page */ }

  // Step 1: Start AI optimization in parallel if needed
  let aiQueryPromise: Promise<string | null> | null = null;
  if (enabledQueries.aiOptimized && !cachedAiQuery) {
    aiQueryPromise = optimizeQuery(originalParagraph)
      .then(r => r.optimizedQuery || null)
      .catch(err => { console.error("[PSG-Unified] AI optimization failed:", err); return null; });
  }
  const aiQuery = cachedAiQuery || null;

  const allResultSets: ResultSet[] = [];
  let googleUnavailableCount = 0;
  let totalSearchCount = 0;

  // Helper to run a single query
  const runQuery = async (label: string, query: string, isRaw = false) => {
    searchIndex++;
    const pct = 5 + Math.round((searchIndex / enabledCount) * 55);
    onProgress({ phase: "round1", message: `Search ${searchIndex}/${enabledCount}: ${label}...`, percent: pct });

    const tabOk = await verifyTab(tabId, `unified-${label}`);
    if (!tabOk) return;

    const start = Date.now();
    totalSearchCount++;
    const finalQuery = isRaw ? query : enforceGooglePatentsLimits(sanitizeForGooglePatents(query));
    const searchResult = await runSingleSearchFull(tabId, finalQuery, 35);
    if (searchResult.googleUnavailable) googleUnavailableCount++;
    const results = searchResult.results;
    searchLog.push({ round: 1, label, query: finalQuery, resultCount: results.length, durationMs: Date.now() - start });

    if (results.length > 0) {
      allResultSets.push({ results, source: `round1-${label}` as ProFoundBySource });
    }
    console.log(`[PSG-Unified] ${label}: ${results.length} results`);
  };

  // Step 2: Run enabled queries sequentially
  if (enabledQueries.raw) await runQuery("Raw text", rawText, true);
  if (enabledQueries.broad) await runQuery("Broad", broadQuery);
  if (enabledQueries.moderate) await runQuery("Moderate", moderateQuery);
  if (enabledQueries.narrow) await runQuery("Narrow", narrowQuery);

  // Resolve AI query
  let resolvedAiQuery = aiQuery;
  if (enabledQueries.aiOptimized) {
    if (aiQueryPromise) {
      resolvedAiQuery = await aiQueryPromise;
    }
    if (resolvedAiQuery && resolvedAiQuery.length > 10) {
      await runQuery("AI-optimized", resolvedAiQuery);
    } else {
      console.warn("[PSG-Unified] AI optimization produced no usable query, skipping");
    }
  }

  // Check Google availability
  if (totalSearchCount > 0 && googleUnavailableCount >= totalSearchCount) {
    throw new Error("Google Patents is temporarily unavailable. Please try again later.");
  }

  // Step 3: Deduplicate
  onProgress({ phase: "deep-scrape", message: "Deduplicating results...", percent: 65 });
  const mergedMap = deduplicatePatents(allResultSets);
  console.log(`[PSG-Unified] Merged: ${mergedMap.size} unique patents from ${totalSearchCount} searches`);

  if (mergedMap.size === 0) {
    throw new Error("No results found. Try adjusting your concepts or enabling more queries.");
  }

  // Step 4: Deep scrape
  onProgress({ phase: "deep-scrape", message: `Deep scraping ${mergedMap.size} patents...`, percent: 70 });
  const allFinalPatents = await deepScrapeAndEnrich(tabId, mergedMap, new Set(), (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 80 });
  });

  // Step 5: Store results
  onProgress({ phase: "done", message: "Opening results page...", percent: 90 });
  const storagePayload = {
    patentResults: {
      query: originalParagraph,
      patents: allFinalPatents,
      totalAvailable: 100,
      page: 1,
      concepts,
      searchMeta: {
        mode: 'quick' as const,
        strategy: 'telescoping',
        searchLog,
        totalSearches: totalSearchCount,
        uniquePatents: mergedMap.size,
        durationMs: Date.now() - searchStartTime,
      },
    },
  };

  await chrome.storage.local.set(storagePayload);
  console.log(`[PSG-Unified] Stored ${allFinalPatents.length} patents`);

  // Open results page
  const resultsUrl = chrome.runtime.getURL("results.html");
  const existingTabs = await chrome.tabs.query({ url: resultsUrl });
  if (existingTabs.length > 0 && existingTabs[0].id) {
    await chrome.tabs.update(existingTabs[0].id, { active: true });
    await chrome.tabs.reload(existingTabs[0].id);
  } else {
    await chrome.tabs.create({ url: resultsUrl, active: true });
  }

  onProgress({ phase: "done", message: "Done!", percent: 100 });
  console.log(`[PSG-Unified] ========== UNIFIED TELESCOPING COMPLETE (${Date.now() - searchStartTime}ms) ==========`);

  return { aiOptimizedQuery: resolvedAiQuery || undefined };
}

// ── Pro Search Types ──

export type ProFoundBySource =
  | 'raw-text' | 'boolean' | 'ai-optimized'
  | 'round1-raw' | 'round1-boolean' | 'round1-ai'
  | 'round2-refined' | 'round3-narrow'
  | `similar-${string}`;

export interface ProSearchProgress {
  phase: string;   // "round1" | "analyzing" | "similarity" | "round2" | "round3" | "deep-scrape" | "done"
  message: string;
  percent: number;  // 0-100
}

export interface RefinementDashboardData {
  roundNumber: number;
  patents: any[];
  cpcSuggestions: CPCSuggestion[];
  terminologySwaps: TerminologySwap[];
  conceptHealth: ConceptHealth[];
}

export interface UserRefinementSelections {
  selectedPatentIds: string[];
  selectedCPCCodes: string[];
  acceptedTermSwaps: TerminologySwap[];
  updatedConcepts: ConceptForSearch[];
}

// ── Shared Helpers ──

interface ResultSet {
  results: any[];
  source: ProFoundBySource;
}

/** Deduplicate patents across multiple result sets, tracking foundBy sources */
export function deduplicatePatents(resultSets: ResultSet[]): Map<string, any & { foundBy: string[] }> {
  const patentMap = new Map<string, any & { foundBy: string[] }>();

  for (const { results, source } of resultSets) {
    for (const patent of results) {
      const id = patent.patentId;
      if (!id) continue;
      if (patentMap.has(id)) {
        const existing = patentMap.get(id)!;
        if (!existing.foundBy.includes(source)) {
          existing.foundBy.push(source);
        }
      } else {
        patentMap.set(id, { ...patent, foundBy: [source] });
      }
    }
  }

  return patentMap;
}

/**
 * Select diverse similarity anchors by picking patents from different search sources.
 */
function selectDiverseAnchors(patents: any[], count: number): string[] {
  if (patents.length <= count) return patents.map((p: any) => p.patentId);

  const bySource = new Map<string, any[]>();
  for (const p of patents) {
    const sources = p.foundBy || ['unknown'];
    const type = sources[0].replace(/-.*$/, '');
    if (!bySource.has(type)) bySource.set(type, []);
    bySource.get(type)!.push(p);
  }

  const selected: string[] = [];
  const selectedIds = new Set<string>();
  const sourceKeys = Array.from(bySource.keys());
  const sourcePointers = new Map<string, number>();
  for (const key of sourceKeys) sourcePointers.set(key, 0);

  let sourceIdx = 0;
  while (selected.length < count && sourceIdx < sourceKeys.length * count) {
    const key = sourceKeys[sourceIdx % sourceKeys.length];
    const pointer = sourcePointers.get(key) || 0;
    const candidates = bySource.get(key)!;

    if (pointer < candidates.length) {
      const patent = candidates[pointer];
      if (!selectedIds.has(patent.patentId)) {
        selected.push(patent.patentId);
        selectedIds.add(patent.patentId);
      }
      sourcePointers.set(key, pointer + 1);
    }
    sourceIdx++;
  }

  for (const p of patents) {
    if (selected.length >= count) break;
    if (!selectedIds.has(p.patentId)) {
      selected.push(p.patentId);
      selectedIds.add(p.patentId);
    }
  }

  return selected;
}

// ── Search Log ──

export interface SearchLogEntry {
  round: number;
  label: string;
  query: string;
  resultCount: number;
  relaxationSteps?: RelaxationStep[];
  durationMs?: number;
}

// ── Search with Relaxation ──

export interface RelaxationStep {
  action: 'original' | 'removed-cpc' | 'dropped-group' | 'raw-text-fallback';
  detail: string;
  query: string;
  resultCount: number;
}

export interface RelaxableSearchParams {
  tabId: number;
  concepts: ConceptForSearch[];
  cpcCodes?: string[];
  level: 'broad' | 'moderate' | 'narrow';
  limit?: number;
  source: ProFoundBySource;
  onRelaxation?: (step: RelaxationStep) => void;
}

export interface RelaxedSearchResult {
  results: any[];
  relaxationLog: RelaxationStep[];
  finalQuery: string;
}

function buildQueryFromParts(
  concepts: ConceptForSearch[],
  cpcCodes: string[],
  level: 'broad' | 'moderate' | 'narrow'
): string {
  const enabled = concepts.filter((c) => c.enabled);
  if (enabled.length === 0) return "";

  const groups = enabled.map((c) => {
    let terms: string[];
    if (level === 'broad') {
      terms = [c.name, ...c.synonyms];
    } else if (level === 'moderate') {
      terms = [c.name, ...c.synonyms.slice(0, 3)];
    } else {
      terms = [c.name, ...c.synonyms.slice(0, 1)];
    }
    return buildGroup(terms);
  });

  let query = groups.join(" AND ");

  if (cpcCodes.length > 0) {
    const cpcClause = `cpc:(${cpcCodes.join(" OR ")})`;
    query = `${query} AND ${cpcClause}`;
  }

  return query;
}

/** Run a search with progressive relaxation when 0 results are returned */
export async function runSearchWithRelaxation(
  params: RelaxableSearchParams
): Promise<RelaxedSearchResult> {
  const { tabId, concepts, cpcCodes = [], level, limit = 15, onRelaxation } = params;
  const relaxationLog: RelaxationStep[] = [];

  const enabled = concepts.filter((c) => c.enabled);
  if (enabled.length === 0) {
    return { results: [], relaxationLog, finalQuery: "" };
  }

  // Step 1: Try the original full query
  const originalQuery = buildQueryFromParts(enabled, cpcCodes, level);
  console.log(`[PSG-Relax] Trying original query: "${originalQuery.substring(0, 100)}..."`);

  let results = await runSingleSearch(tabId, originalQuery, limit);
  const step1: RelaxationStep = { action: 'original', detail: 'Full query with all groups' + (cpcCodes.length > 0 ? ` + ${cpcCodes.length} CPC codes` : ''), query: originalQuery, resultCount: results.length };
  relaxationLog.push(step1);
  onRelaxation?.(step1);

  if (results.length > 0) {
    return { results, relaxationLog, finalQuery: originalQuery };
  }

  // Step 2: Strip CPC codes (if any)
  if (cpcCodes.length > 0) {
    const noCpcQuery = buildQueryFromParts(enabled, [], level);
    console.log(`[PSG-Relax] Removed CPC codes, trying: "${noCpcQuery.substring(0, 100)}..."`);

    const tabOk = await verifyTab(tabId, "relax-no-cpc");
    if (tabOk) {
      results = await runSingleSearch(tabId, noCpcQuery, limit);
      const step2: RelaxationStep = { action: 'removed-cpc', detail: `Removed CPC codes: ${cpcCodes.join(', ')}`, query: noCpcQuery, resultCount: results.length };
      relaxationLog.push(step2);
      onRelaxation?.(step2);

      if (results.length > 0) {
        return { results, relaxationLog, finalQuery: noCpcQuery };
      }
    }
  }

  // Step 3: Progressive group dropping — remove lowest importance first
  // Sort: low → medium → high (drop low first)
  const importanceOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const sortedByImportance = [...enabled].sort(
    (a, b) => (importanceOrder[a.importance || 'medium'] || 1) - (importanceOrder[b.importance || 'medium'] || 1)
  );

  let remainingConcepts = [...sortedByImportance];

  while (remainingConcepts.length > 2) {
    // Drop the least important concept
    const dropped = remainingConcepts.shift()!;
    const reducedQuery = buildQueryFromParts(remainingConcepts, [], level);
    console.log(`[PSG-Relax] Dropped "${dropped.name}" (${dropped.importance || 'medium'}), trying ${remainingConcepts.length} groups: "${reducedQuery.substring(0, 100)}..."`);

    const tabOk = await verifyTab(tabId, `relax-drop-${remainingConcepts.length}`);
    if (!tabOk) break;

    results = await runSingleSearch(tabId, reducedQuery, limit);
    const stepN: RelaxationStep = { action: 'dropped-group', detail: `Dropped "${dropped.name}" (${dropped.importance || 'medium'}) — ${remainingConcepts.length} groups remain`, query: reducedQuery, resultCount: results.length };
    relaxationLog.push(stepN);
    onRelaxation?.(stepN);

    if (results.length > 0) {
      return { results, relaxationLog, finalQuery: reducedQuery };
    }
  }

  // Step 4: Raw text fallback — just concept names as keywords
  const rawText = enabled
    .filter((c) => c.importance !== 'low')
    .map((c) => c.name.includes(' ') ? `"${c.name}"` : c.name)
    .join(' ');
  console.log(`[PSG-Relax] Raw text fallback: "${rawText}"`);

  const tabOkFinal = await verifyTab(tabId, "relax-raw-text");
  if (tabOkFinal) {
    results = await runSingleSearch(tabId, rawText, limit);
    const stepFinal: RelaxationStep = { action: 'raw-text-fallback', detail: 'Raw text keywords (concept names only)', query: rawText, resultCount: results.length };
    relaxationLog.push(stepFinal);
    onRelaxation?.(stepFinal);
  }

  return { results, relaxationLog, finalQuery: rawText };
}

/** Deep scrape + NPL enrich for a patent map, skipping already-scraped IDs */
async function deepScrapeAndEnrich(
  tabId: number,
  patentMap: Map<string, any>,
  alreadyScrapedIds: Set<string>,
  onProgress?: (msg: string) => void
): Promise<any[]> {
  const allPatents = Array.from(patentMap.values());
  const needScrape = allPatents.filter((p) => !alreadyScrapedIds.has(p.patentId));
  const alreadyDone = allPatents.filter((p) => alreadyScrapedIds.has(p.patentId));

  const nplItems = needScrape.filter((p: any) => p.countries?.includes("NPL"));
  const patentItems = needScrape.filter((p: any) => !p.countries?.includes("NPL"));

  onProgress?.(`Deep scraping ${patentItems.length} new patents + ${nplItems.length} NPL...`);

  const tabOk = await verifyTab(tabId, "pre-deep-scrape-pro");
  if (!tabOk) throw new Error("Tab lost before deep scrape");

  const [deepResponse, nplEnrichResult] = await Promise.all([
    (async () => {
      if (patentItems.length === 0) return { status: "ok", results: [] };
      try {
        return await chrome.tabs.sendMessage(tabId, { type: "DEEP_SCRAPE", patents: patentItems });
      } catch (err) {
        console.error("[PSG-Pro] DEEP_SCRAPE failed:", err);
        return { status: "error", error: String(err), results: [] };
      }
    })(),
    (async () => {
      if (nplItems.length === 0) return { enriched: [] };
      try {
        const items = nplItems.map((p: any) => ({ patentId: p.patentId, title: p.title, doi: p.doi || undefined }));
        return await enrichNPL(items);
      } catch (err) {
        console.error("[PSG-Pro] NPL enrichment failed:", err);
        return { enriched: [] };
      }
    })(),
  ]);

  if (deepResponse?.status !== "ok" && patentItems.length > 0) {
    throw new Error(`Deep scrape failed: ${deepResponse?.error || "unknown"}`);
  }

  const deepPatents = (deepResponse?.results || []).map((dp: any) => ({
    ...dp,
    foundBy: patentMap.get(dp.patentId)?.foundBy || ["unknown"],
  }));

  const enrichedMap = new Map<string, EnrichedNPLItem>();
  for (const e of nplEnrichResult.enriched || []) {
    enrichedMap.set(e.patentId, e);
  }
  const enrichedNPLPatents = nplItems.map((npl: any) => {
    const enrichment = enrichedMap.get(npl.patentId);
    return {
      ...npl,
      fullAbstract: enrichment?.fullAbstract || npl.abstract || "",
      cpcCodes: [],
      firstClaim: "",
      citationCount: enrichment?.citationCount || 0,
      venue: enrichment?.venue || "",
      doi: enrichment?.doi || npl.doi || "",
      fieldsOfStudy: enrichment?.fieldsOfStudy || [],
      enrichedVia: enrichment?.enrichedVia || "none",
      foundBy: patentMap.get(npl.patentId)?.foundBy || ["unknown"],
    };
  });

  return [...alreadyDone, ...deepPatents, ...enrichedNPLPatents];
}

// ── Pro Auto Search ──

export interface ProAutoSearchParams {
  originalParagraph: string;
  concepts: ConceptForSearch[];
  onProgress: (progress: ProSearchProgress) => void;
}

export async function runProAutoSearch(params: ProAutoSearchParams): Promise<void> {
  const { originalParagraph, concepts, onProgress } = params;

  console.log("[PSG-Pro] ========== PRO AUTO SEARCH START ==========");

  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];

  // Step 0: Get tab + config
  onProgress({ phase: "round1", message: "Preparing search...", percent: 0 });
  const tabId = await ensurePatentsTab();

  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SEARCH_CONFIG", includeNPL: true });
  } catch { /* may fail on landing page */ }

  // Step 1: Round 1 — multi-query search (raw text + boolean + AI-optimized)
  onProgress({ phase: "round1", message: "Round 1: Raw text + AI optimization...", percent: 3 });

  // Build raw text query from concept names (same approach as Quick mode)
  const smartRawText = concepts
    .filter((c) => c.enabled)
    .map((c) => c.name.includes(' ') ? `"${c.name}"` : c.name)
    .join(' ');

  // Run raw text search + AI optimization call in parallel
  const r1RawStart = Date.now();
  const [optimizedResult, rawTextResults] = await Promise.all([
    optimizeQuery(smartRawText)
      .then((r) => { console.log(`[PSG-Pro] AI optimization done: "${r.optimizedQuery?.substring(0, 80)}..."`); return r; })
      .catch((err) => { console.error("[PSG-Pro] AI optimization failed:", err); return { optimizedQuery: "", reasoning: "" }; }),
    runSingleSearch(tabId, smartRawText, 35),
  ]);
  console.log(`[PSG-Pro] Round 1 raw text: ${rawTextResults.length} results`);
  searchLog.push({ round: 1, label: "Raw text", query: smartRawText, resultCount: rawTextResults.length, durationMs: Date.now() - r1RawStart });

  // Boolean search (with relaxation)
  onProgress({ phase: "round1", message: "Round 1: Boolean search...", percent: 10 });
  const tabOkBool = await verifyTab(tabId, "pre-round1-boolean");
  if (!tabOkBool) throw new Error("Tab lost during Round 1");
  const r1BoolStart = Date.now();
  const booleanRelaxed = await runSearchWithRelaxation({
    tabId,
    concepts,
    level: 'broad',
    limit: 15,
    source: "round1-boolean",
    onRelaxation: (step) => {
      if (step.action !== 'original') {
        onProgress({ phase: "round1", message: `Round 1 boolean: ${step.detail}...`, percent: 12 });
      }
    },
  });
  const booleanResults = booleanRelaxed.results;
  console.log(`[PSG-Pro] Round 1 boolean: ${booleanResults.length} results (${booleanRelaxed.relaxationLog.length} attempts)`);
  searchLog.push({ round: 1, label: "Boolean", query: booleanRelaxed.finalQuery, resultCount: booleanResults.length, relaxationSteps: booleanRelaxed.relaxationLog, durationMs: Date.now() - r1BoolStart });

  // AI-optimized search
  let aiResults: any[] = [];
  if (optimizedResult.optimizedQuery) {
    onProgress({ phase: "round1", message: "Round 1: AI-optimized search...", percent: 16 });
    const tabOkAI = await verifyTab(tabId, "pre-round1-ai");
    if (tabOkAI) {
      const r1AiStart = Date.now();
      aiResults = await runSingleSearch(tabId, optimizedResult.optimizedQuery, 35);
      console.log(`[PSG-Pro] Round 1 AI-optimized: ${aiResults.length} results`);
      searchLog.push({ round: 1, label: "AI-optimized", query: optimizedResult.optimizedQuery, resultCount: aiResults.length, durationMs: Date.now() - r1AiStart });
    }
  } else {
    console.warn("[PSG-Pro] Round 1: AI optimization skipped (no query)");
    searchLog.push({ round: 1, label: "AI-optimized", query: "(skipped)", resultCount: 0 });
  }

  // Merge all Round 1 results
  const round1ResultSets: ResultSet[] = [
    { results: rawTextResults, source: "round1-raw" },
    { results: booleanResults, source: "round1-boolean" },
  ];
  if (aiResults.length > 0) {
    round1ResultSets.push({ results: aiResults, source: "round1-ai" });
  }
  const round1Map = deduplicatePatents(round1ResultSets);
  console.log(`[PSG-Pro] Round 1 merged: ${round1Map.size} unique (raw=${rawTextResults.length}, bool=${booleanResults.length}, ai=${aiResults.length})`);

  if (round1Map.size === 0) {
    throw new Error("Round 1 returned no results across all 3 queries. Try adjusting your concepts.");
  }

  // Step 2: Deep scrape Round 1 (need CPC codes for analysis)
  onProgress({ phase: "round1", message: "Deep scraping Round 1 results...", percent: 22 });
  const round1Scraped = await deepScrapeAndEnrich(tabId, round1Map, new Set(), (msg) => {
    onProgress({ phase: "round1", message: msg, percent: 26 });
  });
  console.log(`[PSG-Pro] Round 1 deep scraped: ${round1Scraped.length}`);
  const scrapedIds = new Set(round1Scraped.map((p: any) => p.patentId));

  // Step 3: AI analysis of Round 1 — deduct pipeline credit cost
  onProgress({ phase: "analyzing", message: "AI analyzing Round 1 results...", percent: 32 });

  let analysisResult: AnalyzeRoundResponse;
  let topPatentIds: string[];
  try {
    analysisResult = await analyzeRound({
      originalConcepts: concepts.filter((c) => c.enabled).map((c) => ({ name: c.name, synonyms: c.synonyms })),
      roundResults: round1Scraped.map((p: any) => ({
        patentId: p.patentId,
        title: p.title,
        abstract: p.abstract,
        fullAbstract: p.fullAbstract,
        cpcCodes: p.cpcCodes || [],
      })),
      roundNumber: 1,
      originalParagraph,
    }, getStrategyCreditCost('pro-auto'));
    topPatentIds = analysisResult.topPatentIds?.slice(0, 5) || [];
    console.log("[PSG-Pro] Analysis complete:", {
      cpcCount: analysisResult.cpcSuggestions?.length,
      swapCount: analysisResult.terminologySwaps?.length,
      topPatents: topPatentIds,
    });
  } catch (err) {
    console.error("[PSG-Pro] Analysis failed, using fallback:", err);
    // Fallback: use original concepts, pick top 5 by position
    analysisResult = {
      cpcSuggestions: [],
      terminologySwaps: [],
      conceptHealth: [],
      refinedConcepts: concepts.filter((c) => c.enabled).map((c) => ({
        name: c.name,
        synonyms: c.synonyms,
        addedCPCCodes: [],
      })),
      topPatentIds: [],
    };
    topPatentIds = selectDiverseAnchors(round1Scraped, 5);
  }

  // Step 4: Similarity searches — quality gate: only use anchors with good concept coverage
  const conceptsForCoverage = concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms }));
  const qualifiedAnchors = topPatentIds.filter(pid => {
    const patent = round1Scraped.find((p: any) => p.patentId === pid);
    if (!patent) return false;
    const text = [patent.abstract || '', patent.fullAbstract || '', patent.title || ''].join(' ');
    const coverage = scoreConceptCoverage(conceptsForCoverage, text);
    console.log(`[PSG-Pro] Anchor quality gate: ${pid} coverage=${coverage}%`);
    return coverage >= 50;
  });
  console.log(`[PSG-Pro] Similarity anchors: ${topPatentIds.length} candidates → ${qualifiedAnchors.length} qualified (>=50% concept coverage)`);

  onProgress({ phase: "similarity", message: "Running similarity searches...", percent: 45 });
  const similarityResults: ResultSet[] = [];

  for (let i = 0; i < qualifiedAnchors.length; i++) {
    const patentId = qualifiedAnchors[i];
    onProgress({
      phase: "similarity",
      message: `Similarity ${i + 1}/${qualifiedAnchors.length}: ${patentId}...`,
      percent: 45 + (i * 10),
    });

    const tabOk = await verifyTab(tabId, `pre-similarity-${i}`);
    if (!tabOk) break;

    const simStart = Date.now();
    const simResults = await runSingleSearch(tabId, `~patent/${patentId}`, 35);
    if (simResults.length > 0) {
      similarityResults.push({ results: simResults, source: `similar-${patentId}` as ProFoundBySource });
    }
    console.log(`[PSG-Pro] Similarity for ${patentId}: ${simResults.length} results`);
    searchLog.push({ round: 1, label: `Similarity: ${patentId}`, query: `~patent/${patentId}`, resultCount: simResults.length, durationMs: Date.now() - simStart });
  }

  // Step 5: Round 2 — refined keyword search (with relaxation)
  onProgress({ phase: "round2", message: "Round 2: Refined keyword search...", percent: 70 });

  const tabOkForR2 = await verifyTab(tabId, "pre-round2");
  if (!tabOkForR2) throw new Error("Tab lost before Round 2");

  // Build Round 2 concepts and CPC codes from analysis
  let round2Concepts: ConceptForSearch[];
  let round2CPCs: string[] = [];
  if (analysisResult.refinedConcepts && analysisResult.refinedConcepts.length > 0) {
    // Carry forward modifiers/nouns from original concepts
    const originalByName = new Map<string, ConceptForSearch>();
    for (const c of concepts) {
      originalByName.set(c.name.toLowerCase(), c);
    }
    round2Concepts = analysisResult.refinedConcepts.map((rc) => {
      const original = originalByName.get(rc.name.toLowerCase());
      return {
        name: rc.name,
        synonyms: rc.synonyms || [],
        modifiers: original?.modifiers,
        nouns: original?.nouns,
        enabled: true,
        importance: original?.importance || 'high' as const,
      };
    });
    for (const rc of analysisResult.refinedConcepts) {
      for (const code of rc.addedCPCCodes || []) {
        if (!round2CPCs.includes(code)) round2CPCs.push(code);
      }
    }
  } else {
    round2Concepts = concepts;
  }

  const r2Start = Date.now();
  const round2Relaxed = await runSearchWithRelaxation({
    tabId,
    concepts: round2Concepts,
    cpcCodes: round2CPCs,
    level: 'moderate',
    limit: 25,
    source: "round2-refined",
    onRelaxation: (step) => {
      if (step.action !== 'original') {
        onProgress({ phase: "round2", message: `Round 2: ${step.detail}...`, percent: 74 });
      }
    },
  });
  const round2Results = round2Relaxed.results;
  const round2Query = round2Relaxed.finalQuery;
  console.log(`[PSG-Pro] Round 2: ${round2Results.length} results (${round2Relaxed.relaxationLog.length} attempts)`);
  searchLog.push({ round: 2, label: "Refined search", query: round2Query, resultCount: round2Results.length, relaxationSteps: round2Relaxed.relaxationLog, durationMs: Date.now() - r2Start });

  // Step 6: Merge all results
  onProgress({ phase: "deep-scrape", message: "Merging and deduplicating...", percent: 80 });

  const allResultSets: ResultSet[] = [
    ...round1ResultSets,
    ...similarityResults,
    { results: round2Results, source: "round2-refined" },
  ];

  const mergedMap = deduplicatePatents(allResultSets);
  console.log(`[PSG-Pro] Merged: ${mergedMap.size} unique patents`);

  if (mergedMap.size === 0) {
    throw new Error("No results found across all search rounds.");
  }

  // Step 7: Deep scrape new patents (skip already-scraped from Round 1)
  onProgress({ phase: "deep-scrape", message: "Deep scraping new patents...", percent: 85 });
  const allFinalPatents = await deepScrapeAndEnrich(tabId, mergedMap, scrapedIds, (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 90 });
  });

  const bqEnrichedPatents = allFinalPatents; // BigQuery removed

  // Step 8: Store results and open results page
  onProgress({ phase: "done", message: "Opening results page...", percent: 95 });

  const round1Count = round1Map.size;
  const similarityCount = similarityResults.reduce((sum, rs) => sum + rs.results.length, 0);
  const round2Count = round2Results.length;

  const storagePayload = {
    patentResults: {
      query: originalParagraph,
      patents: bqEnrichedPatents,
      totalAvailable: 100,
      page: 1,
      concepts: concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms, importance: c.importance, category: (c as any).category })),
      searchMeta: {
        mode: 'pro-auto',
        rawTextCount: rawTextResults.length,
        booleanCount: booleanResults.length,
        aiOptimizedCount: aiResults.length,
        round1Count,
        similarityCount,
        round2Count,
        uniqueCount: mergedMap.size,
        aiQuery: round2Query,
        rounds: [
          { round: 1, query: `[3 queries: raw text + boolean + AI]`, count: round1Count },
          { round: 2, query: round2Query, count: round2Count },
        ],
        searchLog,
        totalDurationMs: Date.now() - searchStartTime,
      },
    },
  };

  await chrome.storage.local.set(storagePayload);
  const resultsTabPro = await chrome.tabs.create({ url: chrome.runtime.getURL("results.html"), active: true });
  if (resultsTabPro.id) {
    await chrome.tabs.update(resultsTabPro.id, { active: true });
    if (resultsTabPro.windowId) {
      await chrome.windows.update(resultsTabPro.windowId, { focused: true });
    }
  }

  onProgress({ phase: "done", message: "Done!", percent: 100 });
  console.log("[PSG-Pro] ========== PRO AUTO SEARCH COMPLETE ==========");
}

// ── Pro Interactive Search ──

export interface ProInteractiveSearchParams {
  originalParagraph: string;
  concepts: ConceptForSearch[];
  onProgress: (progress: ProSearchProgress) => void;
  onPause: (data: RefinementDashboardData) => Promise<UserRefinementSelections>;
}

export async function runProInteractiveSearch(params: ProInteractiveSearchParams): Promise<void> {
  const { originalParagraph, concepts, onProgress, onPause } = params;

  console.log("[PSG-ProI] ========== PRO INTERACTIVE SEARCH START ==========");

  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];

  // Step 0: Get tab + config
  onProgress({ phase: "round1", message: "Preparing search...", percent: 0 });
  const tabId = await ensurePatentsTab();

  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SEARCH_CONFIG", includeNPL: true });
  } catch { /* may fail on landing page */ }

  // Step 1: Round 1 — multi-query search (raw text + boolean + AI-optimized)
  onProgress({ phase: "round1", message: "Round 1: Raw text + AI optimization...", percent: 2 });

  const smartRawText = concepts
    .filter((c) => c.enabled)
    .map((c) => c.name.includes(' ') ? `"${c.name}"` : c.name)
    .join(' ');

  const r1RawStartI = Date.now();
  const [optimizedResultI, rawTextResultsI] = await Promise.all([
    optimizeQuery(smartRawText)
      .catch(() => ({ optimizedQuery: "", reasoning: "" })),
    runSingleSearch(tabId, smartRawText, 35),
  ]);
  console.log(`[PSG-ProI] Round 1 raw text: ${rawTextResultsI.length} results`);
  searchLog.push({ round: 1, label: "Raw text", query: smartRawText, resultCount: rawTextResultsI.length, durationMs: Date.now() - r1RawStartI });

  onProgress({ phase: "round1", message: "Round 1: Boolean search...", percent: 6 });
  const tabOkBoolI = await verifyTab(tabId, "pre-round1-boolean-i");
  if (!tabOkBoolI) throw new Error("Tab lost during Round 1");
  const r1BoolStartI = Date.now();
  const booleanRelaxedI = await runSearchWithRelaxation({
    tabId,
    concepts,
    level: 'broad',
    limit: 15,
    source: "round1-boolean",
    onRelaxation: (step) => {
      if (step.action !== 'original') {
        onProgress({ phase: "round1", message: `Round 1 boolean: ${step.detail}...`, percent: 8 });
      }
    },
  });
  const booleanResultsI = booleanRelaxedI.results;
  console.log(`[PSG-ProI] Round 1 boolean: ${booleanResultsI.length} results (${booleanRelaxedI.relaxationLog.length} attempts)`);
  searchLog.push({ round: 1, label: "Boolean", query: booleanRelaxedI.finalQuery, resultCount: booleanResultsI.length, relaxationSteps: booleanRelaxedI.relaxationLog, durationMs: Date.now() - r1BoolStartI });

  let aiResultsI: any[] = [];
  if (optimizedResultI.optimizedQuery) {
    onProgress({ phase: "round1", message: "Round 1: AI-optimized search...", percent: 10 });
    const tabOkAII = await verifyTab(tabId, "pre-round1-ai-i");
    if (tabOkAII) {
      const r1AiStartI = Date.now();
      aiResultsI = await runSingleSearch(tabId, optimizedResultI.optimizedQuery, 35);
      console.log(`[PSG-ProI] Round 1 AI-optimized: ${aiResultsI.length} results`);
      searchLog.push({ round: 1, label: "AI-optimized", query: optimizedResultI.optimizedQuery, resultCount: aiResultsI.length, durationMs: Date.now() - r1AiStartI });
    }
  } else {
    searchLog.push({ round: 1, label: "AI-optimized", query: "(skipped)", resultCount: 0 });
  }

  const round1ResultSetsI: ResultSet[] = [
    { results: rawTextResultsI, source: "round1-raw" },
    { results: booleanResultsI, source: "round1-boolean" },
  ];
  if (aiResultsI.length > 0) {
    round1ResultSetsI.push({ results: aiResultsI, source: "round1-ai" });
  }
  const round1Map = deduplicatePatents(round1ResultSetsI);
  console.log(`[PSG-ProI] Round 1 merged: ${round1Map.size} unique`);

  if (round1Map.size === 0) {
    throw new Error("Round 1 returned no results across all 3 queries. Try adjusting your concepts.");
  }

  // Step 2: Deep scrape Round 1
  onProgress({ phase: "round1", message: "Deep scraping Round 1...", percent: 14 });
  const round1Scraped = await deepScrapeAndEnrich(tabId, round1Map, new Set(), (msg) => {
    onProgress({ phase: "round1", message: msg, percent: 17 });
  });
  const scrapedIds = new Set(round1Scraped.map((p: any) => p.patentId));

  // Step 3: AI analysis — deduct pipeline credit cost on first call
  onProgress({ phase: "analyzing", message: "AI analyzing Round 1...", percent: 20 });
  let analysisResult: AnalyzeRoundResponse;
  try {
    analysisResult = await analyzeRound({
      originalConcepts: concepts.filter((c) => c.enabled).map((c) => ({ name: c.name, synonyms: c.synonyms })),
      roundResults: round1Scraped.map((p: any) => ({
        patentId: p.patentId,
        title: p.title,
        abstract: p.abstract,
        fullAbstract: p.fullAbstract,
        cpcCodes: p.cpcCodes || [],
      })),
      roundNumber: 1,
      originalParagraph,
    }, getStrategyCreditCost('pro-interactive'));
  } catch (err) {
    console.error("[PSG-ProI] Analysis failed:", err);
    analysisResult = {
      cpcSuggestions: [],
      terminologySwaps: [],
      conceptHealth: [],
      refinedConcepts: [],
      topPatentIds: [],
    };
  }

  // ── PAUSE 1: Refinement Dashboard ──
  onProgress({ phase: "analyzing", message: "Waiting for your selections...", percent: 25 });
  const pause1Data: RefinementDashboardData = {
    roundNumber: 1,
    patents: round1Scraped,
    cpcSuggestions: analysisResult.cpcSuggestions || [],
    terminologySwaps: analysisResult.terminologySwaps || [],
    conceptHealth: analysisResult.conceptHealth || [],
  };

  const userSelections1 = await onPause(pause1Data);

  // Step 4: Round 2 — refined keyword search + similarity
  onProgress({ phase: "round2", message: "Round 2: Refined search...", percent: 30 });

  // Build refined query from user selections
  const updatedConcepts = userSelections1.updatedConcepts.length > 0
    ? userSelections1.updatedConcepts
    : concepts;

  const tabOkR2 = await verifyTab(tabId, "pre-round2-interactive");
  if (!tabOkR2) throw new Error("Tab lost before Round 2");

  const r2StartI = Date.now();
  const round2RelaxedI = await runSearchWithRelaxation({
    tabId,
    concepts: updatedConcepts,
    cpcCodes: userSelections1.selectedCPCCodes,
    level: 'moderate',
    limit: 25,
    source: "round2-refined",
    onRelaxation: (step) => {
      if (step.action !== 'original') {
        onProgress({ phase: "round2", message: `Round 2: ${step.detail}...`, percent: 35 });
      }
    },
  });
  const round2Results = round2RelaxedI.results;
  const round2Query = round2RelaxedI.finalQuery;
  console.log(`[PSG-ProI] Round 2: ${round2Results.length} results (${round2RelaxedI.relaxationLog.length} attempts)`);
  searchLog.push({ round: 2, label: "Refined search", query: round2Query, resultCount: round2Results.length, relaxationSteps: round2RelaxedI.relaxationLog, durationMs: Date.now() - r2StartI });

  // Similarity searches for user-selected patents
  onProgress({ phase: "similarity", message: "Running similarity searches...", percent: 45 });
  const similarityResults1: ResultSet[] = [];
  const simPatents = userSelections1.selectedPatentIds.slice(0, 5);

  for (let i = 0; i < simPatents.length; i++) {
    const patentId = simPatents[i];
    onProgress({ phase: "similarity", message: `Similarity ${i + 1}/${simPatents.length}: ${patentId}...`, percent: 45 + (i * 5) });
    const tabOk = await verifyTab(tabId, `pre-sim1-${i}`);
    if (!tabOk) break;
    const simStartI = Date.now();
    const simResults = await runSingleSearch(tabId, `~patent/${patentId}`, 35);
    if (simResults.length > 0) {
      similarityResults1.push({ results: simResults, source: `similar-${patentId}` as ProFoundBySource });
    }
    searchLog.push({ round: 2, label: `Similarity: ${patentId}`, query: `~patent/${patentId}`, resultCount: simResults.length, durationMs: Date.now() - simStartI });
  }

  // Merge Round 1 + Round 2 + similarity
  const midResultSets: ResultSet[] = [
    ...round1ResultSetsI,
    { results: round2Results, source: "round2-refined" },
    ...similarityResults1,
  ];
  const midMerged = deduplicatePatents(midResultSets);

  // Deep scrape new from Round 2 / similarity
  onProgress({ phase: "deep-scrape", message: "Deep scraping Round 2 results...", percent: 60 });
  const midScraped = await deepScrapeAndEnrich(tabId, midMerged, scrapedIds, (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 62 });
  });
  for (const p of midScraped) scrapedIds.add(p.patentId);

  // Step 5: AI analysis of combined results
  onProgress({ phase: "analyzing", message: "AI analyzing combined results...", percent: 65 });
  let analysis2: AnalyzeRoundResponse;
  try {
    analysis2 = await analyzeRound({
      originalConcepts: updatedConcepts.filter((c) => c.enabled).map((c) => ({ name: c.name, synonyms: c.synonyms })),
      roundResults: midScraped.map((p: any) => ({
        patentId: p.patentId,
        title: p.title,
        abstract: p.abstract,
        fullAbstract: p.fullAbstract,
        cpcCodes: p.cpcCodes || [],
      })),
      roundNumber: 2,
      originalParagraph,
    });
  } catch {
    analysis2 = { cpcSuggestions: [], terminologySwaps: [], conceptHealth: [], refinedConcepts: [], topPatentIds: [] };
  }

  // ── PAUSE 2: Review combined results ──
  onProgress({ phase: "analyzing", message: "Waiting for your Round 2 selections...", percent: 68 });
  const pause2Data: RefinementDashboardData = {
    roundNumber: 2,
    patents: midScraped,
    cpcSuggestions: analysis2.cpcSuggestions || [],
    terminologySwaps: analysis2.terminologySwaps || [],
    conceptHealth: analysis2.conceptHealth || [],
  };

  const userSelections2 = await onPause(pause2Data);

  // Step 6: Round 3 — narrow precision search
  onProgress({ phase: "round3", message: "Round 3: Narrow precision search...", percent: 72 });

  const finalConcepts = userSelections2.updatedConcepts.length > 0
    ? userSelections2.updatedConcepts
    : updatedConcepts;

  const tabOkR3 = await verifyTab(tabId, "pre-round3");
  if (!tabOkR3) throw new Error("Tab lost before Round 3");

  const r3StartI = Date.now();
  const round3RelaxedI = await runSearchWithRelaxation({
    tabId,
    concepts: finalConcepts,
    cpcCodes: userSelections2.selectedCPCCodes,
    level: 'narrow',
    limit: 25,
    source: "round3-narrow",
    onRelaxation: (step) => {
      if (step.action !== 'original') {
        onProgress({ phase: "round3", message: `Round 3: ${step.detail}...`, percent: 75 });
      }
    },
  });
  const round3Results = round3RelaxedI.results;
  const round3Query = round3RelaxedI.finalQuery;
  console.log(`[PSG-ProI] Round 3: ${round3Results.length} results (${round3RelaxedI.relaxationLog.length} attempts)`);
  searchLog.push({ round: 3, label: "Narrow search", query: round3Query, resultCount: round3Results.length, relaxationSteps: round3RelaxedI.relaxationLog, durationMs: Date.now() - r3StartI });

  // Similarity from Round 2 picks
  const similarityResults2: ResultSet[] = [];
  const simPatents2 = userSelections2.selectedPatentIds.slice(0, 5);
  for (let i = 0; i < simPatents2.length; i++) {
    const patentId = simPatents2[i];
    onProgress({ phase: "similarity", message: `Final similarity ${i + 1}/${simPatents2.length}...`, percent: 78 + (i * 3) });
    const tabOk = await verifyTab(tabId, `pre-sim2-${i}`);
    if (!tabOk) break;
    const sim2StartI = Date.now();
    const simResults = await runSingleSearch(tabId, `~patent/${patentId}`, 35);
    if (simResults.length > 0) {
      similarityResults2.push({ results: simResults, source: `similar-${patentId}` as ProFoundBySource });
    }
    searchLog.push({ round: 3, label: `Similarity: ${patentId}`, query: `~patent/${patentId}`, resultCount: simResults.length, durationMs: Date.now() - sim2StartI });
  }

  // Step 7: Final merge
  onProgress({ phase: "deep-scrape", message: "Final merge and deep scrape...", percent: 88 });

  const allResultSets: ResultSet[] = [
    ...round1ResultSetsI,
    { results: round2Results, source: "round2-refined" },
    ...similarityResults1,
    { results: round3Results, source: "round3-narrow" },
    ...similarityResults2,
  ];

  const finalMap = deduplicatePatents(allResultSets);
  console.log(`[PSG-ProI] Final merged: ${finalMap.size} unique patents`);

  if (finalMap.size === 0) {
    throw new Error("No results found across all rounds.");
  }

  const allFinalPatents = await deepScrapeAndEnrich(tabId, finalMap, scrapedIds, (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 92 });
  });

  const bqEnrichedPatents = allFinalPatents; // BigQuery removed

  // Step 8: Store and open results
  onProgress({ phase: "done", message: "Opening results page...", percent: 96 });

  const round1Count = round1Map.size;
  const sim1Count = similarityResults1.reduce((sum, rs) => sum + rs.results.length, 0);
  const round2Count = round2Results.length;
  const sim2Count = similarityResults2.reduce((sum, rs) => sum + rs.results.length, 0);
  const round3Count = round3Results.length;

  const storagePayload = {
    patentResults: {
      query: originalParagraph,
      patents: bqEnrichedPatents,
      totalAvailable: 100,
      page: 1,
      concepts: finalConcepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms, importance: c.importance, category: (c as any).category })),
      searchMeta: {
        mode: 'pro-interactive',
        rawTextCount: rawTextResultsI.length,
        booleanCount: booleanResultsI.length,
        aiOptimizedCount: aiResultsI.length,
        round1Count,
        similarityCount: sim1Count + sim2Count,
        round2Count,
        round3Count,
        uniqueCount: finalMap.size,
        aiQuery: round3Query,
        rounds: [
          { round: 1, query: `[3 queries: raw text + boolean + AI]`, count: round1Count },
          { round: 2, query: round2Query, count: round2Count },
          { round: 3, query: round3Query, count: round3Count },
        ],
        searchLog,
        totalDurationMs: Date.now() - searchStartTime,
      },
    },
  };

  await chrome.storage.local.set(storagePayload);
  const resultsTabProI = await chrome.tabs.create({ url: chrome.runtime.getURL("results.html"), active: true });
  if (resultsTabProI.id) {
    await chrome.tabs.update(resultsTabProI.id, { active: true });
    if (resultsTabProI.windowId) {
      await chrome.windows.update(resultsTabProI.windowId, { focused: true });
    }
  }

  onProgress({ phase: "done", message: "Done!", percent: 100 });
  console.log("[PSG-ProI] ========== PRO INTERACTIVE SEARCH COMPLETE ==========");
}

// ── Strategy + Depth Orchestrator ──

export type { SearchStrategy, SearchDepth } from "../services/apiService";

export interface StrategySearchParams {
  originalParagraph: string;
  concepts: ConceptForSearch[];
  strategy: SearchStrategy;
  depth: SearchDepth;
  onProgress: (progress: ProSearchProgress) => void;
  onPause?: (data: RefinementDashboardData) => Promise<UserRefinementSelections>;
}

export interface StrategySearchMeta {
  strategy: SearchStrategy;
  depth: SearchDepth;
  mergeCount: number;
  layersStopped?: number;       // Onion Ring: which layer was the sweet spot
  pairCount?: number;           // Faceted: how many pairs were searched
  frequencyDistribution?: Record<number, number>; // Faceted: patents appearing in N pairs
}

/** Get AI-generated queries with local fallback */
/**
 * Build strategy queries using local builders (deterministic, tested).
 * Uses proximity-paired modifiers/nouns with NEAR/5, $ stemming, and proper limits.
 * Server-side AI query generation (/generate-strategy-searches) was removed because:
 *  - Gemini produced inconsistent syntax (wrong wildcards, duplicate terms, generic words)
 *  - Local builders have tested stemming, proximity, dedup, and enforcer compliance
 *  - AI is still used for concept extraction (modifiers/nouns) — where it adds real value
 */
async function getStrategyQueries(
  concepts: ConceptForSearch[],
  strategy: SearchStrategy
): Promise<StrategySearchQuery[]> {
  let queries: StrategySearchQuery[];

  switch (strategy) {
    case 'telescoping': queries = buildTelescopingQueries(concepts); break;
    case 'onion-ring': queries = buildOnionRingQueries(concepts); break;
    case 'faceted': queries = buildFacetedQueries(concepts); break;
    default: queries = buildTelescopingQueries(concepts); break;
  }

  console.log(`[PSG-Strategy] Built ${queries.length} ${strategy} queries locally`);

  // Enforce Google Patents complexity limits on all queries
  return queries.map(q => {
    const sanitized = sanitizeForGooglePatents(q.query);
    const enforced = enforceGooglePatentsLimits(sanitized);
    console.log(`[PSG-Limits] "${q.label}" | raw=${q.query.length}ch | sanitized=${sanitized.length}ch | enforced=${enforced.length}ch`);
    console.log(`[PSG-Limits]   enforced query: ${enforced}`);
    return { ...q, query: enforced };
  });
}

/** Single entry point for strategy + depth searches */
export async function runStrategyWithDepth(params: StrategySearchParams): Promise<void> {
  const { strategy, depth, concepts, originalParagraph, onProgress, onPause } = params;

  console.log(`[PSG-Strategy] ========== ${strategy.toUpperCase()} + ${depth.toUpperCase()} START ==========`);

  // Step 0: Merge overlapping concepts
  const mergeableList: MergeableConcept[] = concepts.map((c, i) => ({
    id: (c as any).id || `concept-${i}`,
    name: c.name,
    category: (c as any).category || 'device',
    synonyms: c.synonyms,
    importance: (c.importance || 'medium') as 'high' | 'medium' | 'low',
    enabled: c.enabled,
  }));
  const mergeResult: MergeResult = mergeConcepts(mergeableList);
  console.log(`[PSG-Strategy] Merged ${mergeResult.mergeCount} overlapping concepts. ${mergeResult.concepts.length} concepts remain.`);

  const mergedConcepts: ConceptForSearch[] = mergeResult.concepts.map(mc => ({
    name: mc.name,
    synonyms: mc.synonyms,
    enabled: mc.enabled,
    importance: mc.importance,
  }));

  // Step 1: Get strategy queries
  onProgress({ phase: "round1", message: `Generating ${strategy} queries...`, percent: 2 });
  const queries = await getStrategyQueries(mergedConcepts, strategy);
  console.log(`[PSG-Strategy] Generated ${queries.length} queries for strategy ${strategy}`);

  // Dispatch to depth executor
  switch (depth) {
    case 'quick':
      return executeQuickDepth(strategy, queries, mergedConcepts, mergeResult, originalParagraph, onProgress);
    case 'pro-auto':
      return executeProAutoDepth(strategy, queries, mergedConcepts, mergeResult, originalParagraph, onProgress);
    case 'pro-interactive':
      if (!onPause) throw new Error("onPause callback required for pro-interactive depth");
      return executeProInteractiveDepth(strategy, queries, mergedConcepts, mergeResult, originalParagraph, onProgress, onPause);
  }
}

// ── Quick Depth Executor ──

async function executeQuickDepth(
  strategy: SearchStrategy,
  queries: StrategySearchQuery[],
  concepts: ConceptForSearch[],
  mergeResult: MergeResult,
  originalParagraph: string,
  onProgress: (progress: ProSearchProgress) => void
): Promise<void> {
  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];
  const strategyMeta: StrategySearchMeta = {
    strategy, depth: 'quick', mergeCount: mergeResult.mergeCount,
  };

  // Get tab
  onProgress({ phase: "round1", message: "Opening Google Patents...", percent: 5 });
  const tabId = await ensurePatentsTab();
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SEARCH_CONFIG", includeNPL: true });
  } catch { /* may fail on landing page */ }

  const allResultSets: ResultSet[] = [];
  let sweetSpotLayer: number | undefined;
  let googleUnavailableCount = 0;
  let totalSearchCount = 0;

  if (strategy === 'onion-ring') {
    // Execute layers in order, stop at sweet spot (20-200 results)
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const percent = 10 + Math.round((i / queries.length) * 60);
      onProgress({ phase: "round1", message: `${q.label}: searching...`, percent });

      const tabOk = await verifyTab(tabId, `onion-layer-${i}`);
      if (!tabOk) break;

      const start = Date.now();
      totalSearchCount++;
      const searchResult = await runSingleSearchFull(tabId, q.query, 35);
      if (searchResult.googleUnavailable) googleUnavailableCount++;
      const results = searchResult.results;
      searchLog.push({ round: 1, label: q.label, query: q.query, resultCount: results.length, durationMs: Date.now() - start });

      if (results.length > 0) {
        allResultSets.push({ results, source: `round1-${q.label}` as ProFoundBySource });
      }

      onProgress({ phase: "round1", message: `${q.label}: ${results.length} results`, percent: percent + 5 });

      // Sweet spot: if we have 20-200 results, stop
      if (results.length >= 20 && results.length <= 200) {
        sweetSpotLayer = i;
        console.log(`[PSG-Strategy] Onion ring sweet spot at layer ${i}: ${results.length} results`);
        break;
      }
      // If we got >200, the previous layer was better — but still use this one
      if (results.length > 200 && i > 0) {
        sweetSpotLayer = i;
        break;
      }
    }

    // Always run the narrowest layer (all concepts) if sweet spot stopped early
    const lastLayerIndex = queries.length - 1;
    if (sweetSpotLayer !== undefined && sweetSpotLayer < lastLayerIndex) {
      const narrowQ = queries[lastLayerIndex];
      onProgress({ phase: "round1", message: `${narrowQ.label} (all concepts): searching...`, percent: 70 });

      const tabOk = await verifyTab(tabId, `onion-layer-narrow`);
      if (tabOk) {
        const start = Date.now();
        totalSearchCount++;
        const searchResult = await runSingleSearchFull(tabId, narrowQ.query, 35);
        if (searchResult.googleUnavailable) googleUnavailableCount++;
        const results = searchResult.results;
        searchLog.push({ round: 1, label: `${narrowQ.label} (forced)`, query: narrowQ.query, resultCount: results.length, durationMs: Date.now() - start });

        if (results.length > 0) {
          allResultSets.push({ results, source: `round1-${narrowQ.label}` as ProFoundBySource });
        }
        onProgress({ phase: "round1", message: `${narrowQ.label}: ${results.length} results`, percent: 72 });
        console.log(`[PSG-Strategy] Forced narrowest layer ${lastLayerIndex}: ${results.length} results`);
      }
    }

    strategyMeta.layersStopped = sweetSpotLayer ?? queries.length - 1;

  } else if (strategy === 'faceted') {
    // Run all pair queries, track frequency
    const patentFreq = new Map<string, number>();
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const percent = 10 + Math.round((i / queries.length) * 60);
      onProgress({ phase: "round1", message: `Pair ${i + 1}/${queries.length}: ${q.label}...`, percent });

      const tabOk = await verifyTab(tabId, `faceted-pair-${i}`);
      if (!tabOk) break;

      const start = Date.now();
      totalSearchCount++;
      const searchResult = await runSingleSearchFull(tabId, q.query, 35);
      if (searchResult.googleUnavailable) googleUnavailableCount++;
      const results = searchResult.results;
      searchLog.push({ round: 1, label: q.label, query: q.query, resultCount: results.length, durationMs: Date.now() - start });

      if (results.length > 0) {
        allResultSets.push({ results, source: `round1-${q.label}` as ProFoundBySource });
        for (const p of results) {
          if (p.patentId) patentFreq.set(p.patentId, (patentFreq.get(p.patentId) || 0) + 1);
        }
      }
    }
    strategyMeta.pairCount = queries.length;
    // Build frequency distribution
    const freqDist: Record<number, number> = {};
    for (const count of patentFreq.values()) {
      freqDist[count] = (freqDist[count] || 0) + 1;
    }
    strategyMeta.frequencyDistribution = freqDist;

  } else {
    // Telescoping: run each B/M/N query
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const percent = 10 + Math.round((i / queries.length) * 60);
      onProgress({ phase: "round1", message: `${q.label}: searching...`, percent });

      const tabOk = await verifyTab(tabId, `telescoping-${i}`);
      if (!tabOk) break;

      const start = Date.now();
      totalSearchCount++;
      const searchResult = await runSingleSearchFull(tabId, q.query, 35);
      if (searchResult.googleUnavailable) googleUnavailableCount++;
      const results = searchResult.results;
      searchLog.push({ round: 1, label: q.label, query: q.query, resultCount: results.length, durationMs: Date.now() - start });

      if (results.length > 0) {
        allResultSets.push({ results, source: `round1-${q.label}` as ProFoundBySource });
      }
    }
  }

  // Check if Google Patents was unavailable for all searches
  if (totalSearchCount > 0 && googleUnavailableCount >= totalSearchCount) {
    const queryList = queries.map(q => ({ label: q.label, query: q.query }));
    throw new GoogleUnavailableError(
      "Google Patents is temporarily unavailable. Your generated queries are shown below.",
      queryList,
      1 // 1 credit for generate-strategy-searches AI call
    );
  }

  // Dedup
  onProgress({ phase: "deep-scrape", message: "Deduplicating results...", percent: 75 });
  const mergedMap = deduplicatePatents(allResultSets);
  console.log(`[PSG-Strategy] Quick merged: ${mergedMap.size} unique patents`);

  if (mergedMap.size === 0) {
    throw new Error("No results found across all strategy queries. Try adjusting your concepts.");
  }

  // Deep scrape
  onProgress({ phase: "deep-scrape", message: `Deep scraping ${mergedMap.size} patents...`, percent: 80 });
  const allFinalPatents = await deepScrapeAndEnrich(tabId, mergedMap, new Set(), (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 88 });
  });

  const bqEnrichedPatents = allFinalPatents; // BigQuery removed

  // Store results
  onProgress({ phase: "done", message: "Opening results page...", percent: 95 });
  const storagePayload = {
    patentResults: {
      query: originalParagraph,
      patents: bqEnrichedPatents,
      totalAvailable: 100,
      page: 1,
      concepts: concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms, importance: c.importance, category: (c as any).category })),
      searchMeta: {
        mode: 'quick' as const,
        strategy: strategyMeta.strategy,
        depth: strategyMeta.depth,
        mergeCount: strategyMeta.mergeCount,
        layersStopped: strategyMeta.layersStopped,
        pairCount: strategyMeta.pairCount,
        frequencyDistribution: strategyMeta.frequencyDistribution,
        uniqueCount: mergedMap.size,
        searchLog,
        totalDurationMs: Date.now() - searchStartTime,
      },
    },
  };

  await chrome.storage.local.set(storagePayload);
  const resultsTab = await chrome.tabs.create({ url: chrome.runtime.getURL("results.html"), active: true });
  if (resultsTab.id) {
    await chrome.tabs.update(resultsTab.id, { active: true });
    if (resultsTab.windowId) await chrome.windows.update(resultsTab.windowId, { focused: true });
  }

  onProgress({ phase: "done", message: "Done!", percent: 100 });
  console.log(`[PSG-Strategy] ========== QUICK ${strategy.toUpperCase()} COMPLETE ==========`);
}

// ── Pro Auto Depth Executor ──

async function executeProAutoDepth(
  strategy: SearchStrategy,
  queries: StrategySearchQuery[],
  concepts: ConceptForSearch[],
  mergeResult: MergeResult,
  originalParagraph: string,
  onProgress: (progress: ProSearchProgress) => void
): Promise<void> {
  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];
  const strategyMeta: StrategySearchMeta = {
    strategy, depth: 'pro-auto', mergeCount: mergeResult.mergeCount,
  };

  onProgress({ phase: "round1", message: "Preparing search...", percent: 0 });
  const tabId = await ensurePatentsTab();
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SEARCH_CONFIG", includeNPL: true });
  } catch { /* may fail on landing page */ }

  // Round 1: Execute strategy queries
  onProgress({ phase: "round1", message: `Round 1: ${strategy} queries...`, percent: 3 });
  const round1ResultSets: ResultSet[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const percent = 5 + Math.round((i / queries.length) * 20);
    onProgress({ phase: "round1", message: `Round 1: ${q.label}...`, percent });

    const tabOk = await verifyTab(tabId, `r1-strategy-${i}`);
    if (!tabOk) break;

    const start = Date.now();
    const results = await runSingleSearch(tabId, q.query, 35);
    searchLog.push({ round: 1, label: q.label, query: q.query, resultCount: results.length, durationMs: Date.now() - start });

    if (results.length > 0) {
      round1ResultSets.push({ results, source: `round1-${q.label}` as ProFoundBySource });
    }
  }

  const round1Map = deduplicatePatents(round1ResultSets);
  console.log(`[PSG-Strategy] Pro Auto Round 1: ${round1Map.size} unique patents`);

  if (round1Map.size === 0) {
    throw new Error("Round 1 returned no results. Try adjusting your concepts.");
  }

  // Deep scrape Round 1
  onProgress({ phase: "round1", message: "Deep scraping Round 1...", percent: 28 });
  const round1Scraped = await deepScrapeAndEnrich(tabId, round1Map, new Set(), (msg) => {
    onProgress({ phase: "round1", message: msg, percent: 32 });
  });
  const scrapedIds = new Set(round1Scraped.map((p: any) => p.patentId));

  // AI analysis — deduct full pipeline credit cost on this first AI call
  const pipelineCreditCost = getStrategyCreditCost('pro-auto');
  onProgress({ phase: "analyzing", message: "AI analyzing Round 1...", percent: 38 });
  let analysisResult: AnalyzeRoundResponse;
  let topPatentIds: string[];
  try {
    analysisResult = await analyzeRound({
      originalConcepts: concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms })),
      roundResults: round1Scraped.map((p: any) => ({
        patentId: p.patentId, title: p.title, abstract: p.abstract,
        fullAbstract: p.fullAbstract, cpcCodes: p.cpcCodes || [],
      })),
      roundNumber: 1,
      originalParagraph,
    }, pipelineCreditCost);
    topPatentIds = analysisResult.topPatentIds?.slice(0, 5) || [];
  } catch (err) {
    console.error("[PSG-Strategy] Analysis failed:", err);
    analysisResult = { cpcSuggestions: [], terminologySwaps: [], conceptHealth: [], refinedConcepts: [], topPatentIds: [] };
    topPatentIds = selectDiverseAnchors(round1Scraped, 5);
  }

  // Similarity searches — quality gate
  const conceptsForCov2 = concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms }));
  const qualifiedAnchors2 = topPatentIds.filter(pid => {
    const patent = round1Scraped.find((p: any) => p.patentId === pid);
    if (!patent) return false;
    const text = [patent.abstract || '', patent.fullAbstract || '', patent.title || ''].join(' ');
    const coverage = scoreConceptCoverage(conceptsForCov2, text);
    console.log(`[PSG-Strategy] Anchor quality gate: ${pid} coverage=${coverage}%`);
    return coverage >= 50;
  });
  console.log(`[PSG-Strategy] Similarity anchors: ${topPatentIds.length} → ${qualifiedAnchors2.length} qualified`);

  onProgress({ phase: "similarity", message: "Running similarity searches...", percent: 48 });
  const similarityResults: ResultSet[] = [];
  for (let i = 0; i < qualifiedAnchors2.length; i++) {
    const patentId = qualifiedAnchors2[i];
    onProgress({ phase: "similarity", message: `Similarity ${i + 1}/${qualifiedAnchors2.length}: ${patentId}...`, percent: 48 + (i * 8) });
    const tabOk = await verifyTab(tabId, `sim-${i}`);
    if (!tabOk) break;
    const simStart = Date.now();
    const simResults = await runSingleSearch(tabId, `~patent/${patentId}`, 35);
    if (simResults.length > 0) {
      similarityResults.push({ results: simResults, source: `similar-${patentId}` as ProFoundBySource });
    }
    searchLog.push({ round: 1, label: `Similarity: ${patentId}`, query: `~patent/${patentId}`, resultCount: simResults.length, durationMs: Date.now() - simStart });
  }

  // Round 2: Refined strategy queries
  onProgress({ phase: "round2", message: "Round 2: Refined queries...", percent: 70 });
  const tabOkR2 = await verifyTab(tabId, "pre-round2");
  if (!tabOkR2) throw new Error("Tab lost before Round 2");

  let round2Concepts: ConceptForSearch[];
  let round2CPCs: string[] = [];
  if (analysisResult.refinedConcepts && analysisResult.refinedConcepts.length > 0) {
    // Build a lookup of original concepts by name for inheriting modifiers/nouns
    const originalByName = new Map<string, ConceptForSearch>();
    for (const c of concepts) {
      originalByName.set(c.name.toLowerCase(), c);
    }

    round2Concepts = analysisResult.refinedConcepts.map(rc => {
      // Find the matching original concept to carry forward modifiers/nouns
      const original = originalByName.get(rc.name.toLowerCase());
      return {
        name: rc.name,
        synonyms: rc.synonyms || [],
        modifiers: original?.modifiers,
        nouns: original?.nouns,
        enabled: true,
        importance: original?.importance || 'high' as const,
      };
    });
    for (const rc of analysisResult.refinedConcepts) {
      for (const code of rc.addedCPCCodes || []) {
        if (!round2CPCs.includes(code)) round2CPCs.push(code);
      }
    }
  } else {
    round2Concepts = concepts;
  }

  // Generate Round 2 queries using same strategy with refined concepts
  const round2Queries = await getStrategyQueries(round2Concepts, strategy);
  const round2ResultSets: ResultSet[] = [];

  for (let i = 0; i < round2Queries.length; i++) {
    const q = round2Queries[i];
    // Append CPC codes with semicolon syntax
    let queryStr = q.query;
    if (round2CPCs.length > 0) {
      const cpcSuffix = round2CPCs.map(c => `(${c})`).join(";");
      queryStr = `${queryStr};${cpcSuffix}`;
    }
    const percent = 72 + Math.round((i / round2Queries.length) * 10);
    onProgress({ phase: "round2", message: `Round 2: ${q.label}...`, percent });

    const tabOk = await verifyTab(tabId, `r2-strategy-${i}`);
    if (!tabOk) break;

    const start = Date.now();
    const results = await runSingleSearch(tabId, queryStr, 35);
    searchLog.push({ round: 2, label: q.label, query: queryStr, resultCount: results.length, durationMs: Date.now() - start });

    if (results.length > 0) {
      round2ResultSets.push({ results, source: "round2-refined" as ProFoundBySource });
    }
  }

  // Final merge
  onProgress({ phase: "deep-scrape", message: "Merging and deduplicating...", percent: 84 });
  const allResultSets: ResultSet[] = [...round1ResultSets, ...similarityResults, ...round2ResultSets];
  const mergedMap = deduplicatePatents(allResultSets);

  if (mergedMap.size === 0) {
    throw new Error("No results found across all search rounds.");
  }

  // Deep scrape new
  onProgress({ phase: "deep-scrape", message: "Deep scraping new patents...", percent: 88 });
  const allFinalPatents = await deepScrapeAndEnrich(tabId, mergedMap, scrapedIds, (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 92 });
  });

  const bqEnrichedPatents = allFinalPatents; // BigQuery removed

  // Store
  onProgress({ phase: "done", message: "Opening results page...", percent: 96 });
  const storagePayload = {
    patentResults: {
      query: originalParagraph,
      patents: bqEnrichedPatents,
      totalAvailable: 100,
      page: 1,
      concepts: concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms, importance: c.importance, category: (c as any).category })),
      searchMeta: {
        mode: 'pro-auto' as const,
        strategy: strategyMeta.strategy,
        depth: strategyMeta.depth,
        mergeCount: strategyMeta.mergeCount,
        round1Count: round1Map.size,
        round2Count: round2ResultSets.reduce((sum, rs) => sum + rs.results.length, 0),
        similarityCount: similarityResults.reduce((sum, rs) => sum + rs.results.length, 0),
        uniqueCount: mergedMap.size,
        searchLog,
        totalDurationMs: Date.now() - searchStartTime,
      },
    },
  };

  await chrome.storage.local.set(storagePayload);
  const resultsTab = await chrome.tabs.create({ url: chrome.runtime.getURL("results.html"), active: true });
  if (resultsTab.id) {
    await chrome.tabs.update(resultsTab.id, { active: true });
    if (resultsTab.windowId) await chrome.windows.update(resultsTab.windowId, { focused: true });
  }

  onProgress({ phase: "done", message: "Done!", percent: 100 });
  console.log(`[PSG-Strategy] ========== PRO AUTO ${strategy.toUpperCase()} COMPLETE ==========`);
}

// ── Pro Interactive Depth Executor ──

async function executeProInteractiveDepth(
  strategy: SearchStrategy,
  queries: StrategySearchQuery[],
  concepts: ConceptForSearch[],
  mergeResult: MergeResult,
  originalParagraph: string,
  onProgress: (progress: ProSearchProgress) => void,
  onPause: (data: RefinementDashboardData) => Promise<UserRefinementSelections>
): Promise<void> {
  const searchStartTime = Date.now();
  const searchLog: SearchLogEntry[] = [];
  const strategyMeta: StrategySearchMeta = {
    strategy, depth: 'pro-interactive', mergeCount: mergeResult.mergeCount,
  };

  onProgress({ phase: "round1", message: "Preparing search...", percent: 0 });
  const tabId = await ensurePatentsTab();
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SEARCH_CONFIG", includeNPL: true });
  } catch { /* may fail on landing page */ }

  // Round 1: Execute strategy queries
  onProgress({ phase: "round1", message: `Round 1: ${strategy} queries...`, percent: 2 });
  const round1ResultSets: ResultSet[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const percent = 3 + Math.round((i / queries.length) * 12);
    onProgress({ phase: "round1", message: `Round 1: ${q.label}...`, percent });

    const tabOk = await verifyTab(tabId, `r1i-strategy-${i}`);
    if (!tabOk) break;

    const start = Date.now();
    const results = await runSingleSearch(tabId, q.query, 35);
    searchLog.push({ round: 1, label: q.label, query: q.query, resultCount: results.length, durationMs: Date.now() - start });

    if (results.length > 0) {
      round1ResultSets.push({ results, source: `round1-${q.label}` as ProFoundBySource });
    }
  }

  const round1Map = deduplicatePatents(round1ResultSets);
  if (round1Map.size === 0) {
    throw new Error("Round 1 returned no results. Try adjusting your concepts.");
  }

  // Deep scrape Round 1
  onProgress({ phase: "round1", message: "Deep scraping Round 1...", percent: 16 });
  const round1Scraped = await deepScrapeAndEnrich(tabId, round1Map, new Set(), (msg) => {
    onProgress({ phase: "round1", message: msg, percent: 19 });
  });
  const scrapedIds = new Set(round1Scraped.map((p: any) => p.patentId));

  // AI analysis — deduct full pipeline credit cost on first AI call
  const pipelineCreditCost = getStrategyCreditCost('pro-interactive');
  onProgress({ phase: "analyzing", message: "AI analyzing Round 1...", percent: 22 });
  let analysis1: AnalyzeRoundResponse;
  try {
    analysis1 = await analyzeRound({
      originalConcepts: concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms })),
      roundResults: round1Scraped.map((p: any) => ({
        patentId: p.patentId, title: p.title, abstract: p.abstract,
        fullAbstract: p.fullAbstract, cpcCodes: p.cpcCodes || [],
      })),
      roundNumber: 1,
      originalParagraph,
    }, pipelineCreditCost);
  } catch {
    analysis1 = { cpcSuggestions: [], terminologySwaps: [], conceptHealth: [], refinedConcepts: [], topPatentIds: [] };
  }

  // PAUSE 1
  onProgress({ phase: "analyzing", message: "Waiting for your selections...", percent: 25 });
  const userSelections1 = await onPause({
    roundNumber: 1,
    patents: round1Scraped,
    cpcSuggestions: analysis1.cpcSuggestions || [],
    terminologySwaps: analysis1.terminologySwaps || [],
    conceptHealth: analysis1.conceptHealth || [],
  });

  // Round 2: Refined strategy queries + similarity
  onProgress({ phase: "round2", message: "Round 2: Refined search...", percent: 30 });
  const updatedConcepts = userSelections1.updatedConcepts.length > 0 ? userSelections1.updatedConcepts : concepts;

  const round2Queries = await getStrategyQueries(updatedConcepts, strategy);
  const round2ResultSets: ResultSet[] = [];

  for (let i = 0; i < round2Queries.length; i++) {
    const q = round2Queries[i];
    let queryStr = q.query;
    if (userSelections1.selectedCPCCodes.length > 0) {
      const cpcSuffix = userSelections1.selectedCPCCodes.map(c => `(${c})`).join(";");
      queryStr = `${queryStr};${cpcSuffix}`;
    }

    const tabOk = await verifyTab(tabId, `r2i-strategy-${i}`);
    if (!tabOk) break;

    const start = Date.now();
    const results = await runSingleSearch(tabId, queryStr, 35);
    searchLog.push({ round: 2, label: q.label, query: queryStr, resultCount: results.length, durationMs: Date.now() - start });

    if (results.length > 0) {
      round2ResultSets.push({ results, source: "round2-refined" as ProFoundBySource });
    }
  }

  // Similarity from user-selected patents
  onProgress({ phase: "similarity", message: "Running similarity searches...", percent: 45 });
  const simResults1: ResultSet[] = [];
  const simPatents = userSelections1.selectedPatentIds.slice(0, 5);
  for (let i = 0; i < simPatents.length; i++) {
    const patentId = simPatents[i];
    const tabOk = await verifyTab(tabId, `sim1-${i}`);
    if (!tabOk) break;
    const simStart = Date.now();
    const results = await runSingleSearch(tabId, `~patent/${patentId}`, 35);
    if (results.length > 0) {
      simResults1.push({ results, source: `similar-${patentId}` as ProFoundBySource });
    }
    searchLog.push({ round: 2, label: `Similarity: ${patentId}`, query: `~patent/${patentId}`, resultCount: results.length, durationMs: Date.now() - simStart });
  }

  // Merge & deep scrape mid-results
  const midSets: ResultSet[] = [...round1ResultSets, ...round2ResultSets, ...simResults1];
  const midMerged = deduplicatePatents(midSets);
  onProgress({ phase: "deep-scrape", message: "Deep scraping Round 2...", percent: 55 });
  const midScraped = await deepScrapeAndEnrich(tabId, midMerged, scrapedIds, (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 58 });
  });
  for (const p of midScraped) scrapedIds.add(p.patentId);

  // AI analysis round 2
  onProgress({ phase: "analyzing", message: "AI analyzing combined results...", percent: 62 });
  let analysis2: AnalyzeRoundResponse;
  try {
    analysis2 = await analyzeRound({
      originalConcepts: updatedConcepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms })),
      roundResults: midScraped.map((p: any) => ({
        patentId: p.patentId, title: p.title, abstract: p.abstract,
        fullAbstract: p.fullAbstract, cpcCodes: p.cpcCodes || [],
      })),
      roundNumber: 2,
      originalParagraph,
    });
  } catch {
    analysis2 = { cpcSuggestions: [], terminologySwaps: [], conceptHealth: [], refinedConcepts: [], topPatentIds: [] };
  }

  // PAUSE 2
  onProgress({ phase: "analyzing", message: "Waiting for Round 2 selections...", percent: 66 });
  const userSelections2 = await onPause({
    roundNumber: 2,
    patents: midScraped,
    cpcSuggestions: analysis2.cpcSuggestions || [],
    terminologySwaps: analysis2.terminologySwaps || [],
    conceptHealth: analysis2.conceptHealth || [],
  });

  // Round 3: Narrow precision
  onProgress({ phase: "round3", message: "Round 3: Narrow precision search...", percent: 72 });
  const finalConcepts = userSelections2.updatedConcepts.length > 0 ? userSelections2.updatedConcepts : updatedConcepts;

  const tabOkR3 = await verifyTab(tabId, "pre-round3");
  if (!tabOkR3) throw new Error("Tab lost before Round 3");

  // For round 3, use telescoping narrow regardless of strategy (precision search)
  const round3Relaxed = await runSearchWithRelaxation({
    tabId,
    concepts: finalConcepts,
    cpcCodes: userSelections2.selectedCPCCodes,
    level: 'narrow',
    limit: 25,
    source: "round3-narrow",
    onRelaxation: (step) => {
      if (step.action !== 'original') {
        onProgress({ phase: "round3", message: `Round 3: ${step.detail}...`, percent: 75 });
      }
    },
  });
  searchLog.push({ round: 3, label: "Narrow search", query: round3Relaxed.finalQuery, resultCount: round3Relaxed.results.length, relaxationSteps: round3Relaxed.relaxationLog, durationMs: 0 });

  // Similarity from round 2 picks
  const simResults2: ResultSet[] = [];
  const simPatents2 = userSelections2.selectedPatentIds.slice(0, 5);
  for (let i = 0; i < simPatents2.length; i++) {
    const patentId = simPatents2[i];
    const tabOk = await verifyTab(tabId, `sim2-${i}`);
    if (!tabOk) break;
    const sim2Start = Date.now();
    const results = await runSingleSearch(tabId, `~patent/${patentId}`, 35);
    if (results.length > 0) {
      simResults2.push({ results, source: `similar-${patentId}` as ProFoundBySource });
    }
    searchLog.push({ round: 3, label: `Similarity: ${patentId}`, query: `~patent/${patentId}`, resultCount: results.length, durationMs: Date.now() - sim2Start });
  }

  // Final merge
  onProgress({ phase: "deep-scrape", message: "Final merge and deep scrape...", percent: 85 });
  const allResultSets: ResultSet[] = [
    ...round1ResultSets, ...round2ResultSets, ...simResults1,
    { results: round3Relaxed.results, source: "round3-narrow" },
    ...simResults2,
  ];
  const finalMap = deduplicatePatents(allResultSets);

  if (finalMap.size === 0) {
    throw new Error("No results found across all rounds.");
  }

  const allFinalPatents = await deepScrapeAndEnrich(tabId, finalMap, scrapedIds, (msg) => {
    onProgress({ phase: "deep-scrape", message: msg, percent: 90 });
  });

  const bqEnrichedPatents = allFinalPatents; // BigQuery removed

  // Store
  onProgress({ phase: "done", message: "Opening results page...", percent: 96 });
  const storagePayload = {
    patentResults: {
      query: originalParagraph,
      patents: bqEnrichedPatents,
      totalAvailable: 100,
      page: 1,
      concepts: finalConcepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms })),
      searchMeta: {
        mode: 'pro-interactive' as const,
        strategy: strategyMeta.strategy,
        depth: strategyMeta.depth,
        mergeCount: strategyMeta.mergeCount,
        round1Count: round1Map.size,
        round2Count: round2ResultSets.reduce((sum, rs) => sum + rs.results.length, 0),
        round3Count: round3Relaxed.results.length,
        similarityCount: simResults1.reduce((sum, rs) => sum + rs.results.length, 0) + simResults2.reduce((sum, rs) => sum + rs.results.length, 0),
        uniqueCount: finalMap.size,
        searchLog,
        totalDurationMs: Date.now() - searchStartTime,
      },
    },
  };

  await chrome.storage.local.set(storagePayload);
  const resultsTab = await chrome.tabs.create({ url: chrome.runtime.getURL("results.html"), active: true });
  if (resultsTab.id) {
    await chrome.tabs.update(resultsTab.id, { active: true });
    if (resultsTab.windowId) await chrome.windows.update(resultsTab.windowId, { focused: true });
  }

  onProgress({ phase: "done", message: "Done!", percent: 100 });
  console.log(`[PSG-Strategy] ========== PRO INTERACTIVE ${strategy.toUpperCase()} COMPLETE ==========`);
}
