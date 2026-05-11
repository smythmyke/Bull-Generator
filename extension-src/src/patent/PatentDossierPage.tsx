import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPatentDossier,
  fetchDossierSummary,
  PatentDossier,
  PatentStatus,
  DossierClaim,
  DossierCitation,
  DossierCpc,
  DossierFamilyMember,
  DossierSummary,
  ClaimScopeLabel,
} from '../services/apiService';
import { useAuthContext } from '../contexts/AuthContext';
import { CheckCircle2, XCircle, Clock, AlertTriangle, ExternalLink, Printer, Sparkles, RefreshCw } from 'lucide-react';

// ── Visual helpers ──────────────────────────────────────────────────────

function statusToneClasses(status: PatentStatus): string {
  switch (status) {
    case 'active':
      return 'bg-green-50 border-green-200 text-green-700';
    case 'lapsed':
    case 'expired':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'pending':
      return 'bg-amber-50 border-amber-200 text-amber-700';
    default:
      return 'bg-slate-100 border-slate-200 text-slate-600';
  }
}

function statusIcon(status: PatentStatus): React.ReactNode {
  switch (status) {
    case 'active':
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case 'lapsed':
    case 'expired':
      return <XCircle className="h-3.5 w-3.5" />;
    case 'pending':
      return <Clock className="h-3.5 w-3.5" />;
    default:
      return null;
  }
}

function gpUrl(patentNumber: string): string {
  return `https://patents.google.com/patent/${patentNumber}/en`;
}

interface SectionProps {
  id: string;
  num: number;
  title: string;
  intro: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ id, num, title, intro, children }) => (
  <section id={id} className="mb-8 break-inside-avoid scroll-mt-20">
    <h2 className="text-base font-bold text-slate-800 border-b-2 border-slate-800 pb-1.5 mb-2.5 flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[10px]">
        {num}
      </span>
      {title}
    </h2>
    <p className="text-xs text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-blue-600 rounded-r leading-relaxed">
      {intro}
    </p>
    {children}
  </section>
);

const NAV_SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'legal-status', label: 'Status' },
  { id: 'family', label: 'Family' },
  { id: 'claims', label: 'Claims' },
  { id: 'citations', label: 'Citations' },
  { id: 'classification', label: 'Classification' },
  { id: 'similar', label: 'Similar' },
  { id: 'export', label: 'Export' },
];

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/lailglkmjkboieogmakjkcbihbldigno';

interface BrandHeaderProps {
  activeId: string;
  onNavClick: (id: string) => void;
}

const BrandHeader: React.FC<BrandHeaderProps> = ({ activeId, onNavClick }) => (
  <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm print:static print:bg-white print:shadow-none print:border-b-2 print:border-slate-800">
    <div className="max-w-5xl mx-auto px-8 py-3 flex items-center gap-4">
      <div className="flex items-center gap-2 shrink-0">
        <img src="icons/icon128.png" alt="" className="h-7 w-7" />
        <span className="font-semibold text-slate-800 text-sm leading-none">
          AI Patent Search Generator
        </span>
        <a
          href={`${CHROME_STORE_URL}?utm_source=patent_dossier_header`}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:inline-flex text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 print:bg-white print:border-slate-300 print:text-slate-700"
          title="Get it on the Chrome Web Store"
        >
          Chrome Extension
        </a>
      </div>
      <nav className="ml-auto flex flex-wrap gap-0.5 print:hidden">
        {NAV_SECTIONS.map((s) => {
          const isActive = activeId === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => onNavClick(s.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                isActive
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {s.label}
            </a>
          );
        })}
      </nav>
    </div>
  </header>
);

// ── Section bodies ─────────────────────────────────────────────────────

