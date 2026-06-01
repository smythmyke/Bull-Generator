import React, { useState } from 'react';
import { Search, Loader2, Gavel } from 'lucide-react';
import { fetchCompanyLitigation, CompanyLitigation } from '../services/apiService';

function fmtDate(d?: string): string {
  if (!d) return '—';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

const CompanyLitigationTool: React.FC = () => {
  const [company, setCompany] = useState('');
  const [result, setResult] = useState<CompanyLitigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = company.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fetchCompanyLitigation(q));
    } catch (e) {
      setError((e as Error)?.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  const noExact = result && (result.caseCount ?? 0) === 0;

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Every district-court patent suit a company has been in, as plaintiff or defendant.
        USPTO public dataset — comprehensive 2003–2016, partial to 2020.
      </p>

      <div className="flex gap-1.5">
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder="Company name (e.g. Uniloc, Apple)"
          className="flex-1 text-xs px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={run}
          disabled={loading || !company.trim()}
          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-red-700 px-2.5 py-1.5 bg-red-50 border-l-[3px] border-red-500 rounded-r">{error}</div>
      )}

      {result && (
        <div className="space-y-2">
          {noExact ? (
            <div className="text-[11px] text-slate-600 px-2.5 py-2 bg-slate-50 border rounded-md">
              No exact match for <b>{result.query}</b> in the litigation dataset.
              {result.suggestions && result.suggestions.length > 0 && (
                <div className="mt-1.5">
                  <span className="text-slate-500">Did you mean:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {result.suggestions.slice(0, 8).map((s) => (
                      <button
                        key={s.name}
                        onClick={() => { setCompany(s.name); setTimeout(run, 0); }}
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-white hover:bg-blue-50 text-blue-700"
                      >
                        {s.name} ({s.caseCount})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800">
                  <Gavel className="h-3.5 w-3.5 text-blue-600" />
                  {result.matchedName || result.query}
                </span>
                <span className="text-[11px] text-slate-500">
                  {result.caseCount} suit{result.caseCount === 1 ? '' : 's'} · {result.asPlaintiffCount ?? 0} as plaintiff · {result.asDefendantCount ?? 0} as defendant
                </span>
              </div>

              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 border-b text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1.5">Role</th>
                      <th className="px-2 py-1.5">Case</th>
                      <th className="px-2 py-1.5">Court</th>
                      <th className="px-2 py-1.5">Filed</th>
                      <th className="px-2 py-1.5">Opposing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.cases || []).slice(0, 25).map((c, i) => (
                      <tr key={i} className="border-b last:border-b-0 align-top">
                        <td className="px-2 py-1.5 capitalize text-slate-600">{c.role || '—'}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-700 whitespace-nowrap">{c.caseNumber || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-600">{c.court || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmtDate(c.dateFiled)}</td>
                        <td className="px-2 py-1.5 text-slate-600">{(c.opposing || []).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(result.cases?.length || 0) > 25 && (
                <div className="text-[10px] text-slate-400">Showing 25 of {result.cases!.length} suits.</div>
              )}
              {result.related && result.related.length > 0 && (
                <div className="text-[10px] text-slate-500">
                  Related entities: {result.related.slice(0, 6).map((r) => `${r.name} (${r.caseCount})`).join(' · ')}
                </div>
              )}
            </>
          )}
          <div className="text-[10px] text-slate-400">Factual public-record reporting — not legal advice.</div>
        </div>
      )}
    </div>
  );
};

export default CompanyLitigationTool;
