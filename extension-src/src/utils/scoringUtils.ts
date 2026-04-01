import { PorterStemmer } from './porterStemmer';

// ── Types ──

export interface ScoreBreakdown {
  termFrequency: number;
  titleHits: number;
  proximity: number;
  coverage: number;
  conceptCoverage: number;
  claimPresence: number;
  aiSemantic: number;
  multiSource: number;
  cpcRelevance: number;
  final: number;
}

export interface QueryTerms {
  raw: string[];
  stemmed: string[];
}

// ── Stop words to exclude from scoring ──

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'not', 'of', 'in', 'to', 'for', 'with',
  'on', 'at', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'that', 'which', 'this',
  'these', 'those', 'it', 'its', 'as', 'but', 'if', 'than', 'then',
  'so', 'no', 'nor', 'each', 'every', 'all', 'any', 'both', 'such',
  'into', 'through', 'about', 'between', 'after', 'before', 'during',
  'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', 'once', 'here', 'there', 'when', 'where', 'how',
  'what', 'who', 'whom', 'why', 'also', 'more', 'most', 'other',
  'some', 'only', 'same', 'just', 'because', 'being', 'having',
]);

// ── Helpers ──

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

function stemTokens(tokens: string[]): string[] {
  return tokens.map(t => PorterStemmer.stem(t));
}

// ── Public Scoring Functions ──

/**
 * Parse user query into raw words + stemmed versions, stripping boolean operators.
 */
