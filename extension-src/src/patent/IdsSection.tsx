import React, { useMemo, useState } from 'react';
import { FileDown, AlertTriangle, Info } from 'lucide-react';
import type { PatentDossier, OfficeActionAnalysis } from '../services/apiService';
import { buildIdsBundle } from './idsGenerator';
import { exportIdsPdf } from './idsExporters/toPdf';
import { exportIdsDocx } from './idsExporters/toDocx';
import { downloadIdsCsv } from './idsExporters/toCsv';
import { downloadIdsXml } from './idsExporters/toXml';

interface IdsSectionProps {
  dossier: PatentDossier;
  applicationNumber?: string;
  oaAnalyses: OfficeActionAnalysis[];
}

type ExportFormat = 'pdf' | 'docx' | 'csv' | 'xml';

const IdsSection: React.FC<IdsSectionProps> = ({
  dossier,
  applicationNumber,
  oaAnalyses,
}) => {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bundle = useMemo(
    () =>
      buildIdsBundle({
        patentNumber: dossier.patentNumber,
        applicationNumber,
        backward: dossier.citations.backward,
        oaAnalyses,
      }),
    [dossier, applicationNumber, oaAnalyses],
  );

  const isUs = /^US/i.test(dossier.patentNumber);
  const counts = bundle.counts;

  const handleExport = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    try {
      if (format === 'pdf') exportIdsPdf(bundle);
      else if (format === 'docx') await exportIdsDocx(bundle);
      else if (format === 'csv') downloadIdsCsv(bundle);
      else if (format === 'xml') downloadIdsXml(bundle);
    } catch (e) {
      setError((e as Error)?.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="ids" className="mb-8 break-inside-avoid scroll-mt-20">
      <h2 className="text-base font-bold text-slate-800 border-b-2 border-slate-800 pb-1.5 mb-2.5 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[10px]">13</span>
        Information Disclosure Statement (IDS)
      </h2>

      <p className="text-xs text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-blue-600 rounded-r leading-relaxed">
        Auto-generated USPTO Form SB/08 from this patent's citation network.
        Merges backward citations (from Google Patents) with any Office Action-cited art from analyses you've run.
      </p>

      {!isUs && (
        <div className="text-[11px] text-amber-800 mb-3 px-3 py-2 bg-amber-50 border-l-[3px] border-amber-500 rounded-r leading-relaxed flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          <span>
            Form SB/08 is a USPTO filing form. The exported data is still useful for any patent,
            but the form headings reference US filing terminology.
          </span>
        </div>
      )}

      {/* Source breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatChip label="Total references" value={counts.total} emphasis />
        <StatChip label="Backward citations" value={counts.fromBackward} />
        <StatChip label="Examiner-cited" value={counts.fromExaminerCited} />
        <StatChip
          label="From OA analyses"
          value={counts.fromOaCited}
          sublabel={counts.analyzedOaCount > 0
            ? `${counts.analyzedOaCount} OA${counts.analyzedOaCount === 1 ? '' : 's'} analyzed`
            : 'no OAs analyzed yet'}
        />
      </div>

      {counts.analyzedOaCount === 0 && (
        <div className="text-[11px] text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-slate-400 rounded-r leading-relaxed flex gap-2">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-px text-slate-500" />
          <span>
            To include art the examiner has cited in Office Actions, expand any office action in § 10
            and run the analyzer first. Re-export afterward to merge that art.
          </span>
        </div>
      )}

      {counts.total === 0 ? (
        <div className="text-xs text-slate-500 px-3 py-4 border border-dashed rounded text-center">
          No backward citations or OA-cited art available for this patent.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <ExportButton
              label="Generate PDF"
              format="pdf"
              busy={busy === 'pdf'}
              onClick={() => handleExport('pdf')}
              primary
            />
            <ExportButton
              label="Generate DOCX"
              format="docx"
              busy={busy === 'docx'}
              onClick={() => handleExport('docx')}
            />
            <ExportButton
              label="Export CSV"
              format="csv"
              busy={busy === 'csv'}
              onClick={() => handleExport('csv')}
            />
            <ExportButton
              label="Export XML"
              format="xml"
              busy={busy === 'xml'}
              onClick={() => handleExport('xml')}
            />
          </div>

          {error && (
            <div className="text-[11px] text-red-700 px-3 py-2 bg-red-50 border-l-[3px] border-red-500 rounded-r mb-3">
              {error}
            </div>
          )}

          <p className="text-[10px] text-slate-500 leading-relaxed">
            XML uses an internal IDS schema for downstream tooling — it is not a direct USPTO e-filing format.
            USPTO Patent Center accepts web-form IDS or DOCX/PDF uploads. Always have a registered patent
            attorney or agent review and sign an IDS before filing. Not legal advice.
          </p>
        </>
      )}
    </section>
  );
};

interface StatChipProps {
  label: string;
  value: number;
  sublabel?: string;
  emphasis?: boolean;
}

const StatChip: React.FC<StatChipProps> = ({ label, value, sublabel, emphasis }) => (
  <div
    className={`rounded border px-3 py-2 ${
      emphasis ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white'
    }`}
  >
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-0.5 font-bold ${emphasis ? 'text-2xl text-slate-800' : 'text-xl text-slate-700'}`}>
      {value}
    </div>
    {sublabel && <div className="text-[10px] text-slate-500 mt-0.5">{sublabel}</div>}
  </div>
);

interface ExportButtonProps {
  label: string;
  format: ExportFormat;
  busy: boolean;
  primary?: boolean;
  onClick: () => void;
}

const ExportButton: React.FC<ExportButtonProps> = ({ label, busy, primary, onClick }) => (
  <button
    onClick={onClick}
    disabled={busy}
    className={`text-xs font-semibold px-4 py-2 rounded border flex items-center gap-1.5 transition-colors ${
      primary
        ? 'bg-slate-800 text-white border-slate-800 hover:bg-slate-700 disabled:bg-slate-400'
        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 disabled:text-slate-400 disabled:bg-slate-50'
    }`}
  >
    <FileDown className="h-3 w-3" />
    {busy ? 'Working…' : label}
  </button>
);

export default IdsSection;
