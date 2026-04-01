export interface ConceptForSearch {
  name: string;
  synonyms: string[];          // legacy flat list (backward compat)
  modifiers?: string[];        // specific qualifiers (e.g., "foldable", "bendable")
  nouns?: string[];             // generic objects (e.g., "device", "screen")
  enabled: boolean;
  importance?: 'high' | 'medium' | 'low';
}

export interface GeneratedSearches {
  broad: string;
  moderate: string;
  narrow: string;
}

function quoteTerm(term: string): string {
  // Auto-quote multi-word terms
  if (term.includes(" ")) {
    return `"${term}"`;
  }
  return term;
}

export function buildGroup(terms: string[]): string {
  if (terms.length === 0) return "";
  if (terms.length === 1) return quoteTerm(terms[0]);
  return `(${terms.map(quoteTerm).join(" OR ")})`;
}

export function buildSearchesFromConcepts(
  concepts: ConceptForSearch[]
): GeneratedSearches {
  const enabled = concepts.filter((c) => c.enabled);

  if (enabled.length === 0) {
    return { broad: "", moderate: "", narrow: "" };
  }

  // Broad: name + up to 5 synonyms per concept (Google Patents nesting limit)
  const broadGroups = enabled.map((c) => {
    const terms = [c.name, ...c.synonyms.slice(0, 5)];
    return buildGroup(terms);
  });

  // Moderate: name + top 3 synonyms per concept
  const moderateGroups = enabled.map((c) => {
    const terms = [c.name, ...c.synonyms.slice(0, 3)];
    return buildGroup(terms);
  });

  // Narrow: name + top 1 synonym per concept
  const narrowGroups = enabled.map((c) => {
    const terms = [c.name, ...c.synonyms.slice(0, 1)];
    return buildGroup(terms);
  });

  return {
    broad: broadGroups.join(" AND "),
    moderate: moderateGroups.join(" AND "),
    narrow: narrowGroups.join(" AND "),
  };
}

/**
 * Build a search query that appends CPC code filters.
 * Google Patents format: cpc:(CODE1 OR CODE2)
 */
export function buildSearchWithCPCCodes(
  concepts: ConceptForSearch[],
  cpcCodes: string[],
  level: 'broad' | 'moderate' | 'narrow'
): string {
  const base = buildSearchesFromConcepts(concepts)[level];
  if (!base) return "";
  if (cpcCodes.length === 0) return base;

  const cpcClause = `cpc:(${cpcCodes.join(" OR ")})`;
  return `${base} AND ${cpcClause}`;
}

export interface RefinedConceptForSearch {
  name: string;
  synonyms: string[];
  addedCPCCodes: string[];
}

/** Build a search query from AI-refined concepts (includes their CPC codes) */
export function buildSearchFromRefinedConcepts(
  refinedConcepts: RefinedConceptForSearch[],
  level: 'broad' | 'moderate' | 'narrow'
): string {
  if (refinedConcepts.length === 0) return "";

  // Convert refined concepts to ConceptForSearch format
  const asConceptForSearch: ConceptForSearch[] = refinedConcepts.map((rc) => ({
    name: rc.name,
    synonyms: rc.synonyms,
    enabled: true,
  }));

  const base = buildSearchesFromConcepts(asConceptForSearch)[level];
  if (!base) return "";

  // Collect all unique CPC codes across refined concepts
  const allCPCs = new Set<string>();
  for (const rc of refinedConcepts) {
    for (const code of rc.addedCPCCodes || []) {
      allCPCs.add(code);
    }
  }

  if (allCPCs.size === 0) return base;

  const cpcClause = `cpc:(${Array.from(allCPCs).join(" OR ")})`;
  return `${base} AND ${cpcClause}`;
}

// ── Field Operators ──

export type PatentField = 'TI' | 'AB' | 'CL';

/**
 * Wrap a concept group to search within a specific patent field.
 * - TI= : title only (most restrictive, highest relevance signal)
 * - AB= : abstract only (good balance of precision and recall)
 * - CL= : claims only (finds patents that claim the concept, best for patentability)
 *
 * Note: Google Patents field operators are "not robust" with proximity operators.
 * Use field operators with simple OR groups, not with NEAR/ADJ.
 */
export function wrapWithField(field: PatentField, terms: string[]): string {
  if (terms.length === 0) return "";
  const group = buildGroup(terms);
  return `${field}=(${group})`;
}

/**
 * Build a field-targeted search query for precision refinement.
 * Searches concept terms within claims (CL=) for strongest relevance signal,
 * or within title+abstract (TI= OR AB=) for broader precision.
 *
 * @param concepts Concepts to search
 * @param field Which patent field to target
 * @param maxTermsPerConcept How many synonyms per concept (fewer = more precise)
 */
export function buildFieldTargetedSearch(
  concepts: ConceptForSearch[],
  field: PatentField,
  maxTermsPerConcept: number = 3,
): string {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length === 0) return "";

  const groups = enabled.map(c => {
    const terms = [c.name, ...c.synonyms.slice(0, maxTermsPerConcept)];
    return `${field}=(${buildGroup(terms)})`;
  });

  return groups.join(" AND ");
}

/**
 * Build a title+claims cross-field search for maximum precision.
 * Requires at least one concept term in the title AND at least one in the claims.
 * This is the most restrictive field search — use when results are too broad.
 */
export function buildTitleClaimsSearch(
  concepts: ConceptForSearch[],
  maxTermsPerConcept: number = 2,
): string {
  const enabled = concepts.filter(c => c.enabled);
  if (enabled.length < 2) {
    // With only 1 concept, search it in both fields
    if (enabled.length === 1) {
      const terms = [enabled[0].name, ...enabled[0].synonyms.slice(0, maxTermsPerConcept)];
      return `TI=(${buildGroup(terms)}) AND CL=(${buildGroup(terms)})`;
    }
    return "";
  }

  // Top concept in title, second in claims
  const titleTerms = [enabled[0].name, ...enabled[0].synonyms.slice(0, maxTermsPerConcept)];
  const claimsTerms = [enabled[1].name, ...enabled[1].synonyms.slice(0, maxTermsPerConcept)];

  return `TI=(${buildGroup(titleTerms)}) AND CL=(${buildGroup(claimsTerms)})`;
}
