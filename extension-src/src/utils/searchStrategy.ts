import { ConceptForSearch, buildGroup } from "./conceptSearchBuilder";

// ── Seeded Shuffle ──

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    const j = ((s >>> 0) % (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── Types ──

export type SearchStrategy = 'telescoping' | 'onion-ring' | 'faceted';
export type SearchDepth = 'quick' | 'pro-auto' | 'pro-interactive';

export const STRATEGY_DEPTH_DEFAULTS: Record<SearchDepth, SearchStrategy> = {
  quick: 'telescoping',
  'pro-auto': 'onion-ring',
  'pro-interactive': 'faceted',
};

export interface StrategyQuery {
  label: string;
  query: string;
}

// ── Helpers ──

/** Sort concepts by importance: high first, then medium, then low */
function sortByImportance(concepts: ConceptForSearch[]): ConceptForSearch[] {
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...concepts].sort(
    (a, b) => (order[a.importance || 'medium'] ?? 1) - (order[b.importance || 'medium'] ?? 1)
  );
}

/**
 * Strip a word to its root stem for truncation.
 * Removes common English suffixes so `$` wildcard catches all forms.
 * e.g., "construction" → "construct", "portable" → "portab", "mounting" → "mount"
 *
 * Keeps stem >= 5 chars to avoid over-broad matches like port$, sign$, sens$.
 */
function stemWord(word: string): string {
  const w = word.toLowerCase();

  // Already short — don't stem further
  if (w.length < 6) return w;

  // Order matters: try longest suffixes first
  const suffixes = [
    'isation', 'ization',                     // organization → organis/organiz (7 chars ok)
    'ational', 'ioning',                      // operational → operat
    'ically',                                 // electronically → electron
    'ation', 'ment', 'ible', 'able',          // construction → construct, foldable → fold? no, 4 < 5 → foldab
    'ting', 'ning', 'ring', 'ling', 'ding',   // mounting → mount, controlling → controll
    'ive', 'ous', 'ful', 'ant', 'ent',        // adaptive → adapt? no, 5 char check → adapt is exactly 5, ok
    'ing', 'ion', 'ure',                      // folding → fold? no, 4 < 5 → keep as "folding"
    'ed', 'er', 'ly', 'al',                   // mounted → mount, controller → controll
    'le', 'es',                               // portable → portab, devices → devic
    'or',                                     // sensor → senso (5 chars ok)
    's',                                       // machines → machine
  ];

  for (const suffix of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 5) {
      return w.slice(0, w.length - suffix.length);
    }
  }

  return w;
}

/**
 * Truncate a single term with `$` (Google Patents multi-char wildcard).
 * - Single words: stemmed to root then `$` appended (e.g., "construction" → "construct$")
 * - Multi-word: quoted phrase (no truncation on phrases)
 * - Already truncated: pass through
 * - Short words (< 4 chars): left as-is (no wildcard to avoid over-broad)
 */
function truncateTerm(t: string): string {
  if (t.includes(' ')) return `"${t}"`;
  if (t.endsWith('$') || t.endsWith('*')) return t;

  const stem = stemWord(t);
  if (stem.length >= 4) return `${stem}$`;

  // Stem too short — use the original word without truncation
  return t;
}

