import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Search, Gavel } from 'lucide-react';
import { fetchCompanyLitigation, CompanyLitigation } from '../services/apiService';

function fmtDate(d?: string): string {
  if (!d) return '—';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

const CompanyLitigationReport: React.FC<{ initialCompany?: string }> = ({ initialCompany = '' }) => {
  const [input, setInput] = useState(initialCompany);
  const [result, setResult] = useState<CompanyLitigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (q: string) => {
    const company = q.trim();
    if (!company) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fetchCompanyLitigation(company));
    } catch (e) {
      setError((e as Error)?.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialCompany) run(initialCompany);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noExact = result && (result.caseCount ?? 0) === 0;

  return (
    <>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        Every district-court patent suit a company has been in, as plaintiff or defendant.
        USPTO public dataset — comprehensive 2003–2016, partial to 2020. Not legal advice.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(input); }}
          placeholder="Company name (e.g. Uniloc, Apple)"
          className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => run(input)}
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 italic py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
          Searching the litigation dataset…
        </div>
      )}

      {error && !loading && (
        <div className="border border-red-200 rounded-lg p-4 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {!result && !loading && !error && (
        <div className="text-center text-sm text-slate-500 py-20 border border-dashed border-slate-300 rounded-xl bg-white/60">
          Enter a company name and click <b>Search</b> to see its full litigation footprint.
        </div>
      )}

      {result && !loading && noExact && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-600">
            No exact match for <b>{result.query}</b> in the litigation dataset.
          </p>
          {result.suggestions && result.suggestions.length > 0 && (
            <div className="mt-3">
              <span className="text-sm text-slate-500">Did you mean:</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {result.suggestions.slice(0, 12).map((s) => (
                  <button
                    key={s.name}
                    onClick={() => { setInput(s.name); run(s.name); }}
                    className="text-xs px-2 py-1 rounded border bg-white hover:bg-blue-50 text-blue-700"
                  >
                    {s.name} ({s.caseCount})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result && !loading && !noExact && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Gavel className="h-5 w-5 text-blue-600" />
              <span className="text-lg font-bold text-slate-800">{result.matchedName || result.query}</span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-600 mt-2">
              <span><b className="text-slate-800 text-base">{result.caseCount}</b> total suits</span>
              <span><b className="text-slate-800">{result.asPlaintiffCount ?? 0}</b> as plaintiff</span>
              <span><b className="text-slate-800">{result.asDefendantCount ?? 0}</b> as defendant</span>
            </div>
            {result.related && result.related.length > 0 && (
              <div className="text-xs text-slate-500 mt-3">
                Related entities: {result.related.slice(0, 8).map((r) => `${r.name} (${r.caseCount})`).join(' · ')}
              </div>
            )}
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Case</th>
                  <th className="px-3 py-2">Court</th>
                  <th className="px-3 py-2">Filed</th>
                  <th className="px-3 py-2">Opposing party</th>
                  <th className="px-3 py-2">Patents</th>
                </tr>
              </thead>
              <tbody>
                {(result.cases || []).slice(0, 100).map((c, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-b-0 align-top">
                    <td className="px-3 py-2 capitalize text-slate-600 whitespace-nowrap">{c.role || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">{c.caseNumber || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{c.court || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(c.dateFiled)}</td>
                    <td className="px-3 py-2 text-slate-600">{(c.opposing || []).join(', ') || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{(c.patents || []).slice(0, 4).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(result.cases?.length || 0) > 100 && (
            <div className="text-xs text-slate-400">Showing 100 of {result.cases!.length} suits.</div>
          )}
          <p className="text-[11px] text-slate-400">Factual public-record reporting — not legal advice.</p>
        </div>
      )}
    </>
  );
};

export default CompanyLitigationReport;
