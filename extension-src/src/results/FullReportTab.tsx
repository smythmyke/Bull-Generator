import React, { useState } from 'react';
import {
  generateReportSections,
  GenerateReportSectionsResponse,
  PriorArtAnalysisResponse,
} from '../services/apiService';
import { useCreditGate } from '../hooks/useCreditGate';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';
import { deriveEPOCategories, buildPriorArtSummary, buildFullReportData } from '../utils/fullReportData';
import { exportFullReportPDF, exportFullReportDOCX } from '../utils/exportFullReport';

interface PatentForReport {
  patentId: string;
  patentNumber: string;
  title: string;
  abstract: string;
  fullAbstract: string;
  cpcCodes: string[];
  firstClaim: string;
  assignee?: string;
  independentClaims?: { claimNumber: number; text: string }[];
  backwardCitationCount?: number;
  familyId?: string;
}

interface FullReportTabProps {
  query: string;
  concepts: { name: string; synonyms: string[]; importance?: string; category?: string }[];
  patents: PatentForReport[];
  searchMeta: any;
  priorArtResult: PriorArtAnalysisResponse | null;
  priorArtConcepts: { name: string; synonyms: string[] }[];
  fullReportSections: GenerateReportSectionsResponse | null;
  onFullReportSectionsChange: (sections: GenerateReportSectionsResponse) => void;
}

type ReportStatus = 'idle' | 'generating' | 'done' | 'error';

