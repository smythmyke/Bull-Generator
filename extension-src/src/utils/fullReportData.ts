import {
  GenerateReportSectionsRequest,
  GenerateReportSectionsResponse,
  ReportFeature,
  ClaimChart,
  ReportConclusion,
  PatentConceptCoverage,
  Section102Candidate,
  Section103Combination,
} from '../services/apiService';

// ── Types ──

export interface EPOCategory {
  patentId: string;
  category: 'X' | 'Y' | 'A';
}

export interface FullReportPatent {
  patentId: string;
  title: string;
  assignee: string;
  abstract: string;
  cpcCodes: string[];
  firstClaim: string;
  epoCategory: 'X' | 'Y' | 'A';
  rank?: number;
  score?: number;
}

export interface SearchMethodology {
  mode: string;
  strategy?: string;
  depth?: string;
  totalQueries: number;
  uniqueResults: number;
  totalDurationMs?: number;
  searchLog: {
    round: number;
    label: string;
    query: string;
    resultCount: number;
    durationMs?: number;
  }[];
}

export interface FullReportData {
  // Header
  query: string;
  date: string;

  // Section 1: Invention Summary (AI-generated)
  inventionSummary: {
    narrative: string;
    features: ReportFeature[];
  };

  // Section 2: Search Methodology (from searchMeta)
  methodology: SearchMethodology;

  // Section 3: Prior Art References (derived from ranked patents + EPO categories)
  references: FullReportPatent[];

  // Section 4: Concept Coverage Matrix (from prior art analysis)
  concepts: { name: string; synonyms: string[]; importance?: string; category?: string }[];
  conceptCoverage: PatentConceptCoverage[];

  // Section 5: Claim Charts (AI-generated)
  claimCharts: ClaimChart[];

  // Section 6: Section 102 Analysis (from prior art analysis)
  section102: Section102Candidate[];

  // Section 7: Section 103 Analysis (from prior art analysis)
  section103: Section103Combination[];

  // Section 8: Conclusion & Recommendations (AI-generated)
  conclusion: ReportConclusion;

  // Lookup
  patentTitles: Record<string, string>;
}

// ── EPO Category Derivation ──

export function deriveEPOCategories(
  section102: Section102Candidate[],
  section103: Section103Combination[],
  allPatentIds: string[]
): EPOCategory[] {
  const categoryMap = new Map<string, 'X' | 'Y' | 'A'>();

  // X = patents in section102 candidates
  for (const candidate of section102) {
    categoryMap.set(candidate.patentId, 'X');
  }

  // Y = patents in section103 combinations (primary or secondary)
  for (const combo of section103) {
    if (!categoryMap.has(combo.primary.patentId)) {
      categoryMap.set(combo.primary.patentId, 'Y');
    }
    for (const sec of combo.secondary) {
      if (!categoryMap.has(sec.patentId)) {
        categoryMap.set(sec.patentId, 'Y');
      }
    }
  }

  // A = remaining patents
  for (const id of allPatentIds) {
    if (!categoryMap.has(id)) {
      categoryMap.set(id, 'A');
    }
  }

  return Array.from(categoryMap.entries()).map(([patentId, category]) => ({
    patentId,
    category,
  }));
}

// ── Prior Art Summary Builder ──

export function buildPriorArtSummary(
  section102: Section102Candidate[],
  section103: Section103Combination[],
  concepts: { name: string }[],
  conceptCoverage: PatentConceptCoverage[]
): GenerateReportSectionsRequest['priorArtSummary'] {
  const maxCombinedCoverage = section103.length > 0
    ? Math.max(...section103.map(c => c.combinedCoverage))
    : 0;

  // Find concepts with weak/no coverage across all patents
  const coverageGaps: string[] = [];
  for (const concept of concepts) {
    const coverages = conceptCoverage.map(pc => {
      const item = pc.conceptsCovered.find(c => c.conceptName === concept.name);
      return item?.coverage || 'none';
    });
    const hasFull = coverages.some(c => c === 'full');
    if (!hasFull) {
      coverageGaps.push(concept.name);
    }
  }

  return {
    section102Count: section102.length,
    section103Count: section103.length,
    maxCombinedCoverage,
    coverageGaps,
  };
}

// ── Full Report Data Assembly ──

export function buildFullReportData(
  query: string,
  searchMeta: any,
  concepts: { name: string; synonyms: string[]; importance?: string; category?: string }[],
  rankedPatents: {
    patentId: string;
    title: string;
    assignee: string;
    abstract: string;
    cpcCodes: string[];
    firstClaim: string;
    rank?: number;
    score?: number;
  }[],
  priorArtResult: {
    conceptCoverage: PatentConceptCoverage[];
    section102: Section102Candidate[];
    section103: Section103Combination[];
  },
  aiSections: GenerateReportSectionsResponse
): FullReportData {
  const epoCategories = deriveEPOCategories(
    priorArtResult.section102,
    priorArtResult.section103,
    rankedPatents.map(p => p.patentId)
  );

  const epoCatMap = new Map(epoCategories.map(e => [e.patentId, e.category]));

  const references: FullReportPatent[] = rankedPatents.map(p => ({
    ...p,
    epoCategory: epoCatMap.get(p.patentId) || 'A',
  }));

  // Sort: X first, then Y, then A
  const categoryOrder = { X: 0, Y: 1, A: 2 };
  references.sort((a, b) => categoryOrder[a.epoCategory] - categoryOrder[b.epoCategory]);

  const patentTitles: Record<string, string> = {};
  for (const p of rankedPatents) {
    patentTitles[p.patentId] = p.title;
  }

  const searchLog = searchMeta?.searchLog || [];
  const totalQueries = searchLog.length;
  const uniqueResults = searchMeta?.uniqueCount || rankedPatents.length;

  return {
    query,
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    inventionSummary: aiSections.inventionSummary,
    methodology: {
      mode: searchMeta?.mode || 'unknown',
      strategy: searchMeta?.strategy,
      depth: searchMeta?.depth,
      totalQueries,
      uniqueResults,
      totalDurationMs: searchMeta?.totalDurationMs,
      searchLog,
    },
    references,
    concepts,
    conceptCoverage: priorArtResult.conceptCoverage,
    claimCharts: aiSections.claimCharts,
    section102: priorArtResult.section102,
    section103: priorArtResult.section103,
    conclusion: aiSections.conclusion,
    patentTitles,
  };
}