/** Build a deduplicated OR group from a list of terms with truncation */
function buildTruncatedOrGroup(terms: string[]): string {
  if (terms.length === 0) return "";
  const seen = new Set<string>();
  const processed: string[] = [];

  for (const t of terms) {
    const truncated = truncateTerm(t);
    const key = truncated.toLowerCase().replace(/["$*]/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      processed.push(truncated);
    }
  }

  if (processed.length === 1) return processed[0];
  return `(${processed.join(" OR ")})`;
}

/** Default proximity distance for modifier NEAR noun */
const NEAR_DISTANCE = 15;

/**
 * Split hyphenated compound terms into individual words.
 * e.g., "water-activated" → ["water", "activated"]
 *       "self-inflating" → ["self", "inflating"]
 *       "dog" → ["dog"] (unchanged)
 */
function splitHyphenatedTerms(terms: string[]): string[] {
  const result: string[] = [];
  for (const t of terms) {
    if (t.includes('-')) {
      for (const part of t.split('-')) {
        const trimmed = part.trim();
        if (trimmed.length >= 3) result.push(trimmed);
      }
    } else {
      result.push(t);
    }
  }
  // Deduplicate
  return [...new Set(result)];
}

/**
 * Build a concept search group using proximity pairing when modifiers/nouns are available.
 *
 * With modifiers + nouns (new AI format):
 *   (foldable$ OR bendable$ OR flexible$) NEAR/15 (device$ OR phone$ OR apparatus$)
 *   This ensures generic nouns only match when near specific modifiers.
 *
 * Without modifiers/nouns (legacy flat synonyms):
 *   Falls back to flat OR group with truncation.
 *
 * @param maxModifiers Max modifier terms to include (controls breadth)
 * @param maxNouns Max noun terms to include
 */
function buildConceptGroup(
  concept: ConceptForSearch,
  maxModifiers: number = 6,
  maxNouns: number = 4,
  shuffleSeed?: number,
): string {
  const mods = concept.modifiers;
  const nouns = concept.nouns;

  // If we have modifiers + nouns, build proximity pair
  if (mods && mods.length > 0 && nouns && nouns.length > 0) {
    // Split hyphenated and multi-word terms into single words
    const cleanMods = splitHyphenatedTerms(mods).flatMap(t => t.includes(' ') ? t.split(/\s+/).filter(w => w.length >= 3) : [t]);
    const cleanNouns = splitHyphenatedTerms(nouns).flatMap(t => t.includes(' ') ? t.split(/\s+/).filter(w => w.length >= 3) : [t]);
    const dedupedMods = [...new Set(cleanMods)];
    const dedupedNouns = [...new Set(cleanNouns)];
    const orderedMods = shuffleSeed !== undefined ? seededShuffle(dedupedMods, shuffleSeed) : dedupedMods;
    const orderedNouns = shuffleSeed !== undefined ? seededShuffle(dedupedNouns, shuffleSeed + 7) : dedupedNouns;
    const modGroup = buildTruncatedOrGroup(orderedMods.slice(0, maxModifiers));
    const nounGroup = buildTruncatedOrGroup(orderedNouns.slice(0, maxNouns));
    return `(${modGroup} NEAR/${NEAR_DISTANCE} ${nounGroup})`;
  }

  // Legacy fallback: flat OR group from synonyms only (no concept name)
  const terms = [...concept.synonyms];
  if (terms.length === 0) terms.push(concept.name);
  const cleanTerms = splitHyphenatedTerms(terms).flatMap(t => t.includes(' ') ? t.split(/\s+/).filter(w => w.length >= 3) : [t]);
  const dedupedTerms = [...new Set(cleanTerms)];
  const orderedTerms = shuffleSeed !== undefined ? seededShuffle(dedupedTerms, shuffleSeed) : dedupedTerms;
  return buildTruncatedOrGroup(orderedTerms.slice(0, maxModifiers + maxNouns));
}

// ── Telescoping Strategy ──

/**
 * Build 3 queries (Broad/Moderate/Narrow) using proximity-paired concept groups.
 * - Broad: top 2 high-importance concepts, full modifier/noun lists
 * - Moderate: top 2-3 concepts, slightly fewer terms
 * - Narrow: top 2 concepts, minimal terms (most restrictive)
 */
export function buildTelescopingQueries(
  concepts: ConceptForSearch[],
  shuffleSeeds?: { broad?: number; moderate?: number; narrow?: number },
): StrategyQuery[] {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length === 0) return [];

  const sorted = sortByImportance(enabled);

  // All tiers use ALL concepts — tier difference is synonym breadth only
  const broadGroups = sorted.map(c => buildConceptGroup(c, 6, 4, shuffleSeeds?.broad));
  const broad = broadGroups.join(" AND ");

  const modGroups = sorted.map(c => buildConceptGroup(c, 4, 3, shuffleSeeds?.moderate));
  const moderate = modGroups.join(" AND ");

  const narrowGroups = sorted.map(c => buildConceptGroup(c, 2, 1, shuffleSeeds?.narrow));
  const narrow = narrowGroups.join(" AND ");

  return [
    { label: "Broad", query: broad },
    { label: "Moderate", query: moderate },
    { label: "Narrow", query: narrow },
  ];
}

// ── Onion Ring Strategy ──

/**
 * Build N layered queries, each adding one more concept group.
 * Layer 0: top 2 concepts (broadest)
 * Layer 1: top 3 concepts
 * Layer N: all concepts up to max 5 (narrowest)
 * Sweet spot is found at runtime by tracking result counts.
 */
