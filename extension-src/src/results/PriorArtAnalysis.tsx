import React, { useState } from 'react';
import {
  analyzePriorArt,
  extractConcepts,
  PriorArtAnalysisResponse,
  PatentConceptCoverage,
  Section102Candidate,
  Section103Combination,
} from '../services/apiService';
import { useCreditGate } from '../hooks/useCreditGate';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';
import { exportExaminerReportPDF, exportExaminerReportDOCX, ExaminerReportData } from '../utils/exportReport';

interface PatentForAnalysis {
  patentId: string;
  patentNumber: string;
  title: string;
  abstract: string;
  fullAbstract: string;
  cpcCodes: string[];
  firstClaim: string;
  // BigQuery enrichment fields
  independentClaims?: { claimNumber: number; text: string }[];
  backwardCitationCount?: number;
  familyId?: string;
}

// Cached report state — lifted to parent so it survives tab switches
export interface PriorArtReportState {
  status: AnalysisStatus;
  error: string;
  result: PriorArtAnalysisResponse | null;
  usedConcepts: { name: string; synonyms: string[] }[];
}

export const INITIAL_REPORT_STATE: PriorArtReportState = {
  status: 'idle',
  error: '',
  result: null,
  usedConcepts: [],
};

export interface RichConcept {
  name: string;
  synonyms: string[];
  importance?: string;
  category?: string;
}

interface PriorArtAnalysisProps {
  query: string;
  concepts: RichConcept[] | undefined;
  patents: PatentForAnalysis[];
  reportState: PriorArtReportState;
  onReportStateChange: (state: PriorArtReportState) => void;
}

type AnalysisStatus = 'idle' | 'extracting-concepts' | 'analyzing' | 'done' | 'error';

const CoverageIcon: React.FC<{ coverage: 'full' | 'partial' | 'none' }> = ({ coverage }) => {
  if (coverage === 'full') return <span className="text-green-600 font-bold" title="Full coverage">&#10003;</span>;
  if (coverage === 'partial') return <span className="text-yellow-600 font-bold" title="Partial coverage">~</span>;
  return <span className="text-red-400 font-bold" title="No coverage">&#10007;</span>;
};

const CoverageBgClass: Record<string, string> = {
  full: 'bg-green-50',
  partial: 'bg-yellow-50',
  none: 'bg-red-50/50',
};

function getShortPatentId(patentId: string): string {
  if (patentId.length > 16) return patentId.substring(0, 14) + '...';
  return patentId;
}

