import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { rankPatents, RankedPatent, PatentForRanking, Snippet } from '../services/apiService';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import PriorArtAnalysis from './PriorArtAnalysis';

interface DeepPatentResult {
  title: string;
  patentId: string;
  patentNumber: string;
  inventor: string;
  assignee: string;
  dates: string;
  abstract: string;
  countries: string[];
  pdfUrl: string;
  fullAbstract: string;
  cpcCodes: string[];
  firstClaim: string;
  foundBy?: string[];
  // NPL-specific fields
  citationCount?: number;
  venue?: string;
  doi?: string;
  fieldsOfStudy?: string[];
  enrichedVia?: string;
}

interface RelaxationStep {
  action: string;
  detail: string;
  query: string;
  resultCount: number;
}

interface SearchLogEntry {
  round: number;
  label: string;
  query: string;
  resultCount: number;
  relaxationSteps?: RelaxationStep[];
  durationMs?: number;
}

interface SearchMeta {
  rawTextCount: number;
  booleanCount: number;
  aiOptimizedCount: number;
  uniqueCount: number;
  aiQuery: string;
  // Pro search fields (optional, backward-compatible)
  mode?: 'quick' | 'pro-auto' | 'pro-interactive';
  round1Count?: number;
  round2Count?: number;
  round3Count?: number;
  similarityCount?: number;
  rounds?: { round: number; query: string; count: number }[];
  searchLog?: SearchLogEntry[];
  totalDurationMs?: number;
}

interface StoredResults {
  query: string;
  patents: DeepPatentResult[];
  totalAvailable: number;
  page: number;
  concepts?: { name: string; synonyms: string[] }[];
  searchMeta?: SearchMeta;
}

type RankedDisplayPatent = DeepPatentResult & {
  rank: number;
  score: number;
  reasoning: string;
  snippets: Snippet[];
  foundBy: string[];
};

type SortOption = 'ai-score' | 'date-newest' | 'date-oldest' | 'multi-source';
type Status = 'loading' | 'ranking' | 'ready' | 'error';

const PAGE_SIZE = 10;