const HeaderBlock: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => {
  const h = dossier.header;
  const familyCount = dossier.family.members.length;
  return (
    <div className="border-b-[3px] border-slate-800 pb-6 mb-8">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Patent Dossier</div>
      <h1 className="text-2xl font-bold text-slate-800 leading-tight">{h.title}</h1>
      <div className="font-mono text-sm text-blue-600 mt-1 mb-4">{dossier.patentNumber}</div>

      <div className="flex flex-wrap gap-2 mb-4">
        <span
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${statusToneClasses(
            h.status
          )}`}
        >
          {statusIcon(h.status)}
          {h.statusLabel}
        </span>
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
          Family: {familyCount}
        </span>
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
          Claims: {dossier.claims.totalCount}
        </span>
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
          Cites: {dossier.citations.forwardCount}↓ &nbsp; {dossier.citations.backwardCount}↑
        </span>
        {dossier.cached && (
          <span className="inline-flex items-center text-[10px] italic px-2 py-1 rounded-full bg-slate-50 text-slate-500">
            cached
          </span>
        )}
      </div>

      <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-xs border border-slate-200 rounded-md p-3.5 bg-slate-50">
        {[
          ['Assignee', h.currentAssignee],
          ['Original Assignee', h.originalAssignee && h.originalAssignee !== h.currentAssignee ? h.originalAssignee : ''],
          ['Inventors', h.inventors.join(' · ')],
          ['Application No.', h.applicationNumber],
          ['Priority Date', h.priorityDate],
          ['Filing Date', h.filingDate],
          ['Publication / Grant', h.publicationDate],
          ['Anticipated Expiration', h.anticipatedExpiration],
        ]
          .filter(([, v]) => Boolean(v))
          .map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-slate-500 font-medium">{label}</dt>
              <dd className="font-semibold text-slate-800">{value}</dd>
            </React.Fragment>
          ))}
      </dl>
    </div>
  );
};

const AbstractSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => (
  <Section
    id="abstract"
    num={2}
    title="Abstract"
    intro="Verbatim abstract as published. The AI summary in § 1 distills this into plain English."
  >
    <div className="bg-slate-50 border border-slate-200 rounded-md p-4 text-sm leading-relaxed text-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
        Verbatim Abstract
      </div>
      {dossier.header.abstract || (
        <span className="italic text-slate-500">No abstract returned by the source.</span>
      )}
    </div>
  </Section>
);

const LegalStatusSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => (
  <Section
    id="legal-status"
    num={3}
    title="Legal Status"
    intro="Live status across all jurisdictions where this invention has been filed. Annuity history and re-exam events ship in Phase 2 with USPTO ODP."
  >
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="bg-slate-50">
          <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
            Jurisdiction
          </th>
          <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
            Status
          </th>
          <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
            Key Date
          </th>
        </tr>
      </thead>
      <tbody>
        {dossier.legalStatus.map((row, i) => (
          <tr key={i}>
            <td className="border border-slate-200 px-3 py-2">{row.jurisdiction}</td>
            <td className="border border-slate-200 px-3 py-2">{row.status}</td>
            <td className="border border-slate-200 px-3 py-2">{row.keyDate}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Section>
);

const FamilySection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => {
  const members: DossierFamilyMember[] = dossier.family.members;
  return (
    <Section
      id="family"
      num={4}
      title="Family Map"
      intro="All worldwide applications claiming priority from the same root filing. Larger families render as a priority-chain tree (future enhancement)."
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Jurisdiction
            </th>
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Publication No.
            </th>
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Kind
            </th>
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <tr key={i} className={m.publicationNumber === dossier.patentNumber ? 'bg-blue-50' : ''}>
              <td className="border border-slate-200 px-3 py-2">{m.jurisdiction}</td>
              <td className="border border-slate-200 px-3 py-2 font-mono text-blue-700">
                <a href={gpUrl(m.publicationNumber)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {m.publicationNumber}
                </a>
              </td>
              <td className="border border-slate-200 px-3 py-2 text-slate-600">{m.type}</td>
              <td className="border border-slate-200 px-3 py-2 text-slate-600">{m.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
};

const ClaimsSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => {
  const items: DossierClaim[] = dossier.claims.items;
  // Group dependents under their parent for tree-like display
  const childrenOf = useMemo(() => {
    const map = new Map<number, DossierClaim[]>();
    items.forEach((c) => {
      if (c.dependsOn !== undefined) {
        if (!map.has(c.dependsOn)) map.set(c.dependsOn, []);
        map.get(c.dependsOn)!.push(c);
      }
    });
    return map;
  }, [items]);
  const independents = items.filter((c) => c.isIndependent);

  return (
    <Section
      id="claims"
      num={5}
      title="Claim Tree"
      intro={`${dossier.claims.totalCount} total claims · ${dossier.claims.independentNumbers.length} independent. Click any claim to expand the verbatim text.`}
    >
      <ul className="space-y-3">
        {independents.map((c) => (
          <li key={c.number} className="border-b border-slate-200 pb-3 last:border-b-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block bg-blue-600 text-white text-[10px] font-bold font-mono px-2 py-0.5 rounded">
                {c.number}
              </span>
              <span className="text-xs font-semibold text-slate-700">Independent</span>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-blue-600 text-xs hover:underline">Show verbatim text</summary>
              <div className="mt-2 px-3 py-2 bg-slate-50 border-l-[3px] border-blue-600 rounded-r text-xs leading-relaxed text-slate-700">
                {c.text}
              </div>
            </details>
            {(childrenOf.get(c.number) || []).length > 0 && (
              <div className="ml-5 mt-2 text-[11px] text-slate-500">
                Dependents:
                {(childrenOf.get(c.number) || []).map((d) => (
                  <span
                    key={d.number}
                    className="inline-block ml-1 mr-0.5 px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 text-[10px] font-mono"
                  >
                    {d.number}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
};

const CitationRow: React.FC<{ c: DossierCitation }> = ({ c }) => (
  <tr>
    <td className="border border-slate-200 px-3 py-2 font-mono text-blue-700">
      <a href={gpUrl(c.patentNumber)} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {c.patentNumber}
      </a>
      {c.examinerCited && (
        <span className="ml-1 text-[9px] text-slate-500 italic">(examiner)</span>
      )}
    </td>
    <td className="border border-slate-200 px-3 py-2 text-slate-700">{c.title || '—'}</td>
    <td className="border border-slate-200 px-3 py-2 text-slate-600">{c.assignee || '—'}</td>
    <td className="border border-slate-200 px-3 py-2 text-slate-600 whitespace-nowrap">{c.date || '—'}</td>
  </tr>
);

const CitationsSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => (
  <Section
    id="citations"
    num={6}
    title="Citation Network"
    intro="Backward citations describe prior art this patent built on. Forward citations describe inventions that have since built on this one."
  >
    <div className="grid grid-cols-2 gap-3 mb-4">
      <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Cited By (forward)
        </div>
        <div className="text-2xl font-bold text-slate-800 mt-0.5">{dossier.citations.forwardCount}</div>
      </div>
      <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Cites (backward)
        </div>
        <div className="text-2xl font-bold text-slate-800 mt-0.5">{dossier.citations.backwardCount}</div>
      </div>
    </div>

    {dossier.citations.forward.length > 0 && (
      <>
        <h3 className="text-[13px] font-semibold mt-4 mb-2 text-slate-700">
          Top forward citations ({Math.min(10, dossier.citations.forward.length)} of {dossier.citations.forwardCount})
        </h3>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Patent</th>
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Title</th>
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Assignee</th>
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Date</th>
            </tr>
          </thead>
          <tbody>
            {dossier.citations.forward.slice(0, 10).map((c) => <CitationRow key={c.patentNumber} c={c} />)}
          </tbody>
        </table>
      </>
    )}

    {dossier.citations.backward.length > 0 && (
      <>
        <h3 className="text-[13px] font-semibold mt-4 mb-2 text-slate-700">
          Top backward citations ({Math.min(10, dossier.citations.backward.length)} of {dossier.citations.backwardCount})
        </h3>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Patent</th>
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Title</th>
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Assignee</th>
              <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Date</th>
            </tr>
          </thead>
          <tbody>
            {dossier.citations.backward.slice(0, 10).map((c) => <CitationRow key={c.patentNumber} c={c} />)}
          </tbody>
        </table>
      </>
    )}
  </Section>
);

const ClassificationSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => {
  const codes: DossierCpc[] = dossier.classification.cpcCodes;
  const primary = codes.find((c) => c.primary);
  return (
    <Section
      id="classification"
      num={7}
      title="Classification Context"
      intro="Cooperative Patent Classification (CPC) codes assigned by examiners. The primary anchor classification appears in blue."
    >
      {primary && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Primary</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs px-2.5 py-1 rounded bg-slate-800 text-white">{primary.code}</span>
            <span className="text-xs text-slate-700">{primary.label}</span>
          </div>
        </div>
      )}

      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
        All CPC classifications ({codes.length})
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Code</th>
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Description</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.code} className={c.primary ? 'bg-blue-50' : ''}>
              <td className="border border-slate-200 px-3 py-2 font-mono">{c.code}</td>
              <td className="border border-slate-200 px-3 py-2">{c.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
};

const SimilarSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => (
  <Section
    id="similar"
    num={8}
    title="Similar Patents"
    intro="Google's similar-document list, surfaced from the source page."
  >
    {dossier.similar.length === 0 ? (
      <div className="text-xs text-slate-500 italic">No similar documents listed.</div>
    ) : (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Patent</th>
            <th className="border border-slate-200 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500">Title</th>
          </tr>
        </thead>
        <tbody>
          {dossier.similar.slice(0, 15).map((s) => (
            <tr key={s.patentNumber}>
              <td className="border border-slate-200 px-3 py-2 font-mono text-blue-700">
                <a href={gpUrl(s.patentNumber)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {s.patentNumber}
                </a>
              </td>
              <td className="border border-slate-200 px-3 py-2 text-slate-700">{s.title || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Section>
);

function scopeBadgeClasses(label: ClaimScopeLabel): string {
  switch (label) {
    case 'narrow':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'broad':
      return 'bg-green-100 text-green-800 border-green-200';
    default:
      return 'bg-blue-100 text-blue-800 border-blue-200';
  }
}

interface AiSummarySectionProps {
  summary: DossierSummary | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
}

const AiSummarySection: React.FC<AiSummarySectionProps> = ({ summary, loading, error, onGenerate }) => (
  <Section
    id="summary"
    num={1}
    title="AI Summary"
    intro="Plain-English executive overview and claim-scope characterization, generated automatically when the dossier opens. Cached for 30 days; regenerate to refresh."
  >
    <div className="border border-slate-200 rounded-md p-4 bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="flex items-center justify-between mb-3">
        <strong className="text-sm text-slate-800 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-600" />
          Executive Overview
        </strong>
        {(summary || error) && (
          <button
            onClick={onGenerate}
            disabled={loading}
            className="text-[11px] font-semibold px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {error ? 'Try again' : 'Regenerate'}
          </button>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {loading && !summary && (
        <div className="text-xs text-slate-500 italic animate-pulse">Generating summary…</div>
      )}

      {summary && (
        <>
          <div className="space-y-3">
            {summary.executiveOverview.split(/\n+/).map((para, i) => (
              <p key={i} className="text-sm leading-relaxed text-slate-800">
                {para}
              </p>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Claim scope
              </span>
              <span
                className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded border ${scopeBadgeClasses(
                  summary.claimScope.label
                )}`}
              >
                {summary.claimScope.label}
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">{summary.claimScope.rationale}</p>
          </div>

          <div className="mt-3 text-[10px] text-slate-400 italic">
            Generated by Gemini · {new Date(summary.generatedAt).toLocaleString()}
            {summary.cached && ' · cached'}
          </div>
        </>
      )}
    </div>
  </Section>
);