export function buildOnionRingQueries(concepts: ConceptForSearch[]): StrategyQuery[] {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length === 0) return [];

  const sorted = sortByImportance(enabled);
  const queries: StrategyQuery[] = [];

  // All layers use ALL concepts — layers differ by synonym breadth
  // Broad: 6 mods / 4 nouns, Moderate: 4/3, Narrow: 2/1
  const layers: { label: string; maxMods: number; maxNouns: number }[] = [
    { label: 'Layer 0 (broad)', maxMods: 6, maxNouns: 4 },
    { label: 'Layer 1 (moderate)', maxMods: 4, maxNouns: 3 },
    { label: 'Layer 2 (narrow)', maxMods: 2, maxNouns: 1 },
  ];

  for (const layer of layers) {
    const groups = sorted.map(c => buildConceptGroup(c, layer.maxMods, layer.maxNouns));
    const query = groups.join(" AND ");
    queries.push({ label: layer.label, query });
  }

  return queries;
}

// ── Faceted Strategy ──

const FACETED_MAX_QUERIES = 8;

/**
 * Combined faceted: anchor + drop-one variants + triplet exploration.
 *
 * Query 0 (Anchor): All enabled concepts ANDed — captures the full invention.
 * Queries 1-3 (Drop-one): Each drops one concept (low-importance first),
 *   exploring adjacent patents when one constraint is relaxed (75-80% context).
 * Queries 4-5 (Triplets): Top 3-concept combinations by importance,
 *   exploring concept intersections (60% context).
 *
 * Onion ring builds up (few → all). Faceted explores outward from all concepts
 * by relaxing constraints and probing intersections.
 */
export function buildFacetedQueries(concepts: ConceptForSearch[]): StrategyQuery[] {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length < 2) {
    if (enabled.length === 1) {
      return [{ label: `${enabled[0].name}`, query: buildConceptGroup(enabled[0]) }];
    }
    return [];
  }

  const sorted = sortByImportance(enabled);
  const queries: StrategyQuery[] = [];

  // Track query text to prevent duplicates
  const seenQueryTexts = new Set<string>();

  const addQuery = (label: string, conceptList: ConceptForSearch[]) => {
    const groups = conceptList.map(c => buildConceptGroup(c, 5, 4));
    const query = groups.join(" AND ");
    if (seenQueryTexts.has(query)) return; // skip duplicate
    seenQueryTexts.add(query);
    queries.push({ label, query });
  };

  // 1. Anchor query: top 3 concepts ANDed
  const anchorConcepts = sorted.slice(0, Math.min(3, sorted.length));
  addQuery("Anchor (top concepts)", anchorConcepts);

  // 2. Drop-one variants: drop least important first, cap at 3
  const reverseSorted = [...sorted].reverse();
  const maxDrops = Math.min(reverseSorted.length, 3);

  for (let i = 0; i < maxDrops && queries.length < FACETED_MAX_QUERIES; i++) {
    const dropped = reverseSorted[i];
    const remaining = sorted.filter(c => c.name !== dropped.name).slice(0, 3);
    if (remaining.length === 0) continue;
    addQuery(`Without "${dropped.name}"`, remaining);
  }

  // 3. Triplet exploration: fill remaining slots with top 3-concept combos
  if (enabled.length >= 3 && queries.length < FACETED_MAX_QUERIES) {
    const importanceScore: Record<string, number> = { high: 3, medium: 2, low: 1 };

    const triplets: { concepts: ConceptForSearch[]; score: number }[] = [];
    for (let i = 0; i < enabled.length; i++) {
      for (let j = i + 1; j < enabled.length; j++) {
        for (let k = j + 1; k < enabled.length; k++) {
          const trio = [enabled[i], enabled[j], enabled[k]];
          const score = trio.reduce((sum, c) => sum + (importanceScore[c.importance || 'medium'] ?? 2), 0);
          triplets.push({ concepts: trio, score });
        }
      }
    }
    triplets.sort((a, b) => b.score - a.score);

    for (const triplet of triplets) {
      if (queries.length >= FACETED_MAX_QUERIES) break;
      addQuery(
        triplet.concepts.map(c => c.name).join(" + "),
        triplet.concepts,
      );
    }
  }

  return queries;
}

// ── Credit Costs ──

export function getStrategyCreditCost(depth: SearchDepth, _strategy?: SearchStrategy): number {
  const baseCost: Record<SearchDepth, number> = {
    quick: 0,
    'pro-auto': 1,
    'pro-interactive': 2,
  };
  return baseCost[depth];
}
