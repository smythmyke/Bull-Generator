/**
 * Stage 2 — Per-Feature Search.
 *
 * For each feature from Stage 1:
 *   1. Call the existing server-side extractConcepts on feature.description
 *      (reuses ai.ts's production-tuned EXTRACT_CONCEPTS_PROMPT)
 *   2. Convert returned concepts (name + modifiers + nouns) to ConceptForSearch
 *   3. Build a "broad" Boolean query via the ported buildSearchesFromConcepts
 *   4. Execute the search server-side via the XHR query endpoint
 *   5. Merge results into a deduped candidate set, tracking foundForFeatures[]
 *
 * Caps:
 *   - PER_FEATURE_LIMIT (30) candidates pulled per feature
 *   - TOTAL_CANDIDATE_CAP (150) unique candidates across all features
 *
 * Cost accounting: each feature consumes 1 Gemini call (concept extraction)
 * and 1 Google Patents fetch (free). Token counts for extractConcepts are
 * estimated (the legacy /extract-concepts handler doesn't report usage);
 * this approximation is acceptable for Phase 0 cost-bound estimates.
 */

import {
  Feature,
  Candidate,
  FtoCostTracking,
  ProgressCallback,
} from "./types";
import { searchGooglePatents } from "./serverSearch";
import { ConceptForSearch, buildSearchesFromConcepts } from "./queryBuilder";
import { extractConcepts } from "../ai";
import { estimateFlashCostUsd } from "./geminiClient";

const PER_FEATURE_LIMIT = 30;
const TOTAL_CANDIDATE_CAP = 150;
// Preemptive pause between consecutive search calls to avoid bursty 503s
// from the Google Patents search XHR endpoint.
const INTER_SEARCH_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RawConcept {
  name?: string;
  category?: string;
  modifiers?: string[];
  nouns?: string[];
  synonyms?: string[];
  importance?: string;
}

interface ConceptsEnvelope {
  concepts?: RawConcept[];
}

function unwrapConceptsResponse(raw: unknown): RawConcept[] {
  let obj: ConceptsEnvelope = {};
  if (Array.isArray(raw)) {
    obj = (raw[0] as ConceptsEnvelope) || {};
  } else if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as ConceptsEnvelope;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as ConceptsEnvelope;
  }
  return obj.concepts || [];
}

function rawConceptsToSearch(rawConcepts: RawConcept[]): ConceptForSearch[] {
  return rawConcepts
    .filter((c) => c.name && typeof c.name === "string")
    .map((c) => {
      const synonyms = Array.from(
        new Set(
          [
            ...(c.synonyms || []),
            ...(c.modifiers || []),
            ...(c.nouns || []),
          ]
            .filter((s) => typeof s === "string" && s.trim().length > 0)
            .filter((s) => s !== c.name)
        )
      );
      return {
        name: c.name as string,
        synonyms,
        enabled: true,
        importance:
          c.importance === "high" || c.importance === "low"
            ? c.importance
            : "medium",
      };
    });
}

/** Fallback if concept extraction returns nothing — build a flat OR query from the feature's own search terms. */
function fallbackQueryFromSearchTerms(feature: Feature): string {
  const terms = feature.searchTerms
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return "";
  return `(${terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ")})`;
}

export interface Stage2Options {
  /** Optional CPC subclass codes (e.g., ["A47G", "G01F"]) to AND onto every per-feature query. */
  productCpcs?: string[];
}

function appendCpcClause(query: string, productCpcs?: string[]): string {
  if (!productCpcs || productCpcs.length === 0) return query;
  const clause = `cpc:(${productCpcs.join(" OR ")})`;
  return query ? `${query} AND ${clause}` : clause;
}

export async function runStage2Search(
  features: Feature[],
  cost: FtoCostTracking,
  onProgress: ProgressCallback,
  options: Stage2Options = {}
): Promise<Candidate[]> {
  const dedupe = new Map<string, Candidate>();

  onProgress(
    "stage2",
    `Searching ${features.length} features…`,
    0,
    features.length
  );

  for (let i = 0; i < features.length; i++) {
    if (i > 0) await sleep(INTER_SEARCH_DELAY_MS);
    const feature = features[i];
    const paragraph = `${feature.name}. ${feature.description}`;

    // ── Concept extraction ──
    let conceptsRaw: unknown;
    try {
      conceptsRaw = await extractConcepts({ paragraph });
    } catch (e) {
      onProgress(
        "stage2",
        `Concept extraction failed for ${feature.id}: ${(e as Error).message} — falling back to feature.searchTerms`
      );
    }

    cost.geminiCalls += 1;
    // extractConcepts in ai.ts does not currently expose usage metadata; estimate from payload sizes.
    const approxInputTokens = Math.ceil(paragraph.length / 4) + 600; // ~600 for prompt boilerplate
    const approxOutputTokens = Math.ceil(JSON.stringify(conceptsRaw || {}).length / 4);
    cost.inputTokens += approxInputTokens;
    cost.outputTokens += approxOutputTokens;
    cost.estimatedCostUsd += estimateFlashCostUsd(
      approxInputTokens,
      approxOutputTokens
    );

    const rawConcepts = unwrapConceptsResponse(conceptsRaw);
    const concepts = rawConceptsToSearch(rawConcepts);

    // ── Query construction ──
    let query = "";
    if (concepts.length > 0) {
      const built = buildSearchesFromConcepts(concepts);
      query = built.broad;
    }
    if (!query) {
      query = fallbackQueryFromSearchTerms(feature);
    }
    if (!query) {
      onProgress(
        "stage2",
        `No usable query for ${feature.id} — skipping (feature description may be too thin)`
      );
      continue;
    }
    query = appendCpcClause(query, options.productCpcs);

    // ── Execute search ──
    let outcome;
    try {
      outcome = await searchGooglePatents({
        query,
        limit: PER_FEATURE_LIMIT,
      });
      cost.googlePatentsFetches += 1;
    } catch (e) {
      onProgress(
        "stage2",
        `Search failed for ${feature.id}: ${(e as Error).message}`
      );
      continue;
    }

    // ── Merge into deduped candidate set ──
    let added = 0;
    for (const r of outcome.results) {
      const existing = dedupe.get(r.patentNumber);
      if (existing) {
        if (!existing.foundForFeatures.includes(feature.id)) {
          existing.foundForFeatures.push(feature.id);
        }
        continue;
      }
      if (dedupe.size >= TOTAL_CANDIDATE_CAP) continue;
      dedupe.set(r.patentNumber, {
        patentNumber: r.patentNumber,
        title: r.title,
        assignee: r.assignee,
        foundForFeatures: [feature.id],
        snippet: r.snippet,
        priorityDate: r.priorityDate,
        filingDate: r.filingDate,
        grantDate: r.grantDate,
        publicationDate: r.publicationDate,
        searchCountryStatus: r.countryStatus,
        isSimilarDocument: r.isSimilarDocument,
      });
      added += 1;
    }

    onProgress(
      "stage2",
      `Feature ${feature.id} (${feature.name}) → ${outcome.results.length} hits, +${added} new (${dedupe.size}/${TOTAL_CANDIDATE_CAP} unique total)`,
      i + 1,
      features.length
    );
  }

  const candidates = Array.from(dedupe.values());
  onProgress(
    "stage2",
    `Stage 2 complete — ${candidates.length} unique candidates from ${features.length} features`
  );
  return candidates;
}