const ExportSection: React.FC<{ dossier: PatentDossier }> = ({ dossier }) => (
  <section id="export" className="mb-8 break-inside-avoid scroll-mt-20 print:hidden">
    <h2 className="text-base font-bold text-slate-800 border-b-2 border-slate-800 pb-1.5 mb-2.5 flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[10px]">9</span>
      Export &amp; Share
    </h2>
    <p className="text-xs text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-blue-600 rounded-r leading-relaxed">
      Print to PDF is available now. Persistent shareable URLs and server-side PDF rendering ship with the Pro plan.
    </p>
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => window.print()}
        className="text-xs font-semibold px-4 py-2 rounded border bg-slate-800 text-white hover:bg-slate-700"
      >
        <Printer className="inline h-3 w-3 mr-1.5 -mt-0.5" />
        Print to PDF
      </button>
      <a
        href={gpUrl(dossier.patentNumber)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-semibold px-4 py-2 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      >
        <ExternalLink className="inline h-3 w-3 mr-1.5 -mt-0.5" />
        Open on Google Patents
      </a>
      <button
        disabled
        className="text-xs font-semibold px-4 py-2 rounded border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
      >
        🔗 Shareable URL
        <span className="ml-2 text-[9px] uppercase tracking-wide">Pro</span>
      </button>
    </div>
  </section>
);