const PriorArtAnalysis: React.FC<PriorArtAnalysisProps> = ({ query, concepts: propConcepts, patents, reportState, onReportStateChange }) => {
  const { status, error, result, usedConcepts } = reportState;
  const [hoveredCell, setHoveredCell] = useState<{ patentId: string; concept: string } | null>(null);
  const { checkingAction, showPurchasePrompt, canSearch, withCreditCheck, dismissPurchasePrompt } = useCreditGate();

  // Helper to update lifted state
  const updateState = (partial: Partial<PriorArtReportState>) => {
    onReportStateChange({ ...reportState, ...partial });
  };

  const runAnalysis = async () => {
    await withCreditCheck('examiner-report', 1, async () => {
      await doRunAnalysis();
    });
  };

  const doRunAnalysis = async () => {
    updateState({ error: '', result: null });

    let concepts = propConcepts;

    // Fallback: extract concepts if none stored (backward compatibility)
    if (!concepts || concepts.length === 0) {
      updateState({ status: 'extracting-concepts' });
      try {
        const extracted = await extractConcepts(query);
        concepts = (extracted.concepts || []).map(c => ({
          name: c.name,
          synonyms: c.synonyms,
        }));
      } catch (err) {
        updateState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to extract concepts' });
        return;
      }
    }

    if (!concepts || concepts.length === 0) {
      updateState({ status: 'error', error: 'No concepts available for analysis.' });
      return;
    }

    updateState({ usedConcepts: concepts, status: 'analyzing' });

    try {
      const top12 = patents.slice(0, 12).map(p => ({
        patentId: p.patentId,
        title: p.title,
        abstract: p.abstract,
        fullAbstract: p.fullAbstract,
        cpcCodes: p.cpcCodes,
        firstClaim: p.firstClaim,
        ...(p.independentClaims && p.independentClaims.length > 0 ? {
          independentClaims: p.independentClaims.slice(0, 2).map(c => ({
            claimNumber: c.claimNumber,
            text: c.text.substring(0, 500),
          })),
        } : {}),
        ...(p.backwardCitationCount !== undefined ? { backwardCitationCount: p.backwardCitationCount } : {}),
        ...(p.familyId ? { familyId: p.familyId } : {}),
      }));

      const response = await analyzePriorArt({
        query,
        concepts,
        patents: top12,
      });

      updateState({ result: response, status: 'done' });
    } catch (err) {
      updateState({ status: 'error', error: err instanceof Error ? err.message : 'Prior art analysis failed' });
    }
  };

  // Find evidence tooltip for a cell
  const getEvidence = (patentId: string, conceptName: string): string | null => {
    if (!result) return null;
    const patentCov = result.conceptCoverage.find(c => c.patentId === patentId);
    if (!patentCov) return null;
    const conceptCov = patentCov.conceptsCovered.find(c => c.conceptName === conceptName);
    return conceptCov?.evidence || null;
  };

  // Find patent title by ID
  const getPatentTitle = (patentId: string): string => {
    const p = patents.find(pat => pat.patentId === patentId);
    return p?.title || patentId;
  };

  if (status === 'idle') {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center">
        <div className="max-w-lg mx-auto space-y-4">
          <h2 className="text-lg font-semibold">Examiner's Report</h2>
          <p className="text-sm text-muted-foreground">
            Analyze the top patents through the lens of patentability. Evaluates concept coverage
            (which patents teach which elements), Section 102 anticipation (any single reference
            covering all elements), and Section 103 obviousness (combinations of references).
          </p>
          {showPurchasePrompt ? (
            <InsufficientCreditsModal onDismiss={dismissPurchasePrompt} />
          ) : (
            <button
              onClick={runAnalysis}
              disabled={!canSearch || checkingAction !== null}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {checkingAction === 'examiner-report' ? 'Checking credits...' : 'Run Prior Art Analysis (1 credit)'}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Analyzes the top 12 ranked patents against {propConcepts?.length || 'extracted'} concepts.
            Uses 1 credit.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'extracting-concepts' || status === 'analyzing') {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center">
        <div className="space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
          <p className="text-sm font-medium">
            {status === 'extracting-concepts'
              ? 'Extracting concepts from your query...'
              : 'Analyzing prior art for 102/103 patentability...'}
          </p>
          <p className="text-xs text-muted-foreground">
            {status === 'analyzing' && 'Evaluating concept coverage across top 12 patents...'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center">
        <div className="space-y-4 max-w-md mx-auto">
          <div className="text-3xl">&#9888;</div>
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={runAnalysis}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
          >
            Retry Analysis
          </button>
        </div>
      </div>
    );
  }

  const buildExaminerReportData = (): ExaminerReportData | null => {
    if (!result) return null;
    const patentTitles: Record<string, string> = {};
    for (const p of patents) {
      patentTitles[p.patentId] = p.title;
    }
    return {
      query,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      concepts: usedConcepts,
      conceptCoverage: result.conceptCoverage,
      section102: result.section102.map(c => ({
        ...c,
        title: patentTitles[c.patentId],
      })),
      section103: result.section103,
      patentTitles,
    };
  };

  if (!result) return null;

  const conceptNames = usedConcepts.map(c => c.name);
  const has102 = result.section102.length > 0;

  // Sort coverage rows by correlation count (full=2, partial=1, none=0) — most correlated first
  const sortedCoverage = [...result.conceptCoverage].sort((a, b) => {
    const scoreOf = (cov: PatentConceptCoverage) =>
      cov.conceptsCovered.reduce((sum, c) => sum + (c.coverage === 'full' ? 2 : c.coverage === 'partial' ? 1 : 0), 0);
    return scoreOf(b) - scoreOf(a);
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      {/* Export buttons */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => {
            const data = buildExaminerReportData();
            if (data) exportExaminerReportPDF(data);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
          Export PDF
        </button>
        <button
          onClick={async () => {
            const data = buildExaminerReportData();
            if (data) await exportExaminerReportDOCX(data);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Export DOCX
        </button>
      </div>

      {/* Concept Coverage Matrix */}
      <section className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50">
          <h2 className="text-sm font-semibold">Concept Coverage Matrix</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            How well each prior art reference discloses your invention's concepts
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50/50">
                <th className="text-left px-3 py-2 font-semibold min-w-[140px]">Patent</th>
                {conceptNames.map(name => (
                  <th key={name} className="text-center px-2 py-2 font-semibold min-w-[80px]">
                    <span className="block truncate max-w-[100px]" title={name}>{name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedCoverage.map((patentCov: PatentConceptCoverage) => (
                <tr key={patentCov.patentId} className="border-b hover:bg-slate-50/30">
                  <td className="px-3 py-2">
                    <span className="font-mono font-medium" title={getPatentTitle(patentCov.patentId)}>
                      {getShortPatentId(patentCov.patentId)}
                    </span>
                  </td>
                  {conceptNames.map(conceptName => {
                    const item = patentCov.conceptsCovered.find(c => c.conceptName === conceptName);
                    const coverage = item?.coverage || 'none';
                    const isHovered = hoveredCell?.patentId === patentCov.patentId && hoveredCell?.concept === conceptName;
                    return (
                      <td
                        key={conceptName}
                        className={`text-center px-2 py-2 cursor-help relative ${CoverageBgClass[coverage]}`}
                        onMouseEnter={() => setHoveredCell({ patentId: patentCov.patentId, concept: conceptName })}
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        <CoverageIcon coverage={coverage} />
                        {isHovered && (
                          <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1 w-52 p-2 bg-slate-900 text-white text-[11px] rounded shadow-lg leading-relaxed pointer-events-none">
                            {getEvidence(patentCov.patentId, conceptName) || 'No evidence'}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t bg-slate-50/50 flex gap-4 text-xs text-muted-foreground">
          <span><span className="text-green-600 font-bold">&#10003;</span> full</span>
          <span><span className="text-yellow-600 font-bold">~</span> partial</span>
          <span><span className="text-red-400 font-bold">&#10007;</span> none</span>
          <span className="ml-auto">Hover cells for evidence</span>
        </div>
      </section>

      {/* Section 102 — Anticipation */}
      <section className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50">
          <h2 className="text-sm font-semibold">Section 102 — Anticipation</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Does any single reference disclose ALL elements of your invention?
          </p>
        </div>
        <div className="px-4 py-3">
          {!has102 ? (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-green-600 text-lg leading-none mt-0.5">&#9989;</span>
              <div>
                <p className="text-sm font-medium text-green-800">No single patent anticipates all concepts</p>
                <p className="text-xs text-green-600 mt-0.5">
                  None of the analyzed patents individually disclose every element of your invention.
                  This is favorable for patentability under 35 USC 102.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <span className="text-red-600 text-lg leading-none mt-0.5">&#9888;&#65039;</span>
                <div>
                  <p className="text-sm font-medium text-red-800">Potential anticipation found</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    {result.section102.length === 1 ? 'One patent' : `${result.section102.length} patents`} may
                    anticipate your invention under 35 USC 102.
                  </p>
                </div>
              </div>
              {result.section102.map((candidate: Section102Candidate) => (
                <div key={candidate.patentId} className="border border-red-200 rounded-lg p-3 bg-red-50/50">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm">{candidate.patentId}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">
                      {candidate.coveragePercent}% coverage
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{candidate.reasoning}</p>
                  <p className="text-xs text-slate-500 mt-0.5 italic">
                    {getPatentTitle(candidate.patentId)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Section 103 — Obviousness Combinations */}
      <section className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50">
          <h2 className="text-sm font-semibold">Section 103 — Obviousness Combinations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Would combining 2-3 references make your invention obvious?
          </p>
        </div>
        <div className="px-4 py-3 space-y-3">
          {result.section103.length === 0 ? (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-green-600 text-lg leading-none mt-0.5">&#9989;</span>
              <div>
                <p className="text-sm font-medium text-green-800">No obvious combinations found</p>
                <p className="text-xs text-green-600 mt-0.5">
                  The AI did not identify threatening combinations among the analyzed patents.
                </p>
              </div>
            </div>
          ) : (
            result.section103.map((combo: Section103Combination, i: number) => {
              const coverageColor = combo.combinedCoverage >= 90
                ? 'bg-red-100 text-red-700 border-red-200'
                : combo.combinedCoverage >= 75
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-yellow-100 text-yellow-700 border-yellow-200';

              return (
                <div key={i} className="border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b flex items-center gap-2">
                    <span className="text-xs font-semibold">Combination {i + 1}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${coverageColor}`}>
                      {combo.combinedCoverage}% combined coverage
                    </span>
                    {combo.fieldOverlap && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        Field: {combo.fieldOverlap}
                      </span>
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    {/* Primary reference */}
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold shrink-0 mt-0.5">
                        PRIMARY
                      </span>
                      <div className="flex-1">
                        <span className="font-mono font-medium text-sm">{combo.primary.patentId}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {getPatentTitle(combo.primary.patentId)}
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {combo.primary.conceptsContributed.map((c, j) => (
                            <span key={j} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded border border-blue-200">
                              {c}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{combo.primary.reasoning}</p>
                      </div>
                    </div>

                    {/* Secondary references */}
                    {combo.secondary.map((sec, j) => (
                      <div key={j} className="flex items-start gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold shrink-0 mt-0.5">
                          SECONDARY
                        </span>
                        <div className="flex-1">
                          <span className="font-mono font-medium text-sm">{sec.patentId}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {getPatentTitle(sec.patentId)}
                          </span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sec.conceptsContributed.map((c, k) => (
                              <span key={k} className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded border border-amber-200">
                                {c}
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{sec.reasoning}</p>
                        </div>
                      </div>
                    ))}

                    {/* Combination reasoning */}
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Motivation to combine:</span>{' '}
                        {combo.combinationReasoning}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Re-run button */}
      <div className="text-center pb-4">
        <button
          onClick={runAnalysis}
          className="px-4 py-2 border rounded-lg hover:bg-secondary text-sm font-medium"
        >
          Re-run Analysis
        </button>
      </div>
    </div>
  );
};

export default PriorArtAnalysis;
