export interface ConceptForSearch {
  name: string;
  synonyms: string[];
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

/** Build a search query that appends CPC code filters */
export function buildSearchWithCPCCodes(
  concepts: ConceptForSearch[],
  cpcCodes: string[],
  level: 'broad' | 'moderate' | 'narrow'
): string {
  const base = buildSearchesFromConcepts(concepts)[level];
  if (!base) return "";
  if (cpcCodes.length === 0) return base;

  const cpcGroup = `(${cpcCodes.map((c) => `cpc=${c}`).join(" OR ")})`;
  return `${base} AND ${cpcGroup}`;
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

  const cpcGroup = `(${Array.from(allCPCs).map((c) => `cpc=${c}`).join(" OR ")})`;
  return `${base} AND ${cpcGroup}`;
}