const FullReportTab: React.FC<FullReportTabProps> = ({
  query, concepts, patents, searchMeta,
  priorArtResult, priorArtConcepts,
  fullReportSections, onFullReportSectionsChange,
}) => {
  const [status, setStatus] = useState<ReportStatus>(fullReportSections ? 'done' : 'idle');
  const [error, setError] = useState('');
  const { checkingAction, showPurchasePrompt, canSearch, withCreditCheck, dismissPurchasePrompt } = useCreditGate();

  const hasPriorArt = priorArtResult !== null;

  const doGenerate = async () => {
    if (!priorArtResult) return;
    setStatus('generating');
    setError('');

    try {
      const epoCategories = deriveEPOCategories(
        priorArtResult.section102,
        priorArtResult.section103,
        patents.map(p => p.patentId)
      );

      const priorArtSummary = buildPriorArtSummary(
        priorArtResult.section102,
        priorArtResult.section103,
        priorArtConcepts.length > 0 ? priorArtConcepts : concepts,
        priorArtResult.conceptCoverage
      );

      const epoCatMap = new Map(epoCategories.map(e => [e.patentId, e.category]));
      const xyPatents = patents
        .filter(p => {
          const cat = epoCatMap.get(p.patentId);
          return cat === 'X' || cat === 'Y';
        })
        .slice(0, 7);

      const conceptsForAI = (concepts.length > 0 ? concepts : priorArtConcepts).map(c => ({
        name: c.name,
        synonyms: c.synonyms,
        category: (c as any).category || 'device',
        importance: (c as any).importance || 'medium',
      }));

      const topPatents = xyPatents.map(p => ({
        patentId: p.patentId,
        title: p.title,
        abstract: p.fullAbstract || p.abstract,
        claims: p.firstClaim,
        cpcCodes: p.cpcCodes,
        assignee: p.assignee || '',
      }));

      const aiSections = await generateReportSections({
        query,
        concepts: conceptsForAI,
        topPatents,
        priorArtSummary,
        epoCategories,
      });

      onFullReportSectionsChange(aiSections);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Full report generation failed');
      setStatus('error');
    }
  };

  const handleGenerate = async () => {
    await withCreditCheck('full-report', 2, async () => {
      await doGenerate();
    });
  };

  const handleExportPDF = () => {
    if (!priorArtResult || !fullReportSections) return;
    const allConcepts = (concepts.length > 0 ? concepts : priorArtConcepts).map(c => ({
      name: c.name, synonyms: c.synonyms,
      importance: (c as any).importance, category: (c as any).category,
    }));
    const reportData = buildFullReportData(
      query, searchMeta, allConcepts,
      patents.map((p, i) => ({
        patentId: p.patentId, title: p.title,
        assignee: p.assignee || '',
        abstract: p.fullAbstract || p.abstract,
        cpcCodes: p.cpcCodes, firstClaim: p.firstClaim,
        rank: i + 1,
      })),
      priorArtResult, fullReportSections
    );
    exportFullReportPDF(reportData);
  };

  const handleExportDOCX = async () => {
    if (!priorArtResult || !fullReportSections) return;
    const allConcepts = (concepts.length > 0 ? concepts : priorArtConcepts).map(c => ({
      name: c.name, synonyms: c.synonyms,
      importance: (c as any).importance, category: (c as any).category,
    }));
    const reportData = buildFullReportData(
      query, searchMeta, allConcepts,
      patents.map((p, i) => ({
        patentId: p.patentId, title: p.title,
        assignee: p.assignee || '',
        abstract: p.fullAbstract || p.abstract,
        cpcCodes: p.cpcCodes, firstClaim: p.firstClaim,
        rank: i + 1,
      })),
      priorArtResult, fullReportSections
    );
    await exportFullReportDOCX(reportData);
  };

  // Not ready — prior art analysis required first
  if (!hasPriorArt) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="max-w-md mx-auto space-y-4">
          <div className="text-4xl">&#128203;</div>
          <h2 className="text-lg font-semibold">Full Patent Search Report</h2>
          <p className="text-sm text-muted-foreground">
            Generate a comprehensive 8-section report with invention summary, claim charts,
            EPO reference categorization, and patentability assessment.
          </p>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-left">
            <p className="text-sm text-amber-800 font-medium">Examiner's Report required</p>
            <p className="text-xs text-amber-600 mt-1">
              Run the Examiner's Report (Prior Art Analysis) first. The full report builds on that
              analysis to generate claim charts, EPO categories, and a patentability conclusion.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Idle — ready to generate
  if (status === 'idle') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="max-w-md mx-auto space-y-4">
          <div className="text-4xl">&#128203;</div>
          <h2 className="text-lg font-semibold">Full Patent Search Report</h2>
          <p className="text-sm text-muted-foreground">
            Generate a comprehensive 8-section report including invention summary, search methodology,
            EPO-categorized references, concept coverage matrix, claim charts, 102/103 analysis,
            and patentability conclusion with recommendations.
          </p>
          {showPurchasePrompt ? (
            <InsufficientCreditsModal onDismiss={dismissPurchasePrompt} />
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!canSearch || checkingAction !== null}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {checkingAction === 'full-report' ? 'Checking credits...' : 'Generate Full Report (2 credits)'}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Uses AI to generate invention summary, element mapping (claim charts), and patentability conclusion.
            Exports as PDF or DOCX.
          </p>
        </div>
      </div>
    );
  }

  // Generating
  if (status === 'generating') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
          <p className="text-sm font-medium">Generating full report...</p>
          <p className="text-xs text-muted-foreground">
            AI is analyzing patents and writing invention summary, claim charts, and patentability conclusion.
            This may take 15-30 seconds.
          </p>
        </div>
      </div>
    );
  }

  // Error
  if (status === 'error') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="space-y-4 max-w-md mx-auto">
          <div className="text-3xl">&#9888;</div>
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={handleGenerate}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Done — show export options
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      {/* Success banner */}
      <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
        <span className="text-green-600 text-2xl leading-none">&#9989;</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-green-800">Full report generated</p>
          <p className="text-xs text-green-600 mt-0.5">
            8-section report with {fullReportSections?.claimCharts?.length || 0} claim charts ready for export.
          </p>
        </div>
      </div>

      {/* Report preview summary */}
      {fullReportSections && (
        <div className="space-y-4">
          {/* Invention Summary preview */}
          <section className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50">
              <h3 className="text-sm font-semibold">1. Invention Summary</h3>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {fullReportSections.inventionSummary.narrative}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {fullReportSections.inventionSummary.features.map(f => {
                  const impColor = f.importance === 'high'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : f.importance === 'medium'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200';
                  return (
                    <span key={f.id} className={`text-[10px] px-2 py-0.5 rounded border font-medium ${impColor}`}>
                      {f.id}: {f.name}
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Conclusion preview */}
          <section className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50">
              <h3 className="text-sm font-semibold">8. Conclusion & Recommendations</h3>
            </div>
            <div className="px-4 py-3 space-y-2">
              {(() => {
                const riskColor = fullReportSections.conclusion.overallRisk === 'high'
                  ? 'bg-red-100 text-red-700 border-red-300'
                  : fullReportSections.conclusion.overallRisk === 'moderate'
                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                    : 'bg-green-100 text-green-700 border-green-300';
                return (
                  <span className={`inline-block text-xs px-2 py-0.5 rounded border font-semibold ${riskColor}`}>
                    {fullReportSections.conclusion.overallRisk.toUpperCase()} RISK
                  </span>
                );
              })()}
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">Novelty: </span>
                {fullReportSections.conclusion.noveltyAssessment.substring(0, 200)}
                {fullReportSections.conclusion.noveltyAssessment.length > 200 ? '...' : ''}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">Recommendations: </span>
                {fullReportSections.conclusion.recommendations.length} actionable items
              </p>
            </div>
          </section>

          {/* Claim charts count */}
          <div className="text-xs text-muted-foreground text-center">
            Report includes sections 2-7 (methodology, references, coverage matrix, claim charts, 102/103 analysis)
            from your search and examiner's report data.
          </div>
        </div>
      )}

      {/* Export buttons */}
      <div className="flex items-center justify-center gap-3 pt-2">
        <button
          onClick={handleExportPDF}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
          Export PDF
        </button>
        <button
          onClick={handleExportDOCX}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Export DOCX
        </button>
      </div>

      {/* Re-generate */}
      <div className="text-center">
        <button
          onClick={handleGenerate}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Re-generate report (2 credits)
        </button>
      </div>
    </div>
  );
};

export default FullReportTab;