export function extractQueryTerms(query: string): QueryTerms {
  // Strip boolean operators and field prefixes
  let cleaned = query
    .replace(/\b(AND|OR|NOT|NEAR\/\d+|ADJ\/\d+|WITH|SAME)\b/gi, ' ')
    .replace(/\b(?:FT|TAC|AB|TI|CL|CA|CPC)\s*=/gi, ' ')
    .replace(/[()"""]/g, ' ');

  const words = tokenize(cleaned).filter(w => !STOP_WORDS.has(w) && w.length >= 3);
  // Deduplicate
  const rawUnique = [...new Set(words)];
  const stemmedUnique = [...new Set(stemTokens(rawUnique))];

  return { raw: rawUnique, stemmed: stemmedUnique };
}

/**
 * Term frequency: count stemmed query term hits in text, normalize to 0-100.
 */
export function scoreTF(terms: QueryTerms, text: string): number {
  if (!text || terms.stemmed.length === 0) return 0;

  const textTokens = stemTokens(tokenize(text));
  if (textTokens.length === 0) return 0;

  let hits = 0;
  for (const token of textTokens) {
    if (terms.stemmed.includes(token)) hits++;
  }

  // Normalize: ratio of hits to text length, capped at reasonable density
  const density = hits / textTokens.length;
  // A density of 0.15+ is very high for patent text
  return Math.min(100, Math.round(density * 100 / 0.15));
}

/**
 * Percentage of query terms found in the title, 0-100.
 */
export function scoreTitleHits(terms: QueryTerms, title: string): number {
  if (!title || terms.stemmed.length === 0) return 0;

  const titleStems = new Set(stemTokens(tokenize(title)));
  let hits = 0;
  for (const stem of terms.stemmed) {
    if (titleStems.has(stem)) hits++;
  }

  return Math.round((hits / terms.stemmed.length) * 100);
}

/**
 * Phrase-distance scoring: for each adjacent query term pair,
 * find minimum word distance in text, average across pairs.
 */
export function scoreProximity(terms: QueryTerms, text: string): number {
  if (!text || terms.stemmed.length < 2) return 50; // neutral for single-term queries

  const textStems = stemTokens(tokenize(text));
  if (textStems.length === 0) return 0;

  // Build position index
  const positions: Map<string, number[]> = new Map();
  textStems.forEach((stem, idx) => {
    if (!positions.has(stem)) positions.set(stem, []);
    positions.get(stem)!.push(idx);
  });

  let totalMinDist = 0;
  let pairs = 0;

  for (let i = 0; i < terms.stemmed.length - 1; i++) {
    const posA = positions.get(terms.stemmed[i]);
    const posB = positions.get(terms.stemmed[i + 1]);
    if (!posA || !posB) continue;

    // Find minimum distance between any occurrence of term i and term i+1
    let minDist = Infinity;
    for (const a of posA) {
      for (const b of posB) {
        const d = Math.abs(a - b);
        if (d < minDist) minDist = d;
      }
    }

    if (minDist < Infinity) {
      totalMinDist += minDist;
      pairs++;
    }
  }

  if (pairs === 0) return 0;

  const avgDist = totalMinDist / pairs;
  // Distance of 1 = adjacent = 100, distance of 20+ = 0
  return Math.max(0, Math.round(100 * (1 - avgDist / 20)));
}

/**
 * Percentage of unique query stems present at least once in text, 0-100.
 */
export function scoreCoverage(terms: QueryTerms, text: string): number {
  if (!text || terms.stemmed.length === 0) return 0;

  const textStemSet = new Set(stemTokens(tokenize(text)));
  let found = 0;
  for (const stem of terms.stemmed) {
    if (textStemSet.has(stem)) found++;
  }

  return Math.round((found / terms.stemmed.length) * 100);
}

/**
 * Ratio of claim hits vs total hits across abstract + claims, 0-100.
 * Higher score = more query terms found in claims (stronger patent relevance).
 * Uses multiple independent claims if available from BigQuery enrichment.
 */
export function scoreClaimPresence(
  terms: QueryTerms,
  abstract: string,
  firstClaim: string,
  independentClaims?: { claimNumber: number; text: string }[]
): number {
  // Build claim text: prefer independent claims concatenated, fall back to firstClaim
  const claimText = independentClaims && independentClaims.length > 0
    ? independentClaims.map(c => c.text).join(' ')
    : firstClaim;

  if (!claimText || terms.stemmed.length === 0) return 50; // neutral if no claim data

  const abstractStems = stemTokens(tokenize(abstract || ''));
  const claimStems = stemTokens(tokenize(claimText));

  let abstractHits = 0;
  let claimHits = 0;

  for (const token of abstractStems) {
    if (terms.stemmed.includes(token)) abstractHits++;
  }
  for (const token of claimStems) {
    if (terms.stemmed.includes(token)) claimHits++;
  }

  const totalHits = abstractHits + claimHits;
  if (totalHits === 0) return 0;

  // Ratio of claim hits to total hits
  return Math.round((claimHits / totalHits) * 100);
}

/**
 * Graduated multi-source score based on ratio of queries the patent appeared in.
 * More appearances across independent queries = stronger relevance signal.
 */
export function scoreMultiSource(foundBy: string[], totalQueries?: number): number {
  if (!foundBy || foundBy.length <= 1) return 0;

  const sourceTypes = new Set<string>();
  for (const src of foundBy) {
    const match = src.match(/^(round\d+|similar|raw-text|boolean|ai-optimized)/);
    sourceTypes.add(match ? match[1] : src);
  }

  const independentSources = sourceTypes.size;
  if (independentSources <= 1) {
    return Math.min(25, foundBy.length * 8);
  }

  if (totalQueries && totalQueries > 1) {
    return Math.min(100, Math.round((independentSources / Math.min(totalQueries, 5)) * 100));
  }

  if (independentSources === 2) return 50;
  if (independentSources === 3) return 75;
  return 100;
}

/**
 * Concept coverage: what percentage of the user's original concepts
 * have at least one stem match in the patent text (abstract + claim 1).
 * Rewards breadth — a patent covering 5/5 concepts is stronger prior art.
 */
export function scoreConceptCoverage(
  concepts: { name: string; synonyms: string[] }[],
  text: string
): number {
  if (!concepts || concepts.length === 0 || !text) return 0;

  const textStemSet = new Set(stemTokens(tokenize(text)));
  let matched = 0;

  for (const concept of concepts) {
    // Concept is "covered" if name or any synonym has a stem match
    const allTerms = [concept.name, ...(concept.synonyms || [])];
    const conceptStems = allTerms.flatMap(t => stemTokens(tokenize(t)));
    const hit = conceptStems.some(stem => textStemSet.has(stem));
    if (hit) matched++;
  }

  return Math.round((matched / concepts.length) * 100);
}

/**
 * CPC relevance: scored by backward citation count from BigQuery enrichment.
 * More backward citations = better-connected prior art = more relevant.
 */
export function scoreCPCRelevance(_cpcCodes: string[], backwardCitationCount?: number): number {
  if (backwardCitationCount === undefined) return 50; // neutral, no data
  if (backwardCitationCount >= 50) return 100;
  if (backwardCitationCount >= 30) return 85;
  if (backwardCitationCount >= 15) return 70;
  if (backwardCitationCount >= 5) return 55;
  return 30;
}

// ── Weights ──

const WEIGHTS = {
  termFrequency: 0.08,
  titleHits: 0.12,
  proximity: 0.05,
  coverage: 0.08,
  conceptCoverage: 0.22,
  claimPresence: 0.10,
  aiSemantic: 0.20,
  multiSource: 0.10,
  cpcRelevance: 0.05,
};

/**
 * Compute hybrid score combining deterministic signals with AI semantic score.
 */
export function computeHybridScore(params: {
  terms: QueryTerms;
  title: string;
  abstract: string;
  firstClaim: string;
  foundBy: string[];
  cpcCodes: string[];
  aiSemanticScore: number;
  backwardCitationCount?: number;
  independentClaims?: { claimNumber: number; text: string }[];
  concepts?: { name: string; synonyms: string[] }[];
  totalQueries?: number;
}): ScoreBreakdown {
  const { terms, title, abstract, firstClaim, foundBy, cpcCodes, aiSemanticScore, backwardCitationCount, independentClaims, concepts, totalQueries } = params;

  const fullText = [abstract, firstClaim].filter(Boolean).join(' ');

  const tf = scoreTF(terms, fullText);
  const th = scoreTitleHits(terms, title);
  const prox = scoreProximity(terms, fullText);
  const cov = scoreCoverage(terms, fullText);
  const cc = concepts ? scoreConceptCoverage(concepts, fullText) : 0;
  const claim = scoreClaimPresence(terms, abstract, firstClaim, independentClaims);
  const ms = scoreMultiSource(foundBy, totalQueries);
  const cpc = scoreCPCRelevance(cpcCodes, backwardCitationCount);

  const final = Math.round(
    tf * WEIGHTS.termFrequency +
    th * WEIGHTS.titleHits +
    prox * WEIGHTS.proximity +
    cov * WEIGHTS.coverage +
    cc * WEIGHTS.conceptCoverage +
    claim * WEIGHTS.claimPresence +
    aiSemanticScore * WEIGHTS.aiSemantic +
    ms * WEIGHTS.multiSource +
    cpc * WEIGHTS.cpcRelevance
  );

  return {
    termFrequency: tf,
    titleHits: th,
    proximity: prox,
    coverage: cov,
    conceptCoverage: cc,
    claimPresence: claim,
    aiSemantic: aiSemanticScore,
    multiSource: ms,
    cpcRelevance: cpc,
    final: Math.max(0, Math.min(100, final)),
  };
}
