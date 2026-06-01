import React, { useState } from 'react';
import { Loader2, ShieldAlert, Search, ExternalLink } from 'lucide-react';
import { fetchRiskProfile, RiskProfile } from '../services/apiService';

const LABEL_STYLES: Record<string, string> = {
  High: 'bg-red-50 border-red-300 text-red-700',
  Moderate: 'bg-amber-50 border-amber-300 text-amber-700',
  Low: 'bg-green-50 border-green-300 text-green-700',
};

function fmtDate(d?: string): string {
  if (!d) return '—';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

const RiskProfilePanel: React.FC = () => {
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const pn = input.trim();
    if (!pn || loading) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      setProfile(await fetchRiskProfile(pn));
    } catch (e) {
      setError((e as Error)?.message || 'Risk profile failed');
    } finally {
      setLoading(false);
    }
  };

  const v = profile?.verdict;
  const s = v?.signals;

  return (
    <div className="space-y-2.5 px-3 py-2.5 border-t bg-muted/10">
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder="Patent number (e.g. US8724622B2)"
          className="flex-1 text-xs px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={run}
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Run
          <span className="ml-0.5 text-[9px] font-medium opacity-80">~40cr</span>
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500 italic py-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          Assembling legal data &amp; computing risk verdict…
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-700 px-2.5 py-1.5 bg-red-50 border-l-[3px] border-red-500 rounded-r">{error}</div>
      )}

      {profile && v && s && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-blue-600">{profile.patentNumber}</span>
            <span className={`ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-bold ${LABEL_STYLES[v.riskLabel] || 'bg-slate-100 border-slate-300 text-slate-600'}`}>
              <ShieldAlert className="h-3.5 w-3.5" />
              {v.riskLabel} risk
            </span>
          </div>

          <p className="text-[11px] text-slate-700 leading-relaxed px-2.5 py-2 bg-white border rounded-md">{v.rationale}</p>

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="px-2 py-1 bg-white border rounded">In force: <b>{s.inForce === null ? '—' : s.inForce ? 'Yes' : 'No'}</b></div>
            <div className="px-2 py-1 bg-white border rounded">Expires: <b>{fmtDate(s.expirationDate)}</b></div>
            <div className="px-2 py-1 bg-white border rounded">PTAB challenges: <b>{s.challengeCount}</b></div>
            <div className="px-2 py-1 bg-white border rounded">Suits: <b>{s.litigationCount}</b></div>
            <div className="col-span-2 px-2 py-1 bg-white border rounded truncate">Owner: <b>{s.currentAssignee || '—'}</b></div>
          </div>

          <button
            onClick={() => {
              const url = chrome.runtime.getURL(`patent.html?number=${encodeURIComponent(profile.patentNumber)}#legal-intelligence`);
              chrome.tabs.create({ url });
            }}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View full legal intelligence
          </button>

          <div className="text-[10px] text-slate-400">{profile.disclaimer}{profile.cached ? ' · cached' : ''}</div>
        </div>
      )}
    </div>
  );
};

export default RiskProfilePanel;
