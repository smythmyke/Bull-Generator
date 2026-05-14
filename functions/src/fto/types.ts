/**
 * FTO pipeline shared types.
 *
 * Mirrors the schema in research/fto-build-plan.md §8.
 * Used by both the Phase 0 CLI and (eventually) the Phase 1 Cloud Function.
 */

export type Jurisdiction = "US" | "EU";

export type FeatureCategory =
  | "physical"
  | "process"
  | "material"
  | "configuration"
  | "software";

export interface Feature {
  id: string;            // f1, f2, ...
  name: string;
  description: string;
  category: FeatureCategory;
  searchTerms: string[];
  claimRelevant: boolean;
}

export interface Candidate {
  patentNumber: string;
  title?: string;
  assignee?: string;
  foundForFeatures: string[];        // feature ids

  // Populated by Stage 2 (search response payload)
  snippet?: string;
  priorityDate?: string;
  filingDate?: string;
  grantDate?: string;
  publicationDate?: string;
  /** Per-country active flags from Google Patents search response. Stage 3 reuses. */
  searchCountryStatus?: Array<{ country: string; active: boolean }>;
  /** Google's "broader recall" flag; false-flagged hits are looser matches. */
  isSimilarDocument?: boolean;

  // Populated by Stage 3
  legalStatus?: string;
  isActive?: boolean;
  jurisdiction?: Jurisdiction;
  requiresManualReview?: boolean;
  statusNotes?: string;
}

export type RiskScore = "high" | "medium" | "low" | "none";

export interface RiskCell {
  patentNumber: string;
  featureId: string;
  score: RiskScore;
  citedElements: string[];
  rationale: string;
  // Populated by Stage 6
  verified?: boolean;
  verifiedQuote?: string;
  verificationFailed?: boolean;
  unverified?: boolean;              // verification cap exceeded
}

export interface TopRisk {
  patentNumber: string;
  summary: string;
}

export interface SynthesisOutput {
  executiveSummary: string;
  topRisks: TopRisk[];
  featureCommentary: Record<string, string>;  // featureId → commentary
  recommendations: string[];
}

export interface FtoRunInput {
  productDescription: string;
  jurisdiction: Jurisdiction;
  knownCompetitors?: string[];
  excludePatents?: string[];
}

export interface FtoCostTracking {
  geminiCalls: number;
  inputTokens: number;
  outputTokens: number;
  googlePatentsFetches: number;
  odpFetches: number;
  estimatedCostUsd: number;
  stageTimingsMs: Record<string, number>;
}

export interface FtoReport {
  input: FtoRunInput;
  features: Feature[];
  productCpcs?: { cpcCodes: string[]; reasoning: string };
  candidates: Candidate[];
  filteredCandidates: Candidate[];
  riskMatrix: RiskCell[];
  synthesis: SynthesisOutput | null;
  costTracking: FtoCostTracking;
  startedAt: string;
  completedAt: string;
  needsClarification?: { reason: string; followUps: string[] };
}

export type ProgressCallback = (
  stage: string,
  message: string,
  completed?: number,
  total?: number
) => void;