// ── Main page ────────────────────────────────────────────────────────────

const PatentDossierPage: React.FC = () => {
  const { user, isLoading: authLoading } = useAuthContext();
  const [dossier, setDossier] = useState<PatentDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<DossierSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string>(NAV_SECTIONS[0].id);
  // Click-driven nav temporarily wins over scroll observer to avoid flicker
  // while smooth-scrolling settles on the target.
  const clickLockUntilRef = useRef<number>(0);

  const handleNavClick = useCallback((id: string) => {
    setActiveId(id);
    clickLockUntilRef.current = Date.now() + 900;
  }, []);

  const patentNumber = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('number')?.trim() || '';
  }, []);

  const handleGenerateSummary = async () => {
    if (!patentNumber || summaryLoading) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const result = await fetchDossierSummary(patentNumber);
      setSummary(result);
    } catch (e: any) {
      setSummaryError(e?.message || 'Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    document.title = patentNumber ? `${patentNumber} — Patent Dossier` : 'Patent Dossier';
  }, [patentNumber]);

  // Scroll-spy: highlight the nav button for whichever section is currently
  // in the trigger band just under the sticky header.
  useEffect(() => {
    if (!dossier) return;

    const visibleIds = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visibleIds.add(e.target.id);
          else visibleIds.delete(e.target.id);
        }
        if (Date.now() < clickLockUntilRef.current) return;
        if (visibleIds.size === 0) return;
        // Pick topmost visible section by current DOM position
        const sorted = [...visibleIds]
          .map((id) => ({
            id,
            top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity,
          }))
          .sort((a, b) => a.top - b.top);
        setActiveId(sorted[0].id);
      },
      // Trigger band: from just under the sticky header down to ~25% of viewport
      { rootMargin: '-72px 0px -75% 0px', threshold: 0 }
    );

    NAV_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [dossier]);

  useEffect(() => {
    if (authLoading || !user || !patentNumber) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPatentDossier(patentNumber)
      .then((d) => {
        if (cancelled) return;
        setDossier(d);
        // Bundled with the dossier fetch: kick off the AI summary in the
        // background so the user lands on a complete report.
        setSummaryLoading(true);
        setSummaryError(null);
        fetchDossierSummary(patentNumber)
          .then((s) => {
            if (!cancelled) setSummary(s);
          })
          .catch((e) => {
            if (!cancelled) setSummaryError(e?.message || 'Failed to generate summary');
          })
          .finally(() => {
            if (!cancelled) setSummaryLoading(false);
          });
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to fetch dossier');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, patentNumber]);

  if (!patentNumber) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-slate-800 mb-2">No patent specified</h1>
        <p className="text-sm text-slate-600">
          Open this page via the side panel's Patent tab, or pass a patent number in the URL:{' '}
          <code className="font-mono text-blue-600">?number=US10867416B2</code>
        </p>
      </div>
    );
  }

  if (authLoading || (!user && !error)) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-16 text-center text-slate-500">
        <div className="animate-pulse">Verifying session…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-slate-800 mb-2">Sign-in required</h1>
        <p className="text-sm text-slate-600">
          Sign in to the extension first, then re-open the dossier from the side panel.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-16 text-center">
        <div className="animate-pulse text-slate-500">Fetching dossier for {patentNumber}…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-slate-800 mb-2">Couldn't load dossier</h1>
        <p className="text-sm text-slate-600 mb-3">{error}</p>
        <p className="text-xs text-slate-500">
          Patent number tried: <code className="font-mono">{patentNumber}</code>
        </p>
      </div>
    );
  }

  if (!dossier) {
    return null;
  }

  return (
    <div className="bg-white text-slate-900 min-h-screen">
      <BrandHeader activeId={activeId} onNavClick={handleNavClick} />
      <main className="max-w-5xl mx-auto px-8 py-10">
        <HeaderBlock dossier={dossier} />
        <AiSummarySection
          summary={summary}
          loading={summaryLoading}
          error={summaryError}
          onGenerate={handleGenerateSummary}
        />
        <AbstractSection dossier={dossier} />
        <LegalStatusSection dossier={dossier} />
        <FamilySection dossier={dossier} />
        <ClaimsSection dossier={dossier} />
        <CitationsSection dossier={dossier} />
        <ClassificationSection dossier={dossier} />
        <SimilarSection dossier={dossier} />
        <ExportSection dossier={dossier} />

        <footer className="mt-10 pt-4 border-t-2 border-slate-800 text-center text-[10px] text-slate-500 leading-relaxed">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <img src="icons/icon128.png" alt="" className="h-4 w-4" />
            <span className="font-semibold text-slate-700">AI Patent Search Generator</span>
            <span>— Patent Dossier</span>
          </div>
          <div className="mb-1.5">
            Free Chrome extension ·{' '}
            <a
              href={`${CHROME_STORE_URL}?utm_source=patent_dossier_footer`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              chromewebstore.google.com/detail/lailglkmjkboieogmakjkcbihbldigno
            </a>
          </div>
          Data: Google Patents (worldwide) · Fetched {new Date(dossier.fetchedAt).toLocaleString()}
          <br />
          This dossier is generated for research purposes and does not constitute legal advice.
        </footer>
      </main>
    </div>
  );
};

export default PatentDossierPage;