const FOUND_BY_BADGES: Record<string, { color: string; label: string }> = {
  'raw-text': { color: 'bg-blue-50 text-blue-700 border-blue-200', label: 'raw text' },
  'boolean': { color: 'bg-purple-50 text-purple-700 border-purple-200', label: 'boolean' },
  'ai-optimized': { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'AI-optimized' },
  'round1-raw': { color: 'bg-blue-50 text-blue-700 border-blue-200', label: 'R1 raw' },
  'round1-boolean': { color: 'bg-purple-50 text-purple-700 border-purple-200', label: 'R1 boolean' },
  'round1-ai': { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'R1 AI' },
  'round2-refined': { color: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Round 2' },
  'round3-narrow': { color: 'bg-red-50 text-red-700 border-red-200', label: 'Round 3' },
};

function getFoundByBadge(source: string): { color: string; label: string } | null {
  if (FOUND_BY_BADGES[source]) return FOUND_BY_BADGES[source];
  if (source.startsWith('similar-')) {
    const patentId = source.replace('similar-', '');
    const shortId = patentId.length > 12 ? patentId.substring(0, 12) + '...' : patentId;
    return { color: 'bg-cyan-50 text-cyan-700 border-cyan-200', label: `similar:${shortId}` };
  }
  return null;
}

const ResultsPage: React.FC = () => {
  const { isAuthenticated, loading: authLoading } = useAuthContext();
  const [status, setStatus] = useState<Status>('loading');
  const [statusMessage, setStatusMessage] = useState('Loading patent data...');
  const [query, setQuery] = useState('');
  const [allRankedPatents, setAllRankedPatents] = useState<RankedDisplayPatent[]>([]);
  const [displayPage, setDisplayPage] = useState(1);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [error, setError] = useState('');
  const [expandedPatent, setExpandedPatent] = useState<string | null>(null);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('ai-score');
  const [concepts, setConcepts] = useState<{ name: string; synonyms: string[] }[] | undefined>(undefined);

  // Parse a priority date from the dates string (e.g., "Priority 2016-10-21 • Filed 2025-01-17...")
  const parsePriorityDate = (dates: string): Date | null => {
    const match = dates.match(/Priority\s+(\d{4}-\d{2}-\d{2})/);
    if (match) return new Date(match[1]);
    const filedMatch = dates.match(/Filed\s+(\d{4}-\d{2}-\d{2})/);
    if (filedMatch) return new Date(filedMatch[1]);
    return null;
  };

  // Sort patents based on selected sort option
  const sortedPatents = useMemo(() => {
    const sorted = [...allRankedPatents];
    switch (sortBy) {
      case 'ai-score':
        sorted.sort((a, b) => b.score - a.score);
        break;
      case 'date-newest':
        sorted.sort((a, b) => {
          const da = parsePriorityDate(a.dates);
          const db = parsePriorityDate(b.dates);
          if (!da && !db) return b.score - a.score;
          if (!da) return 1;
          if (!db) return -1;
          return db.getTime() - da.getTime();
        });
        break;
      case 'date-oldest':
        sorted.sort((a, b) => {
          const da = parsePriorityDate(a.dates);
          const db = parsePriorityDate(b.dates);
          if (!da && !db) return b.score - a.score;
          if (!da) return 1;
          if (!db) return -1;
          return da.getTime() - db.getTime();
        });
        break;
      case 'multi-source':
        sorted.sort((a, b) => {
          const diff = (b.foundBy?.length || 0) - (a.foundBy?.length || 0);
          if (diff !== 0) return diff;
          return b.score - a.score;
        });
        break;
    }
    // Re-number ranks based on current sort
    sorted.forEach((p, i) => { p.rank = i + 1; });
    return sorted;
  }, [allRankedPatents, sortBy]);

  // Get current page of patents
  const displayedPatents = useMemo(() => {
    const start = (displayPage - 1) * PAGE_SIZE;
    return sortedPatents.slice(start, start + PAGE_SIZE);
  }, [sortedPatents, displayPage]);

  const totalPages = Math.ceil(sortedPatents.length / PAGE_SIZE);

  const processResults = useCallback(async (data: StoredResults) => {
    setQuery(data.query);
    setTotalAvailable(data.totalAvailable);
    if (data.searchMeta) setSearchMeta(data.searchMeta);
    if (data.concepts) setConcepts(data.concepts);

    if (data.patents.length === 0) {
      setStatus('error');
      setError('No patents found to rank.');
      return;
    }

    setStatus('ranking');
    setStatusMessage(`Ranking ${data.patents.length} patents with AI...`);

    try {
      const patentsForRanking = data.patents.map(p => ({
        patentId: p.patentId,
        patentNumber: p.patentNumber,
        title: p.title,
        assignee: p.assignee,
        abstract: p.abstract,
        fullAbstract: p.fullAbstract,
        cpcCodes: p.cpcCodes,
        firstClaim: p.firstClaim,
        foundBy: p.foundBy,
        // NPL fields (passed through to rank prompt)
        ...(p.citationCount !== undefined ? { citationCount: p.citationCount } : {}),
        ...(p.venue ? { venue: p.venue } : {}),
      })) as PatentForRanking[];

      const rankResponse = await rankPatents(data.query, patentsForRanking);

      // Merge rank data with full patent data, filter out low-relevance (score < 60)
      const merged: RankedDisplayPatent[] = rankResponse.ranked
        .map(ranked => {
          const patent = data.patents.find(p => p.patentId === ranked.patentId);
          if (!patent) return null;
          return {
            ...patent,
            rank: ranked.rank,
            score: ranked.score,
            reasoning: ranked.reasoning,
            snippets: ranked.snippets || [],
            foundBy: patent.foundBy || [],
          };
        })
        .filter((p): p is RankedDisplayPatent => p !== null)
        .filter(p => p.score >= 60); // Only show green (80+) and yellow (60+)

      // Re-number ranks sequentially
      merged.forEach((p, i) => { p.rank = i + 1; });

      setAllRankedPatents(merged);
      setDisplayPage(1);
      setStatus('ready');
    } catch (err) {
      console.error('Ranking error:', err);
      setError(err instanceof Error ? err.message : 'Failed to rank patents');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setStatus('error');
      setError('Please log in to view results.');
      return;
    }

    chrome.storage.local.get('patentResults', (data) => {
      if (data.patentResults) {
        processResults(data.patentResults as StoredResults);
      } else {
        setStatus('error');
        setError('No patent data found. Run a search from the side panel first.');
      }
    });
  }, [authLoading, isAuthenticated, processResults]);

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    if (score >= 40) return 'text-orange-600 bg-orange-50 border-orange-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getScoreBadgeColor = (score: number): string => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  if (status === 'loading' || status === 'ranking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-lg font-medium">{statusMessage}</p>
          {status === 'ranking' && (
            <p className="text-sm text-muted-foreground">
              Gemini AI is analyzing patent relevance and extracting evidence...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-4xl">&#9888;</div>
          <p className="text-lg font-medium text-destructive">{error}</p>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background border-b">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Patent Search Results</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Query: <span className="font-medium text-foreground">{query}</span>
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div>{allRankedPatents.length} ranked patents</div>
              <div>Page {displayPage} of {totalPages}</div>
            </div>
          </div>

          {/* Search meta + sort controls */}
          <div className="flex items-center justify-between mt-3">
            {searchMeta && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {searchMeta.mode && searchMeta.mode !== 'quick' ? (
                  <>
                    <span className="px-2 py-0.5 bg-gradient-to-r from-blue-50 to-purple-50 text-purple-700 rounded border border-purple-200 font-semibold">
                      {searchMeta.mode === 'pro-auto' ? 'Pro Auto' : 'Pro Interactive'}
                    </span>
                    {searchMeta.round1Count !== undefined && (
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                        R1: {searchMeta.round1Count}
                      </span>
                    )}
                    {searchMeta.similarityCount !== undefined && searchMeta.similarityCount > 0 && (
                      <span className="px-2 py-0.5 bg-cyan-50 text-cyan-700 rounded border border-cyan-200">
                        Similar: {searchMeta.similarityCount}
                      </span>
                    )}
                    {searchMeta.round2Count !== undefined && (
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200">
                        R2: {searchMeta.round2Count}
                      </span>
                    )}
                    {searchMeta.round3Count !== undefined && searchMeta.round3Count > 0 && (
                      <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded border border-red-200">
                        R3: {searchMeta.round3Count}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                      Raw: {searchMeta.rawTextCount}
                    </span>
                    <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded border border-purple-200">
                      Boolean: {searchMeta.booleanCount}
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                      AI: {searchMeta.aiOptimizedCount}
                    </span>
                  </>
                )}
                <span className="font-medium text-foreground">
                  {searchMeta.uniqueCount} unique
                </span>
              </div>
            )}

            {/* Sort dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value as SortOption); setDisplayPage(1); }}
                className="text-xs border rounded px-2 py-1 bg-background"
              >
                <option value="ai-score">AI Relevance Score</option>
                <option value="date-newest">Priority Date (Newest)</option>
                <option value="date-oldest">Priority Date (Oldest)</option>
                <option value="multi-source">Multi-Source Match</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="max-w-5xl mx-auto px-6 pt-3">
        <Tabs defaultValue="results">
          <TabsList className="w-full justify-start gap-1">
            <TabsTrigger value="results" className="text-sm font-bold px-4 py-2">
              Results ({allRankedPatents.length})
            </TabsTrigger>
            <TabsTrigger value="prior-art" className="text-sm font-bold px-4 py-2">
              Examiner's Report
            </TabsTrigger>
            {searchMeta?.searchLog && searchMeta.searchLog.length > 0 && (
              <TabsTrigger value="search-report" className="text-sm font-bold px-4 py-2">
                Search Report
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="results">

      {/* Results */}
      <main className="max-w-5xl mx-auto px-6 py-6">
        <div className="space-y-4">
          {displayedPatents.map((patent) => (
            <div
              key={patent.patentId}
              className={`border rounded-lg overflow-hidden transition-shadow hover:shadow-md ${
                expandedPatent === patent.patentId ? 'ring-2 ring-primary/20' : ''
              }`}
            >
              {/* Patent Header */}
              <div
                className="p-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => setExpandedPatent(
                  expandedPatent === patent.patentId ? null : patent.patentId
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Rank & Score */}
                  <div className="flex flex-col items-center shrink-0 w-14">
                    <span className="text-2xl font-bold text-muted-foreground">
                      #{patent.rank}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${getScoreBadgeColor(patent.score)}`}>
                      {patent.score}
                    </span>
                  </div>

                  {/* Patent Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold leading-tight">
                        {patent.title || 'Untitled Patent'}
                      </h2>
                      {patent.countries?.includes('NPL') && (
                        <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded border border-indigo-200 font-medium shrink-0">
                          NPL
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                      {!patent.countries?.includes('NPL') && (
                        <span className="font-medium text-foreground">{patent.patentNumber}</span>
                      )}
                      {patent.venue && (
                        <span className="italic">{patent.venue}</span>
                      )}
                      {patent.assignee && <span>{patent.assignee}</span>}
                      {patent.inventor && <span>by {patent.inventor}</span>}
                      {patent.dates && <span>{patent.dates}</span>}
                      {patent.doi && (
                        <a
                          href={`https://doi.org/${patent.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          DOI
                        </a>
                      )}
                    </div>

                    {/* Citation count + found-by badges */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {patent.citationCount !== undefined && patent.citationCount > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                          patent.citationCount >= 200
                            ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                            : patent.citationCount >= 50
                              ? 'bg-orange-50 text-orange-700 border-orange-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {patent.citationCount >= 1000
                            ? `${(patent.citationCount / 1000).toFixed(1)}k`
                            : patent.citationCount
                          } citations
                        </span>
                      )}
                      {patent.fieldsOfStudy && patent.fieldsOfStudy.length > 0 && (
                        patent.fieldsOfStudy.slice(0, 3).map((field, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded border border-violet-200">
                            {field}
                          </span>
                        ))
                      )}
                      {patent.foundBy?.map((source, i) => {
                        const badge = getFoundByBadge(source);
                        if (!badge) return null;
                        return (
                          <span key={i} className={`text-xs px-1.5 py-0.5 rounded border ${badge.color}`}>
                            {badge.label}
                          </span>
                        );
                      })}
                      {patent.foundBy && patent.foundBy.length >= 2 && (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200 font-medium">
                          {patent.foundBy.length}x match
                        </span>
                      )}
                    </div>

                    {/* AI reasoning */}
                    <p className={`text-sm mt-2 ${getScoreColor(patent.score)} px-2 py-1 rounded border inline-block`}>
                      {patent.reasoning}
                    </p>

                    {/* Evidence snippets */}
                    {patent.snippets && patent.snippets.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {patent.snippets.map((snippet, i) => (
                          <div key={i} className="flex gap-2 items-start">
                            <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200 shrink-0 mt-0.5 font-mono">
                              {snippet.source}
                            </span>
                            <div className="text-xs">
                              <span className="italic text-foreground">"{snippet.quote}"</span>
                              <span className="text-muted-foreground ml-1">— {snippet.relevance}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {patent.countries?.includes('NPL') ? (
                      <>
                        {patent.pdfUrl && (
                          <a
                            href={patent.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View Source
                          </a>
                        )}
                        {patent.doi && (
                          <a
                            href={`https://doi.org/${patent.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-medium border rounded hover:bg-secondary text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            DOI
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <a
                          href={`https://patents.google.com/patent/${patent.patentId}/en`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View Patent
                        </a>
                        {patent.pdfUrl && (
                          <a
                            href={patent.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-medium border rounded hover:bg-secondary text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            PDF
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* CPC Codes */}
                {patent.cpcCodes?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 ml-[4.5rem]">
                    {patent.cpcCodes.slice(0, 8).map((code, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 bg-secondary rounded font-mono">
                        {code}
                      </span>
                    ))}
                    {patent.cpcCodes.length > 8 && (
                      <span className="text-xs text-muted-foreground">
                        +{patent.cpcCodes.length - 8} more
                      </span>
                    )}
                  </div>
                )}

                {/* Countries */}
                {patent.countries?.length > 0 && (
                  <div className="flex gap-1 mt-1 ml-[4.5rem]">
                    {patent.countries.map((cc, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                        {cc}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Expanded Details */}
              {expandedPatent === patent.patentId && (
                <div className="border-t px-4 py-4 bg-secondary/10">
                  <div className="ml-[4.5rem] space-y-3">
                    {(patent.fullAbstract || patent.abstract) && (
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Abstract</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {patent.fullAbstract || patent.abstract}
                        </p>
                      </div>
                    )}
                    {patent.firstClaim && (
                      <div>
                        <h3 className="text-sm font-semibold mb-1">First Claim</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {patent.firstClaim}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={() => setDisplayPage(p => Math.max(1, p - 1))}
            disabled={displayPage <= 1}
            className="px-4 py-2 border rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium"
          >
            Previous 10
          </button>
          <span className="text-sm text-muted-foreground">
            {(displayPage - 1) * PAGE_SIZE + 1}–{Math.min(displayPage * PAGE_SIZE, sortedPatents.length)} of {sortedPatents.length}
          </span>
          <button
            onClick={() => setDisplayPage(p => Math.min(totalPages, p + 1))}
            disabled={displayPage >= totalPages}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium"
          >
            Next 10
          </button>
        </div>
      </main>

          </TabsContent>

          <TabsContent value="prior-art">
            <PriorArtAnalysis
              query={query}
              concepts={concepts}
              patents={allRankedPatents}
            />
          </TabsContent>

          {searchMeta?.searchLog && searchMeta.searchLog.length > 0 && (
            <TabsContent value="search-report">
              <div className="pt-4">
                <div className="border rounded-lg bg-slate-50/50 overflow-hidden">
                  <div className="px-4 py-3 border-b bg-slate-100/80">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-slate-800">Search Report</h2>
                      {searchMeta.totalDurationMs && (
                        <span className="text-xs text-slate-500">
                          Total: {(searchMeta.totalDurationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {searchMeta.mode === 'pro-auto' ? 'Pro Auto' : searchMeta.mode === 'pro-interactive' ? 'Pro Interactive' : 'Quick'} search
                      {' \u2014 '}{searchMeta.searchLog.length} queries executed
                      {' \u2014 '}{searchMeta.uniqueCount} unique results
                    </p>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {(() => {
                      const rounds = new Set(searchMeta.searchLog.map(e => e.round));
                      return Array.from(rounds).sort().map(roundNum => {
                        const entries = searchMeta.searchLog!.filter(e => e.round === roundNum);
                        const roundTotal = entries.reduce((sum, e) => sum + e.resultCount, 0);
                        return (
                          <div key={roundNum} className="px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                roundNum === 1 ? 'bg-blue-100 text-blue-700' :
                                roundNum === 2 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                Round {roundNum}
                              </span>
                              <span className="text-xs text-slate-500">
                                {entries.length} queries, {roundTotal} total results
                              </span>
                            </div>

                            <div className="space-y-2">
                              {entries.map((entry, idx) => (
                                <div key={idx} className="pl-3 border-l-2 border-slate-200">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-slate-700">{entry.label}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                                      entry.resultCount > 0
                                        ? 'bg-green-50 text-green-700 border border-green-200'
                                        : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}>
                                      {entry.resultCount} results
                                    </span>
                                    {entry.durationMs && (
                                      <span className="text-xs text-slate-400">
                                        {(entry.durationMs / 1000).toFixed(1)}s
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-500 mt-0.5 font-mono break-all leading-relaxed">
                                    {entry.query}
                                  </p>
                                  {entry.relaxationSteps && entry.relaxationSteps.length > 1 && (
                                    <div className="mt-1 ml-2 space-y-0.5">
                                      {entry.relaxationSteps.map((step, si) => (
                                        <div key={si} className="flex items-center gap-1.5 text-xs">
                                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            step.resultCount > 0 ? 'bg-green-400' :
                                            step.action === 'original' ? 'bg-slate-300' : 'bg-amber-400'
                                          }`} />
                                          <span className="text-slate-500">{step.detail}</span>
                                          <span className={step.resultCount > 0 ? 'text-green-600 font-medium' : 'text-slate-400'}>
                                            {step.resultCount > 0 ? `${step.resultCount} found` : '0'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Source attribution summary */}
                  <div className="px-4 py-3 border-t bg-slate-100/50">
                    <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Source Attribution</h3>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const sourceCounts: Record<string, number> = {};
                        for (const patent of allRankedPatents) {
                          for (const source of (patent.foundBy || [])) {
                            sourceCounts[source] = (sourceCounts[source] || 0) + 1;
                          }
                        }
                        return Object.entries(sourceCounts)
                          .sort(([, a], [, b]) => b - a)
                          .map(([source, count]) => {
                            const badge = getFoundByBadge(source);
                            return badge ? (
                              <span key={source} className={`text-xs px-1.5 py-0.5 rounded border ${badge.color}`}>
                                {badge.label}: {count}
                              </span>
                            ) : null;
                          });
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          )}

        </Tabs>
      </div>
    </div>
  );
};

export default ResultsPage;
