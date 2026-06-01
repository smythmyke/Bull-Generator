import React from 'react';
import {
  ShieldCheck, ShieldAlert, CalendarClock, Scale, Gavel, FileSignature,
  Clock, UserCheck, Building2, FileText, Loader2, Sparkles,
} from 'lucide-react';
import type { LegalBundle } from '../services/apiService';

interface LegalIntelligenceSectionProps {
  bundle: LegalBundle | null;
  loading: boolean;
  error: string | null;
  onLoad: () => void;
  /** Section-number badge (dossier = 14). Pass null to hide it (standalone report). */
  num?: number | null;
}

// ── small presentational helpers ───────────────────────────────────────────
const Card: React.FC<{ title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div className="border border-slate-200 rounded-lg overflow-hidden break-inside-avoid">
    <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-blue-600" />
      <span className="font-semibold text-xs text-slate-800">{title}</span>
    </div>
    <div className="px-3 py-2.5 text-xs text-slate-700 leading-relaxed">{children}</div>
  </div>
);

const Unavailable: React.FC<{ msg?: string }> = ({ msg }) => (
  <span className="text-[11px] text-slate-400 italic">{msg || 'Not available for this patent.'}</span>
);

function fmtDate(d?: string): string {
  if (!d) return '—';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

// ── the section ─────────────────────────────────────────────────────────────
const LegalIntelligenceSection: React.FC<LegalIntelligenceSectionProps> = ({ bundle, loading, error, onLoad, num = 14 }) => {
  return (
    <section id="legal-intelligence" className="mb-8 scroll-mt-20">
      <h2 className="text-base font-bold text-slate-800 border-b-2 border-slate-800 pb-1.5 mb-2.5 flex items-center gap-2">
        {num !== null && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[10px]">{num}</span>}
        Legal Intelligence
      </h2>

      <p className="text-xs text-slate-600 mb-3 px-3 py-2 bg-slate-50 border-l-[3px] border-blue-600 rounded-r leading-relaxed">
        PTAB validity challenges, district-court litigation, chain of title, term/expiration, and prosecution detail —
        net-new USPTO public-record data beyond the Google Patents dossier above. One fetch loads it all.
      </p>

      {/* Idle: load CTA */}
      {!bundle && !loading && !error && (
        <div className="border border-dashed border-slate-300 rounded-lg px-4 py-6 text-center bg-slate-50/60">
          <p className="text-xs text-slate-600 mb-3">
            Load the full legal layer for this patent: validity challenges, litigation, ownership, term, and more.
          </p>
          <button
            onClick={onLoad}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Load legal intelligence
            <span className="ml-1 text-[10px] font-medium opacity-80">~10 credits</span>
          </button>
          <p className="text-[10px] text-slate-400 mt-2">Cached 24h — re-opening is free.</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500 italic px-3 py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Assembling legal intelligence from USPTO, PTAB &amp; court records…
        </div>
      )}

      {error && !loading && (
        <div className="border border-red-200 rounded-md p-3 bg-red-50">
          <div className="text-[11px] text-red-700 mb-2">{error}</div>
          <button
            onClick={onLoad}
            className="text-[11px] font-semibold px-2.5 py-1 rounded border border-red-300 bg-white text-red-700 hover:bg-red-50"
          >
            Try again
          </button>
        </div>
      )}

      {bundle && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Legal status & maintenance */}
          <Card title="Legal status &amp; maintenance" icon={bundle.legalStatus.inForce ? ShieldCheck : ShieldAlert}>
            {bundle.legalStatus.error ? <Unavailable msg={bundle.legalStatus.error} /> : (
              <>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                  bundle.legalStatus.inForce
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-slate-100 border-slate-200 text-slate-600'
                }`}>
                  {bundle.legalStatus.inForce ? 'In force' : (bundle.legalStatus.statusLabel || 'Not in force')}
                </span>
                {bundle.legalStatus.maintenanceEvents && bundle.legalStatus.maintenanceEvents.length > 0 ? (
                  <ul className="mt-2 space-y-0.5">
                    {bundle.legalStatus.maintenanceEvents.slice(0, 6).map((e, i) => (
                      <li key={i} className="text-[11px] text-slate-600">
                        <span className="font-mono text-slate-400">{fmtDate(e.date)}</span> · {e.description || e.code}
                      </li>
                    ))}
                  </ul>
                ) : <div className="mt-1.5 text-[11px] text-slate-400 italic">No maintenance events on record.</div>}
              </>
            )}
          </Card>

          {/* Term & expiration */}
          <Card title="Term &amp; expiration" icon={CalendarClock}>
            {bundle.term.error ? <Unavailable msg={bundle.term.error} /> : (
              <ul className="space-y-0.5">
                <li><span className="text-slate-500">Expires:</span> <b>{fmtDate(bundle.term.adjustedExpirationDate || bundle.term.expirationDate)}</b></li>
                <li><span className="text-slate-500">Granted:</span> {fmtDate(bundle.term.grantDate)}</li>
                {typeof bundle.term.patentTermAdjustmentDays === 'number' && (
                  <li><span className="text-slate-500">PTA:</span> {bundle.term.patentTermAdjustmentDays} days</li>
                )}
              </ul>
            )}
          </Card>

          {/* PTAB validity challenges */}
          <Card title="PTAB validity challenges" icon={Scale}>
            {bundle.challenges.error ? <Unavailable msg={bundle.challenges.error} /> : (
              (bundle.challenges.challengeCount ?? 0) === 0 ? (
                <span className="text-[11px] text-slate-500">No PTAB challenges on record — never attacked.</span>
              ) : (
                <>
                  <div className="text-sm font-bold text-slate-800">{bundle.challenges.challengeCount} challenge{bundle.challenges.challengeCount === 1 ? '' : 's'}</div>
                  <ul className="mt-1.5 space-y-1">
                    {(bundle.challenges.challenges || []).slice(0, 5).map((c, i) => (
                      <li key={i} className="text-[11px] text-slate-600 border-l-2 border-slate-200 pl-2">
                        <span className="font-mono">{c.trialNumber || c.type}</span> — {c.petitioner || 'petitioner'} <span className="text-slate-400">v.</span> {c.owner || 'owner'}
                        {(c.outcome || c.trialStatusCategory) && <span className="text-slate-500"> · {c.outcome || c.trialStatusCategory}</span>}
                      </li>
                    ))}
                  </ul>
                  {(bundle.challenges.challenges?.length || 0) > 5 && <div className="text-[10px] text-slate-400 mt-1">…and {(bundle.challenges.challenges!.length - 5)} more.</div>}
                </>
              )
            )}
          </Card>

          {/* District-court litigation */}
          <Card title="District-court litigation" icon={Gavel}>
            {bundle.litigation.error ? <Unavailable msg={bundle.litigation.error} /> : (
              (bundle.litigation.caseCount ?? 0) === 0 ? (
                <span className="text-[11px] text-slate-500">No infringement suits on record (USPTO dataset; comprehensive 2003–2016).</span>
              ) : (
                <>
                  <div className="text-sm font-bold text-slate-800">{bundle.litigation.caseCount} suit{bundle.litigation.caseCount === 1 ? '' : 's'}</div>
                  <ul className="mt-1.5 space-y-1">
                    {(bundle.litigation.cases || []).slice(0, 5).map((c, i) => (
                      <li key={i} className="text-[11px] text-slate-600 border-l-2 border-slate-200 pl-2">
                        <span className="font-mono">{c.caseNumber}</span> · {c.court} <span className="text-slate-400">{fmtDate(c.dateFiled)}</span>
                        {(c.plaintiffs?.length || c.defendants?.length) ? (
                          <div className="text-slate-500">{(c.plaintiffs || []).join(', ') || '—'} <span className="text-slate-400">v.</span> {(c.defendants || []).join(', ') || '—'}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {(bundle.litigation.cases?.length || 0) > 5 && <div className="text-[10px] text-slate-400 mt-1">…and {(bundle.litigation.cases!.length - 5)} more.</div>}
                </>
              )
            )}
          </Card>

          {/* Chain of title */}
          <Card title="Chain of title" icon={FileSignature}>
            {bundle.assignments.error ? <Unavailable msg={bundle.assignments.error} /> : (
              <>
                {bundle.assignments.currentAssignee && (
                  <div className="mb-1"><span className="text-slate-500">Current owner:</span> <b>{bundle.assignments.currentAssignee}</b></div>
                )}
                {bundle.assignments.assignments && bundle.assignments.assignments.length > 0 ? (
                  <ul className="space-y-1">
                    {bundle.assignments.assignments.slice(0, 4).map((a, i) => (
                      <li key={i} className="text-[11px] text-slate-600 border-l-2 border-slate-200 pl-2">
                        <span className="font-mono text-slate-400">{a.reelFrame}</span> · {fmtDate(a.recordedDate)} · {a.conveyanceText}
                      </li>
                    ))}
                  </ul>
                ) : <Unavailable msg="No recorded assignments." />}
              </>
            )}
          </Card>

          {/* Prosecution timeline */}
          <Card title="Prosecution timeline" icon={Clock}>
            {bundle.prosecutionTimeline.error ? <Unavailable msg={bundle.prosecutionTimeline.error} /> : (
              bundle.prosecutionTimeline.events && bundle.prosecutionTimeline.events.length > 0 ? (
                <details>
                  <summary className="text-[11px] text-blue-600 cursor-pointer select-none">{bundle.prosecutionTimeline.events.length} USPTO events</summary>
                  <ul className="mt-1.5 space-y-0.5 max-h-48 overflow-y-auto">
                    {bundle.prosecutionTimeline.events.map((e, i) => (
                      <li key={i} className="text-[11px] text-slate-600"><span className="font-mono text-slate-400">{fmtDate(e.date)}</span> · {e.description || e.code}</li>
                    ))}
                  </ul>
                </details>
              ) : <Unavailable msg="No prosecution events." />
            )}
          </Card>

          {/* Attorney / entity / pregrant — compact trio */}
          <Card title="Attorneys of record" icon={UserCheck}>
            {bundle.attorney.error ? <Unavailable msg={bundle.attorney.error} /> : (
              bundle.attorney.attorneys && bundle.attorney.attorneys.length > 0 ? (
                <>
                  {bundle.attorney.docketNumber && <div className="text-[11px] text-slate-500 mb-1">Docket: {bundle.attorney.docketNumber}</div>}
                  <ul className="space-y-0.5">
                    {bundle.attorney.attorneys.slice(0, 5).map((a, i) => (
                      <li key={i} className="text-[11px] text-slate-600">{a.name}{a.registrationNumber ? <span className="text-slate-400"> · Reg. {a.registrationNumber}</span> : null}</li>
                    ))}
                  </ul>
                </>
              ) : <Unavailable msg="No attorneys of record." />
            )}
          </Card>

          <Card title="Entity status &amp; pre-grant" icon={Building2}>
            <div className="space-y-1">
              <div>
                <span className="text-slate-500">Entity:</span>{' '}
                {bundle.entityStatus.error ? <Unavailable /> : <b>{bundle.entityStatus.category || (bundle.entityStatus.smallEntity ? 'Small' : 'Large')}</b>}
              </div>
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-slate-400" />
                <span className="text-slate-500">Pre-grant pub:</span>{' '}
                {bundle.pregrant.error ? <Unavailable /> : (bundle.pregrant.publicationNumber
                  ? <span className="font-mono text-[11px]">{bundle.pregrant.publicationNumber} ({fmtDate(bundle.pregrant.publicationDate)})</span>
                  : <Unavailable msg="None." />)}
              </div>
            </div>
          </Card>
        </div>
      )}

      {bundle && !loading && (
        <div className="mt-3 text-[10px] text-slate-400 leading-relaxed">
          Factual public-record reporting (USPTO / PTAB / district-court dockets) — not legal advice.
          {' '}Generated {new Date(bundle.generatedAt).toLocaleString()}{bundle.cached ? ' · cached' : ''}.
        </div>
      )}
    </section>
  );
};

export default LegalIntelligenceSection;
