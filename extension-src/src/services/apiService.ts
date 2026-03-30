import { auth } from "../firebaseConfig";

const AI_BASE_URL = "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai";

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("User must be logged in");
  }
  return user.getIdToken(true);
}

async function callAI<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(`${AI_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message = errorData?.error || `Request failed: ${response.status}`;
    const err = new Error(message);
    (err as any).status = response.status;
    throw err;
  }

  const result = await response.json();
  return result.data as T;
}

// Types
export interface SearchTerm {
  term: string;
  synonyms: string[];
}

export interface SearchResponse {
  broad: string;
  moderate: string;
  narrow: string;
  terms: SearchTerm[];
}

export interface SynonymResponse {
  word: string;
  synonyms: string[];
}

export interface DefinitionResponse {
  word: string;
  definition: string;
}

export interface AnalyzeResponse {
  search: string;
  concepts: string[];
  terms: string[];
}

// Concept extraction types
export type ConceptCategory = "device" | "process" | "material" | "property" | "context";
export type ConceptImportance = "high" | "medium" | "low";

export interface ExtractedConcept {
  name: string;
  category: ConceptCategory;
  synonyms: string[];        // legacy flat list (backward compat)
  modifiers?: string[];      // specific qualifiers (e.g., "foldable", "bendable")
  nouns?: string[];           // generic objects (e.g., "device", "screen")
  importance: ConceptImportance;
}

export interface ExtractConceptsResponse {
  concepts: ExtractedConcept[];
}

// API functions
export async function generateSearchStrings(
  words: string[],
  searchSystem: string = "orbit"
): Promise<SearchResponse> {
  return callAI<SearchResponse>("/generate", { words, searchSystem });
}

export async function getSynonyms(word: string): Promise<SynonymResponse> {
  return callAI<SynonymResponse>("/synonyms", { word });
}

export async function getDefinition(word: string): Promise<DefinitionResponse> {
  return callAI<DefinitionResponse>("/definitions", { word });
}

export async function extractConcepts(paragraph: string): Promise<ExtractConceptsResponse> {
  return callAI<ExtractConceptsResponse>("/extract-concepts", { paragraph });
}

export async function analyzeParagraph(
  paragraph: string,
  searchSystem: string = "orbit"
): Promise<AnalyzeResponse> {
  return callAI<AnalyzeResponse>("/analyze", { paragraph, searchSystem });
}

// Query optimization
export interface OptimizeQueryResponse {
  optimizedQuery: string;
  reasoning: string;
}

export async function optimizeQuery(text: string): Promise<OptimizeQueryResponse> {
  return callAI<OptimizeQueryResponse>("/optimize-query", { text });
}

// Patent ranking types
export interface PatentForRanking {
  patentId: string;
  patentNumber: string;
  title: string;
  assignee: string;
  abstract: string;
  fullAbstract: string;
  cpcCodes: string[];
  firstClaim: string;
  foundBy?: string[];
  // BigQuery enrichment fields (optional)
  independentClaims?: { claimNumber: number; text: string }[];
  backwardCitationCount?: number;
}

export interface Snippet {
  source: string;
  quote: string;
  relevance: string;
}

export interface RankedPatent {
  patentId: string;
  rank: number;
  score: number;
  semanticScore?: number;
  reasoning: string;
  snippets: Snippet[];
}

export interface RankResponse {
  ranked: RankedPatent[];
}

export async function rankPatents(
  query: string,
  patents: PatentForRanking[]
): Promise<RankResponse> {
  return callAI<RankResponse>("/rank", { query, patents });
}

// NPL enrichment types
export interface NPLItem {
  patentId: string;
  title: string;
  doi?: string;
}

export interface EnrichedNPLItem {
  patentId: string;
  fullAbstract: string;
  citationCount: number;
  venue: string;
  doi: string;
  fieldsOfStudy: string[];
  enrichedVia: string;
}

export interface EnrichNPLResponse {
  enriched: EnrichedNPLItem[];
}

export async function enrichNPL(items: NPLItem[]): Promise<EnrichNPLResponse> {
  return callAI<EnrichNPLResponse>("/enrich-npl", { items });
}

// Strategy search types
export type SearchStrategy = 'telescoping' | 'onion-ring' | 'faceted';
export type SearchDepth = 'quick' | 'pro-auto' | 'pro-interactive';

export interface StrategySearchQuery {
  label: string;
  query: string;
}

export interface GenerateStrategySearchesRequest {
  concepts: GenerateFromConceptsRequest[];
  strategy: SearchStrategy;
  maxGroups?: number;
}

export interface GenerateStrategySearchesResponse {
  queries: StrategySearchQuery[];
}

export async function generateStrategySearches(
  request: GenerateStrategySearchesRequest
): Promise<GenerateStrategySearchesResponse> {
  return callAI<GenerateStrategySearchesResponse>("/generate-strategy-searches", request as unknown as Record<string, unknown>);
}

// Pro Search types
export type ProSearchMode = 'quick' | 'pro-auto' | 'pro-interactive';

export interface CPCSuggestion {
  code: string;
  label: string;
  frequency: number;
}

export interface TerminologySwap {
  userTerm: string;
  patentTerms: string[];
  frequency: number;
}

export interface ConceptHealth {
  conceptName: string;
  matchCount: number;
  status: 'strong' | 'weak' | 'missing';
}

export interface RefinedConcept {
  name: string;
  synonyms: string[];
  addedCPCCodes: string[];
}

export interface AnalyzeRoundRequest {
  originalConcepts: { name: string; synonyms: string[] }[];
  roundResults: { patentId: string; title: string; abstract?: string; fullAbstract?: string; cpcCodes?: string[] }[];
  roundNumber: number;
  originalParagraph: string;
}

export interface AnalyzeRoundResponse {
  cpcSuggestions: CPCSuggestion[];
  terminologySwaps: TerminologySwap[];
  conceptHealth: ConceptHealth[];
  refinedConcepts: RefinedConcept[];
  topPatentIds: string[];
}

// Generate smart searches from concepts
export interface GenerateFromConceptsRequest {
  name: string;
  synonyms: string[];
  category: string;
  importance: string;
  enabled: boolean;
}

export interface GenerateFromConceptsResponse {
  broad: string;
  moderate: string;
  narrow: string;
}

export async function generateFromConcepts(
  concepts: GenerateFromConceptsRequest[]
): Promise<GenerateFromConceptsResponse> {
  return callAI<GenerateFromConceptsResponse>("/generate-from-concepts", { concepts } as unknown as Record<string, unknown>);
}

export async function analyzeRound(request: AnalyzeRoundRequest): Promise<AnalyzeRoundResponse> {
  return callAI<AnalyzeRoundResponse>("/analyze-round", request as unknown as Record<string, unknown>);
}

// Prior Art Analysis (102/103) types
export interface ConceptCoverageItem {
  conceptName: string;
  coverage: 'full' | 'partial' | 'none';
  evidence: string;
}

export interface PatentConceptCoverage {
  patentId: string;
  conceptsCovered: ConceptCoverageItem[];
}

export interface Section102Candidate {
  patentId: string;
  coveragePercent: number;
  reasoning: string;
}

export interface Section103Combination {
  primary: { patentId: string; conceptsContributed: string[]; reasoning: string };
  secondary: { patentId: string; conceptsContributed: string[]; reasoning: string }[];
  combinedCoverage: number;
  combinationReasoning: string;
  fieldOverlap: string;
}

export interface PriorArtAnalysisResponse {
  conceptCoverage: PatentConceptCoverage[];
  section102: Section102Candidate[];
  section103: Section103Combination[];
}

export interface PriorArtAnalysisRequest {
  query: string;
  concepts: { name: string; synonyms: string[] }[];
  patents: {
    patentId: string;
    title: string;
    abstract?: string;
    fullAbstract?: string;
    cpcCodes?: string[];
    firstClaim?: string;
    independentClaims?: { claimNumber: number; text: string }[];
    backwardCitationCount?: number;
    familyId?: string;
  }[];
}

export async function analyzePriorArt(
  request: PriorArtAnalysisRequest
): Promise<PriorArtAnalysisResponse> {
  return callAI<PriorArtAnalysisResponse>("/analyze-prior-art", request as unknown as Record<string, unknown>);
}

// Full Report Sections types
export interface ReportFeature {
  id: string;
  name: string;
  importance: 'high' | 'medium' | 'low';
  description: string;
}

export interface ClaimChartElement {
  featureId: string;
  featureName: string;
  priorArtDisclosure: string;
  sourceRef: string;
  coverage: 'full' | 'partial' | 'none';
  coverageExplanation: string;
}

export interface ClaimChart {
  patentId: string;
  epoCategory: 'X' | 'Y';
  narrativeIntro: string;
  elements: ClaimChartElement[];
}

export interface ReportConclusion {
  noveltyAssessment: string;
  obviousnessAssessment: string;
  overallRisk: 'low' | 'moderate' | 'high';
  recommendations: string[];
}

export interface GenerateReportSectionsRequest {
  query: string;
  concepts: { name: string; category?: string; synonyms: string[]; importance?: string }[];
  topPatents: {
    patentId: string;
    title: string;
    abstract?: string;
    claims?: string;
    cpcCodes?: string[];
    assignee?: string;
  }[];
  priorArtSummary: {
    section102Count: number;
    section103Count: number;
    maxCombinedCoverage: number;
    coverageGaps: string[];
  };
  epoCategories: { patentId: string; category: 'X' | 'Y' | 'A' }[];
}

export interface GenerateReportSectionsResponse {
  inventionSummary: {
    narrative: string;
    features: ReportFeature[];
  };
  claimCharts: ClaimChart[];
  conclusion: ReportConclusion;
}

export async function generateReportSections(
  request: GenerateReportSectionsRequest
): Promise<GenerateReportSectionsResponse> {
  return callAI<GenerateReportSectionsResponse>("/generate-report-sections", request as unknown as Record<string, unknown>);
}

// BigQuery enrichment removed — disabled due to cost
