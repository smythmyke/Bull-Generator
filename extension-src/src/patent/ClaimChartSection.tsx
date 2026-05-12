import React from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, FileText } from 'lucide-react';
import type {
  ClaimChart,
  ClaimChartItem,
  ClaimChartElement,
  ClaimChartReference,
  ClaimStatus,
} from '../services/apiService';

interface ClaimChartSectionProps {
  chart: ClaimChart | null;
  loading: boolean;
  error: string | null;
  analyzedOaCount: number;
}

const ClaimChartSection: React.FC<ClaimChartSectionProps> = ({
  chart,
  loading,
  error,
  analyzedOaCount,
}) => {
  return (
    <section id="claim-chart" className="mb-8 scroll-mt-20">
      <h2 className="text-base font-bold text-slate-800 border-b-2 border-slate-800 pb-1.5 mb-2.5 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[10px]">12</span>
        Claim Chart
      </h2>

      <p className="text-xs text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-blue-600 rounded-r leading-relaxed">
        Per-claim element decomposition mapped to examiner-cited prior art from Office Actions.
        Analyze Office Actions in § 10 first to see prior-art mappings populate here.
      </p>

      {analyzedOaCount === 0 && !loading && (
        <div className="text-[11px] text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-slate-400 rounded-r leading-relaxed">
          No Office Actions analyzed yet. The chart shows element decomposition only. Expand any OA in § 10 and click "Analyze" to enrich this chart with examiner-cited art.
        </div>
      )}

      {loading && (
        <div className="text-xs text-slate-500 italic px-3 py-4 text-center">
          Generating claim chart…
        </div>
      )}

      {error && !loading && (
        <div className="text-[11px] text-red-700 px-3 py-2 bg-red-50 border-l-[3px] border-red-500 rounded-r">
          {error}
        </div>
      )}

      {chart && !loading && (
        <div className="space-y-3">
          {chart.claimCharts.filter((c) => c.isIndependent).length === 0 && (
            <div className="text-xs text-slate-500 px-3 py-4 border border-dashed rounded text-center">
              No independent claims found for this patent.
            </div>
          )}

          {chart.claimCharts.filter((c) => c.isIndependent).map((item) => (
            <ClaimRow key={item.claimNumber} item={item} dependents={chart.claimCharts.filter((c) => !c.isIndependent && c.dependsOn === item.claimNumber)} />
          ))}

          <div className="text-[10px] text-slate-400 italic mt-2">
            Generated {new Date(chart.generatedAt).toLocaleString()}{chart.cached ? ' · cached' : ''}{' · '}{chart.analyzedOaCount} OA{chart.analyzedOaCount === 1 ? '' : 's'} merged
          </div>
        </div>
      )}
    </section>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────

function statusBadge(status: ClaimStatus): { label: string; classes: string; Icon: React.ComponentType<{ className?: string }> } {
  switch (status) {
    case 'allowed':
      return { label: 'Allowed', classes: 'bg-green-50 border-green-200 text-green-700', Icon: CheckCircle2 };
    case 'rejected':
      return { label: 'Rejected', classes: 'bg-red-50 border-red-200 text-red-700', Icon: XCircle };
    case 'pending':
      return { label: 'Pending', classes: 'bg-amber-50 border-amber-200 text-amber-700', Icon: Clock };
    default:
      return { label: 'Unknown', classes: 'bg-slate-100 border-slate-200 text-slate-600', Icon: FileText };
  }
}

function statuteColor(statute: ClaimChartReference['rejectionStatute']): string {
  switch (statute) {
    case '102':
      return 'bg-red-100 text-red-800 border-red-200';
    case '103':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case '112':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case '101':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'double-patenting':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

// ── Subcomponents ─────────────────────────────────────────────────────────

interface ClaimRowProps {
  item: ClaimChartItem;
  dependents: ClaimChartItem[];
}

const ClaimRow: React.FC<ClaimRowProps> = ({ item, dependents }) => {
  const badge = statusBadge(item.status);
  const Icon = badge.Icon;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <span className="font-bold text-sm text-slate-800">Claim {item.claimNumber}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Independent</span>
        <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium ${badge.classes}`}>
          <Icon className="h-3 w-3" />
          {badge.label}
        </span>
      </div>

      {item.statusReasoning && (
        <div className="px-3 py-2 text-[11px] text-slate-700 bg-white border-b border-slate-100 leading-relaxed">
          {item.statusReasoning}
        </div>
      )}

      {item.generationError && (
        <div className="px-3 py-2 text-[11px] text-red-700 bg-red-50 border-b border-red-100">
          Chart generation failed: {item.generationError}
        </div>
      )}

      {item.elements.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500 w-16">Element</th>
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Limitation</th>
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500 w-1/3">Cited Prior Art</th>
            </tr>
          </thead>
          <tbody>
            {item.elements.map((el) => <ElementRow key={el.label} el={el} />)}
          </tbody>
        </table>
      )}

      {dependents.length > 0 && (
        <details className="px-3 py-2 bg-slate-50/50 border-t border-slate-100">
          <summary className="text-[11px] text-slate-600 cursor-pointer select-none">
            {dependents.length} dependent claim{dependents.length === 1 ? '' : 's'} (inherits from claim {item.claimNumber})
          </summary>
          <div className="mt-2 space-y-1 text-[11px]">
            {dependents.map((d) => (
              <div key={d.claimNumber} className="text-slate-600">
                <span className="font-medium">Claim {d.claimNumber}</span>
                <span className="text-slate-400"> — depends on claim {d.dependsOn}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

const ElementRow: React.FC<{ el: ClaimChartElement }> = ({ el }) => (
  <tr className="border-b border-slate-100 last:border-b-0 align-top">
    <td className="px-3 py-2 font-mono text-[10px] text-slate-500 whitespace-nowrap">
      {el.label}
    </td>
    <td className="px-3 py-2 text-slate-700 leading-relaxed">{el.text}</td>
    <td className="px-3 py-2">
      {el.citedReferences.length === 0 ? (
        <span className="text-[10px] text-slate-400 italic">— none —</span>
      ) : (
        <div className="space-y-1.5">
          {el.citedReferences.map((ref, idx) => (
            <CitedRefBlock key={`${ref.patentNumber}-${idx}`} ref={ref} />
          ))}
        </div>
      )}
    </td>
  </tr>
);

const CitedRefBlock: React.FC<{ ref: ClaimChartReference }> = ({ ref }) => (
  <div className="text-[11px]">
    <div className="flex items-center gap-1.5">
      <span className="font-mono font-medium text-slate-800">{ref.patentNumber}</span>
      <span className={`inline-block px-1.5 py-0 text-[9px] rounded border ${statuteColor(ref.rejectionStatute)}`}>
        §{ref.rejectionStatute}
      </span>
    </div>
    <div className="text-slate-600 mt-0.5 italic leading-snug">"{ref.examinerReasoning}"</div>
  </div>
);

export default ClaimChartSection;
