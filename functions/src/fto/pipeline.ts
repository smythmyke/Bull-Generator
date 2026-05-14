/**
 * FTO pipeline orchestrator.
 *
 * Runs the 6-stage pipeline defined in research/fto-build-plan.md §4-5.
 * Each stage is its own module under functions/src/fto/stageN*.ts.
 *
 * During Phase 0 scaffolding, stages 1-6 are stubs that log and return
 * empty data. They are filled in by tasks 2-7.
 */

import {
  Feature,
  Candidate,
  RiskCell,
  SynthesisOutput,
  FtoRunInput,
  FtoReport,
  FtoCostTracking,
  ProgressCallback,
  Jurisdiction,
} from "./types";
import { runStage1FeatureExtraction } from "./stage1FeatureExtraction";
import { extractProductCpcScope, ProductCpcScope } from "./productCpcExtraction";
import { runStage2Search } from "./stage2Search";

function newCostTracker(): FtoCostTracking {
  return {
    geminiCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    googlePatentsFetches: 0,
    odpFetches: 0,
    estimatedCostUsd: 0,
    stageTimingsMs: {},
  };
}

async function timeStage<T>(
  cost: FtoCostTracking,
  stageKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    cost.stageTimingsMs[stageKey] = Date.now() - t0;
  }
}

export async function runFtoPipeline(
  input: FtoRunInput,
  onProgress: ProgressCallback = () => {}
): Promise<FtoReport> {
  const startedAt = new Date().toISOString();
  const cost = newCostTracker();

  const stage1 = await timeStage(cost, "stage1", () =>
    runStage1FeatureExtraction(input, cost, onProgress)
  );
  const features = stage1.features;

  if (stage1.needsClarification || features.length === 0) {
    return {
      input,
      features,
      candidates: [],
      filteredCandidates: [],
      riskMatrix: [],
      synthesis: null,
      costTracking: cost,
      startedAt,
      completedAt: new Date().toISOString(),
      needsClarification:
        stage1.needsClarification || {
          reason: "No claim-relevant features extracted from product description.",
          followUps: [
            "Add more technical detail about how the product works.",
            "Describe physical components, materials, or unique configurations.",
            "Explain the problem the product solves and its mechanism.",
          ],
        },
    };
  }

  const productCpcs: ProductCpcScope = await timeStage(cost, "stage1.5", () =>
    extractProductCpcScope(input.productDescription, cost, onProgress)
  );

  const candidates = await timeStage(cost, "stage2", () =>
    runStage2Search(features, cost, onProgress, {
      productCpcs: productCpcs.cpcCodes,
    })
  );

  const filteredCandidates = await timeStage(cost, "stage3", () =>
    runStage3StatusFilter(candidates, input.jurisdiction, cost, onProgress)
  );

  const riskMatrix = await timeStage(cost, "stage4", () =>
    runStage4RiskAnalysis(features, filteredCandidates, cost, onProgress)
  );

  const synthesis = await timeStage(cost, "stage5", () =>
    runStage5Synthesis(features, riskMatrix, filteredCandidates, cost, onProgress)
  );

  const verifiedMatrix = await timeStage(cost, "stage6", () =>
    runStage6Verification(riskMatrix, cost, onProgress)
  );

  return {
    input,
    features,
    productCpcs,
    candidates,
    filteredCandidates,
    riskMatrix: verifiedMatrix,
    synthesis,
    costTracking: cost,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

// ── Stage stubs — replaced as each task lands ─────────────────────────────

async function runStage3StatusFilter(
  _candidates: Candidate[],
  _jurisdiction: Jurisdiction,
  _cost: FtoCostTracking,
  onProgress: ProgressCallback
): Promise<Candidate[]> {
  onProgress("stage3", "Stage 3 not implemented yet (Task #4)");
  return [];
}

async function runStage4RiskAnalysis(
  _features: Feature[],
  _filteredCandidates: Candidate[],
  _cost: FtoCostTracking,
  onProgress: ProgressCallback
): Promise<RiskCell[]> {
  onProgress("stage4", "Stage 4 not implemented yet (Task #5)");
  return [];
}

async function runStage5Synthesis(
  _features: Feature[],
  _riskMatrix: RiskCell[],
  _filteredCandidates: Candidate[],
  _cost: FtoCostTracking,
  onProgress: ProgressCallback
): Promise<SynthesisOutput | null> {
  onProgress("stage5", "Stage 5 not implemented yet (Task #6)");
  return null;
}

async function runStage6Verification(
  riskMatrix: RiskCell[],
  _cost: FtoCostTracking,
  onProgress: ProgressCallback
): Promise<RiskCell[]> {
  onProgress("stage6", "Stage 6 not implemented yet (Task #7)");
  return riskMatrix;
}
