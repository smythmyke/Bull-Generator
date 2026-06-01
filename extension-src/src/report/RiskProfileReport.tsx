import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Loader2, Search, ExternalLink } from 'lucide-react';
import { fetchRiskProfile, RiskProfile } from '../services/apiService';
import LegalIntelligenceSection from '../patent/LegalIntelligenceSection';

const LABEL_STYLES: Record<string, string> = {
  High: 'bg-red-50 border-red-300 text-red-700',
  Moderate: 'bg-amber-50 border-amber-300 text-amber-700',
  Low: 'bg-green-50 border-green-300 text-green-700',
};

function fmtDate(d?: string): string {
  if (!d) return '—';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

const RiskProfileReport: React.FC<{ initialNumber?: string }> = ({ initialNumber = '' }) => {
  const [input, setInput] = useState(initialNumber);
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (pn: string) => {
    const num = pn.trim();
    if (!num) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      setProfile(await fetchRiskProfile(num));
    } catch (e) {
      setError((e as Error)?.message || 'Risk profile failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialNumber) run(initialNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = profile?.verdict;
  const s = v?.signals;

  return (
    <>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        A one-shot risk verdict for any US patent — is it in force, battle-tested (survived PTAB),
        heavily litigated, and when does it expire? Assembled from USPTO public-record data.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(input); }}
          placeholder="Patent number (e.g. US8724622B2)"
          className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => run(input)}
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Run
          <span className="ml-0.5 text-[10px] font-medium opacity-80">~40 credits</span>
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 italic py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
          Assembling legal data &amp; computing risk verdict…
        </div>
      )}

      {error && !loading && (
        <div className="border border-red-200 rounded-lg p-4 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {!profile && !loading && !error && (
        <div className="text-center text-sm text-slate-500 py-20 border border-dashed border-slate-300 rounded-xl bg-white/60">
          Enter a US patent number and click <b>Run</b> to generate the risk profile.
        </div>
      )}

      {profile && v && s && !loading && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-sm text-blue-600">{profile.patentNumber}</span>
              <span className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-bold ${LABEL_STYLES[v.riskLabel] || 'bg-slate-100 border-slate-300 text-slate-600'}`}>
                <ShieldAlert className="h-4 w-4" />
                {v.riskLabel} risk
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{v.rationale}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4 text-sm">
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded">In force: <b>{s.inForce === null ? '—' : s.inForce ? 'Yes' : 'No'}</b></div>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded">Expires: <b>{fmtDate(s.expirationDate)}</b></div>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded">PTAB challenges: <b>{s.challengeCount}</b></div>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded">District-court suits: <b>{s.litigationCount}</b></div>
              <div className="md:col-span-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded truncate">Current owner: <b>{s.currentAssignee || '—'}</b></div>
            </div>
            <div className="mt-4">
              <button
                onClick={() => {
                  const url = chrome.runtime.getURL(`patent.html?number=${encodeURIComponent(profile.patentNumber)}`);
                  chrome.tabs.create({ url });
                }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View full patent dossier
              </button>
            </div>
          </div>

          <LegalIntelligenceSection bundle={profile.legal} loading={false} error={null} onLoad={() => {}} num={null} />

          <p className="text-[11px] text-slate-400 mt-4">
            {profile.disclaimer}{profile.cached ? ' · cached' : ''}
          </p>
        </>
      )}
    </>
  );
};

export default RiskProfileReport;
