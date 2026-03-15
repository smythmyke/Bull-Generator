import { ConceptForSearch, buildGroup } from "./conceptSearchBuilder";

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

function quoteTerm(term: string): string {
  if (term.includes(' ')) return `"${term}"`;
  return term;
}

/** Build a group with optional wildcard truncation */
function buildWildcardGroup(terms: string[]): string {
  if (terms.length === 0) return "";
  const processed = terms.map(t => {
    // Multi-word terms get quoted, not wildcarded
    if (t.includes(' ')) return `"${t}"`;
    // Single words >= 4 chars get wildcard truncation
    if (t.length >= 4 && !t.endsWith('*')) return `${t}*`;
    return t;
  });
  if (processed.length === 1) return processed[0];
  return `(${processed.join(" OR ")})`;
}

// ── Telescoping Strategy ──

/**
 * Build 3 queries (Broad/Moderate/Narrow) using only Google Patents-compatible operators.
 * - Broad: top 2 high-importance concepts, up to 5 synonyms, AND only
 * - Moderate: top 2-3 concepts, 3-4 synonyms, AND only
 * - Narrow: top 2 concepts, 2-3 synonyms, AND only (fewest OR terms = most restrictive)
 */
export function buildTelescopingQueries(concepts: ConceptForSearch[]): StrategyQuery[] {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length === 0) return [];

  const sorted = sortByImportance(enabled);

  // Broad: top 2, up to 5 synonyms, AND only
  const broadConcepts = sorted.slice(0, 2);
  const broadGroups = broadConcepts.map(c => {
    const terms = [c.name, ...c.synonyms.slice(0, 5)];
    return buildWildcardGroup(terms);
  });
  const broad = broadGroups.join(" AND ");

  // Moderate: top 3, 3-4 synonyms, AND between groups
  const modConcepts = sorted.slice(0, Math.min(3, sorted.length));
  const modGroups = modConcepts.map(c => {
    const terms = [c.name, ...c.synonyms.slice(0, 3)];
    return buildWildcardGroup(terms);
  });
  const moderate = modGroups.join(" AND ");

  // Narrow: top 2, 2-3 synonyms, AND between groups
  const narrowConcepts = sorted.slice(0, 2);
  const narrowGroups = narrowConcepts.map(c => {
    const terms = [c.name, ...c.synonyms.slice(0, 2)];
    return buildWildcardGroup(terms);
  });
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
 * Layer N: all concepts (narrowest)
 * Sweet spot is found at runtime by tracking result counts.
 */
export function buildOnionRingQueries(concepts: ConceptForSearch[]): StrategyQuery[] {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length === 0) return [];

  const sorted = sortByImportance(enabled);
  const queries: StrategyQuery[] = [];

  // Start with 2 concepts, add one at a time (max 3 AND groups for Google Patents)
  const minGroups = Math.min(2, sorted.length);
  const maxGroups = Math.min(sorted.length, 3); // Google Patents nesting limit

  for (let count = minGroups; count <= maxGroups; count++) {
    const subset = sorted.slice(0, count);
    const groups = subset.map(c => {
      const terms = [c.name, ...c.synonyms.slice(0, 5)];
      return buildWildcardGroup(terms);
    });
    const query = groups.join(" AND ");
    queries.push({
      label: `Layer ${count - minGroups} (${count} concepts)`,
      query,
    });
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
      const terms = [enabled[0].name, ...enabled[0].synonyms];
      return [{ label: `${enabled[0].name}`, query: buildWildcardGroup(terms) }];
    }
    return [];
  }

  const sorted = sortByImportance(enabled);
  const queries: StrategyQuery[] = [];

  // 1. Anchor query: top 3 concepts ANDed (Google Patents max nesting)
  const anchorConcepts = sorted.slice(0, 3);
  const anchorGroups = anchorConcepts.map(c => {
    const terms = [c.name, ...c.synonyms.slice(0, 5)];
    return buildWildcardGroup(terms);
  });
  queries.push({
    label: "Anchor (top concepts)",
    query: anchorGroups.join(" AND "),
  });

  // 2. Drop-one variants: drop least important first, cap at 3
  const reverseSorted = [...sorted].reverse();
  const maxDrops = Math.min(reverseSorted.length, 3);

  for (let i = 0; i < maxDrops && queries.length < FACETED_MAX_QUERIES; i++) {
    const dropped = reverseSorted[i];
    const remaining = sorted.filter(c => c.name !== dropped.name).slice(0, 3); // max 3 AND groups
    if (remaining.length === 0) continue;

    const groups = remaining.map(c => {
      const terms = [c.name, ...c.synonyms.slice(0, 5)];
      return buildWildcardGroup(terms);
    });
    queries.push({
      label: `Without "${dropped.name}"`,
      query: groups.join(" AND "),
    });
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

    // Skip triplets that are identical to a drop-one query (same concepts)
    const existingKeySets = new Set(
      queries.map(q => q.label) // labels are unique enough for dedup
    );

    for (const triplet of triplets) {
      if (queries.length >= FACETED_MAX_QUERIES) break;

      // Build a key from sorted concept names to check for duplicates
      const tripletKey = triplet.concepts.map(c => c.name).sort().join("|");
      // A drop-one with N concepts and a triplet of N-1 concepts could overlap
      // when enabled.length === 4 and we drop 1 → 3 remaining = triplet
      const isDuplicate = queries.some(q => {
        // Match by checking if the query label references the same concept set
        // For drop-one: "Without X" means all concepts except X
        if (!q.label.startsWith('Without "')) return false;
        const droppedName = q.label.slice(9, -1);
        const dropOneKey = sorted.filter(c => c.name !== droppedName).map(c => c.name).sort().join("|");
        return dropOneKey === tripletKey;
      });

      if (isDuplicate) continue;

      const groups = triplet.concepts.map(c => {
        const terms = [c.name, ...c.synonyms.slice(0, 5)];
        return buildWildcardGroup(terms);
      });
      queries.push({
        label: `${triplet.concepts.map(c => c.name).join(" + ")}`,
        query: groups.join(" AND "),
      });
    }
  }

  return queries;
}

// ── Credit Costs ──

export function getStrategyCreditCost(depth: SearchDepth, strategy: SearchStrategy): number {
  const baseCost: Record<SearchDepth, number> = {
    quick: 1,
    'pro-auto': 2,
    'pro-interactive': 3,
  };
  const surcharge = strategy === 'faceted' ? 1 : 0;
  return baseCost[depth] + surcharge;
}
