/**
 * Boolean query builder for FTO Stage 2.
 *
 * Ported from extension-src/src/utils/conceptSearchBuilder.ts (pure
 * functions, no Chrome/DOM dependencies, safe to run server-side).
 *
 * Only the broad/moderate/narrow tier construction is needed for FTO.
 * Field operators and CPC clauses are not ported yet — add when a
 * stage actually needs them.
 */

export interface ConceptForSearch {
  name: string;
  synonyms: string[];
  enabled: boolean;
  importance?: "high" | "medium" | "low";
}

export interface GeneratedSearches {
  broad: string;
  moderate: string;
  narrow: string;
}

function quoteTerm(term: string): string {
  if (term.includes(" ")) return `"${term}"`;
  return term;
}

function buildGroup(terms: string[]): string {
  const unique = Array.from(new Set(terms.filter((t) => t && t.trim())));
  if (unique.length === 0) return "";
  if (unique.length === 1) return quoteTerm(unique[0]);
  return `(${unique.map(quoteTerm).join(" OR ")})`;
}

export function buildSearchesFromConcepts(
  concepts: ConceptForSearch[]
): GeneratedSearches {
  const enabled = concepts.filter((c) => c.enabled);
  if (enabled.length === 0) {
    return { broad: "", moderate: "", narrow: "" };
  }

  const buildAtDepth = (synLimit: number): string =>
    enabled
      .map((c) => buildGroup([c.name, ...c.synonyms.slice(0, synLimit)]))
      .filter((g) => g.length > 0)
      .join(" AND ");

  return {
    broad: buildAtDepth(5),
    moderate: buildAtDepth(3),
    narrow: buildAtDepth(1),
  };
}
