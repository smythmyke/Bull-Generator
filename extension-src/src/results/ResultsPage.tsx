import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { rankPatents, RankedPatent, PatentForRanking, Snippet } from '../services/apiService';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import PriorArtAnalysis, { PriorArtReportState, INITIAL_REPORT_STATE } from './PriorArtAnalysis';
import FullReportTab from './FullReportTab';
import { extractQueryTerms, computeHybridScore, ScoreBreakdown, QueryTerms } from '../utils/scoringUtils';
import { GenerateReportSectionsResponse } from '../services/apiService';
import HighlightedText from '../components/HighlightedText';
import ScoreTooltip from '../components/ScoreTooltip';
import { exportSearchReportPDF, exportSearchReportDOCX, SearchReportData } from '../utils/exportReport';

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
  // BigQuery enrichment fields (optional)
  independentClaims?: { claimNumber: number; text: string }[];
  totalClaimCount?: number;
  descriptionSnippet?: string;
  backwardCitationCount?: number;
  backwardCitations?: { citedPublicationNumber: string; citationType: string }[];
  cpcDetails?: { code: string; inventive: boolean; first: boolean }[];
  familyId?: string;
  entityStatus?: string;
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
  // Strategy fields (optional, backward-compatible)
  strategy?: 'telescoping' | 'onion-ring' | 'faceted';
  depth?: 'quick' | 'pro-auto' | 'pro-interactive';
  mergeCount?: number;
  layersStopped?: number;
  pairCount?: number;
  frequencyDistribution?: Record<number, number>;
}

interface StoredResults {
  query: string;
  patents: DeepPatentResult[];
  totalAvailable: number;
  page: number;
  concepts?: { name: string; synonyms: string[]; importance?: string; category?: string }[];
  searchMeta?: SearchMeta;
}

type RankedDisplayPatent = DeepPatentResult & {
  rank: number;
  score: number;
  semanticScore: number;
  scoreBreakdown: ScoreBreakdown;
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

const RANKING_TIPS: { category: string; icon: string; text: string }[] = [
  { category: 'Patent Law', icon: '\u2696\uFE0F', text: '35 USC 101 defines patentable subject matter: processes, machines, manufactures, and compositions of matter.' },
  { category: 'Patent Law', icon: '\u2696\uFE0F', text: '35 USC 102 (Novelty): Your invention must be new \u2014 not previously disclosed in any public document worldwide.' },
  { category: 'Patent Law', icon: '\u2696\uFE0F', text: '35 USC 103 (Non-obviousness): Your invention can\'t be an obvious combination of existing prior art.' },
  { category: 'Patent Law', icon: '\u2696\uFE0F', text: '35 USC 112 requires a written description enabling someone skilled in the art to make and use the invention.' },
  { category: 'Patent Law', icon: '\u2696\uFE0F', text: 'Provisional patent applications give you 12 months of "patent pending" status before filing a full application.' },
  { category: 'Patent Law', icon: '\u2696\uFE0F', text: 'The America Invents Act (2011) changed the US from "first to invent" to "first inventor to file."' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'The first US patent was granted in 1790 to Samuel Hopkins for a process of making potash.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'Amazon holds a patent on one-click purchasing (US5960411), granted in 1999.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'The average US patent takes 23.3 months from filing to grant.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'Thomas Edison held 1,093 US patents \u2014 the most by any individual inventor until 2003.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'Design patents last 15 years from grant; utility patents last 20 years from the earliest filing date.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'China surpassed the US in patent filings in 2011 and now files over 2x as many annually.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'The word "patent" comes from the Latin "patere" meaning "to lay open" \u2014 patents disclose inventions publicly.' },
  { category: 'Did You Know?', icon: '\uD83D\uDCA1', text: 'Patent trolls (NPEs) account for over 60% of all patent lawsuits in the United States.' },
  { category: 'Search Tip', icon: '\uD83D\uDD0D', text: 'Check the claims section of results \u2014 that\'s where the legal scope of protection is defined.' },
  { category: 'Search Tip', icon: '\uD83D\uDD0D', text: 'CPC codes help narrow results to your technology domain. Look at top results\' CPCs for ideas.' },
  { category: 'Search Tip', icon: '\uD83D\uDD0D', text: 'Patents use formal language: "apparatus" not "device", "comprising" not "having", "plurality" not "multiple".' },
  { category: 'Search Tip', icon: '\uD83D\uDD0D', text: 'Backward citations reveal prior art the examiner considered. Forward citations show who built on the patent.' },
  { category: 'Search Tip', icon: '\uD83D\uDD0D', text: 'Try shuffling your boolean queries and re-running \u2014 different synonym combinations catch different patents.' },
  { category: 'Industry', icon: '\uD83C\uDFEB', text: 'Patent examiners at the USPTO review an average of 87 applications per year.' },
  { category: 'Industry', icon: '\uD83C\uDFEB', text: 'The average patent attorney salary in the US is around $180,000 per year.' },
  { category: 'Industry', icon: '\uD83C\uDFEB', text: 'Over 3.5 million patent applications are filed globally each year across all patent offices.' },
  { category: 'Industry', icon: '\uD83C\uDFEB', text: 'A single US patent application costs $10,000\u2013$15,000 on average in attorney and filing fees.' },
];

function RotatingTip() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * RANKING_TIPS.length));
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex(prev => (prev + 1) % RANKING_TIPS.length);
        setFade(true);
      }, 300);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const tip = RANKING_TIPS[index];
  return (
    <div className={`max-w-md mx-auto transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}>
      <div className="bg-card border rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{tip.icon}</span>
          <span className="text-xs font-semibold text-primary uppercase tracking-wide">{tip.category}</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{tip.text}</p>
      </div>
      <div className="flex justify-center gap-1 mt-3">
        {Array.from({ length: Math.min(5, RANKING_TIPS.length) }).map((_, i) => {
          const dotIndex = (Math.floor(index / 5) * 5 + i) % RANKING_TIPS.length;
          return (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${dotIndex === index ? 'w-4 bg-primary' : 'w-1 bg-muted-foreground/30'}`}
            />
          );
        })}
      </div>
    </div>
  );
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
  const [concepts, setConcepts] = useState<{ name: string; synonyms: string[]; importance?: string; category?: string }[] | undefined>(undefined);
  const [queryTerms, setQueryTerms] = useState<QueryTerms>({ raw: [], stemmed: [] });
  const [priorArtReport, setPriorArtReport] = useState<PriorArtReportState>(INITIAL_REPORT_STATE);
  const [fullReportSections, setFullReportSections] = useState<GenerateReportSectionsResponse | null>(null);

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

    // Extract query terms for hybrid scoring and highlighting
    const terms = extractQueryTerms(data.query);
    setQueryTerms(terms);

    // Enrichment diagnostic
    const enrichedPatents = data.patents.filter((p: DeepPatentResult) => p.enrichedVia);
    const withClaims = data.patents.filter((p: DeepPatentResult) => p.independentClaims && p.independentClaims.length > 0);
    const withCitations = data.patents.filter((p: DeepPatentResult) => p.backwardCitationCount !== undefined);
    const withCpcDetails = data.patents.filter((p: DeepPatentResult) => p.cpcDetails && p.cpcDetails.length > 0);
    const withDesc = data.patents.filter((p: DeepPatentResult) => p.descriptionSnippet && p.descriptionSnippet.length > 0);
    console.log(`[ResultsPage] === Patent Enrichment Check ===`);
    console.log(`[ResultsPage] Total patents: ${data.patents.length}`);
    console.log(`[ResultsPage] Enriched: ${enrichedPatents.length} (via: ${enrichedPatents[0]?.enrichedVia || 'none'})`);
    console.log(`[ResultsPage] With independentClaims: ${withClaims.length}`);
    console.log(`[ResultsPage] With backwardCitationCount: ${withCitations.length}`);
    console.log(`[ResultsPage] With cpcDetails: ${withCpcDetails.length}`);
    console.log(`[ResultsPage] With descriptionSnippet: ${withDesc.length}`);
    if (enrichedPatents.length > 0) {
      const sample = enrichedPatents[0];
      console.log(`[ResultsPage] Sample enriched patent:`, {
        id: sample.patentId,
        enrichedVia: sample.enrichedVia,
        independentClaims: sample.independentClaims?.length,
        totalClaimCount: sample.totalClaimCount,
        backwardCitationCount: sample.backwardCitationCount,
        cpcDetails: sample.cpcDetails?.length,
        descSnippetLen: sample.descriptionSnippet?.length,
        familyId: sample.familyId,
        entityStatus: sample.entityStatus,
      });
    }

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
        // BigQuery enrichment fields (passed through to rank prompt)
        ...(p.independentClaims ? { independentClaims: p.independentClaims } : {}),
        ...(p.backwardCitationCount !== undefined ? { backwardCitationCount: p.backwardCitationCount } : {}),
      })) as PatentForRanking[];

      const rankResponse = await rankPatents(data.query, patentsForRanking);

      // Merge rank data with full patent data and compute hybrid scores
      const merged: RankedDisplayPatent[] = rankResponse.ranked
        .map(ranked => {
          const patent = data.patents.find(p => p.patentId === ranked.patentId);
          if (!patent) return null;

          const aiScore = ranked.semanticScore || ranked.score;
          const breakdown = computeHybridScore({
            terms,
            title: patent.title,
            abstract: patent.fullAbstract || patent.abstract || '',
            firstClaim: patent.firstClaim || '',
            foundBy: patent.foundBy || [],
            cpcCodes: patent.cpcCodes || [],
            aiSemanticScore: aiScore,
            backwardCitationCount: patent.backwardCitationCount,
            independentClaims: patent.independentClaims,
            concepts: data.concepts?.map(c => ({ name: c.name, synonyms: c.synonyms })),
            totalQueries: data.searchMeta?.searchLog?.length,
          });

          return {
            ...patent,
            rank: ranked.rank,
            score: breakdown.final,
            semanticScore: aiScore,
            scoreBreakdown: breakdown,
            reasoning: ranked.reasoning,
            snippets: ranked.snippets || [],
            foundBy: patent.foundBy || [],
          };
        })
        .filter((p): p is RankedDisplayPatent => p !== null);

      // Sort by hybrid score and re-number ranks
      merged.sort((a, b) => b.score - a.score);
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

  // Build structured data for search report export
  const buildSearchReportData = (): SearchReportData | null => {
    if (!searchMeta?.searchLog) return null;

    const modeName = searchMeta.mode === 'pro-auto' ? 'Pro Auto' : searchMeta.mode === 'pro-interactive' ? 'Pro Interactive' : 'Quick';
    const strategyName = searchMeta.strategy ? (searchMeta.strategy === 'onion-ring' ? 'Onion Ring' : searchMeta.strategy.charAt(0).toUpperCase() + searchMeta.strategy.slice(1)) : undefined;

    // Build source attribution
    const sourceCounts: Record<string, number> = {};
    for (const patent of allRankedPatents) {
      for (const source of (patent.foundBy || [])) {
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      }
    }
    const sourceAttributionFinal = Object.entries(sourceCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([src, count]) => {
        const badge = getFoundByBadge(src);
        return { source: src, label: badge?.label || src, count };
      });

    // Build traceability
    const traceability = sortedPatents.slice(0, 15).map(patent => ({
      rank: patent.rank,
      patentId: patent.patentNumber || patent.patentId,
      title: patent.title,
      score: patent.score,
      sources: (patent.foundBy || []).map(s => {
        const badge = getFoundByBadge(s);
        return badge?.label || s;
      }),
      sourceQueries: (patent.foundBy || []).map(s => {
        for (const logEntry of (searchMeta.searchLog || [])) {
          const key = `round${logEntry.round}-${logEntry.label.toLowerCase().replace(/\s+/g, '-')}`;
          if (key === s || logEntry.label.toLowerCase().replace(/\s+/g, '-') === s) {
            return logEntry.query;
          }
        }
        return '';
      }),
    }));

    return {
      query,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      mode: modeName,
      strategy: strategyName,
      totalQueries: searchMeta.searchLog.length,
      uniqueResults: searchMeta.uniqueCount,
      totalDurationMs: searchMeta.totalDurationMs,
      searchLog: searchMeta.searchLog,
      traceability,
      sourceAttribution: sourceAttributionFinal,
    };
  };

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

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-lg font-medium">{statusMessage}</p>
        </div>
      </div>
    );
  }

  if (status === 'ranking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-6 w-full max-w-lg">
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-lg font-semibold">Analyzing Patents</p>
            </div>
            <p className="text-sm text-muted-foreground">{statusMessage}</p>
          </div>
          <RotatingTip />
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
                {/* Strategy + Depth badges */}
                {searchMeta.strategy && (
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 font-semibold capitalize">
                    {searchMeta.strategy === 'onion-ring' ? 'Onion Ring' : searchMeta.strategy}
                  </span>
                )}
                {searchMeta.mergeCount !== undefined && searchMeta.mergeCount > 0 && (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200">
                    {searchMeta.mergeCount} merged
                  </span>
                )}
                {searchMeta.layersStopped !== undefined && (
                  <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded border border-teal-200">
                    Layer {searchMeta.layersStopped}
                  </span>
                )}
                {searchMeta.pairCount !== undefined && (
                  <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded border border-orange-200">
                    {searchMeta.pairCount} pairs
                  </span>
                )}

                {/* Existing mode badges */}
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
                ) : !searchMeta.strategy ? (
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
                ) : null}
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
                <option value="ai-score">Relevance Score</option>
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
            {concepts && concepts.length > 0 && (
              <TabsTrigger value="prior-art" className="text-sm font-bold px-4 py-2">
                Examiner's Report
              </TabsTrigger>
            )}
            {concepts && concepts.length > 0 && (
              <TabsTrigger value="full-report" className="text-sm font-bold px-4 py-2">
                Full Report
              </TabsTrigger>
            )}
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
                    <ScoreTooltip
                      score={patent.score}
                      breakdown={patent.scoreBreakdown}
                      badgeClassName={getScoreBadgeColor(patent.score)}
                    />
                  </div>

                  {/* Patent Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold leading-tight">
                        <HighlightedText
                          text={patent.title || 'Untitled Patent'}
                          queryTerms={queryTerms.raw}
                        />
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
                      {patent.backwardCitationCount !== undefined && patent.backwardCitationCount > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                          patent.backwardCitationCount >= 50
                            ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                            : patent.backwardCitationCount >= 20
                              ? 'bg-orange-50 text-orange-700 border-orange-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {patent.backwardCitationCount} refs
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
                              <span className="italic text-foreground">"<HighlightedText text={snippet.quote} queryTerms={queryTerms.raw} />"</span>
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

                {/* CPC Codes — enhanced with inventive flags if available */}
                {(patent.cpcDetails?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-2 ml-[4.5rem]">
                    {patent.cpcDetails!.slice(0, 8).map((cpc, i) => (
                      <span
                        key={i}
                        className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                          cpc.inventive
                            ? 'bg-amber-50 text-amber-800 border border-amber-300 font-bold'
                            : cpc.first
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-secondary'
                        }`}
                      >
                        {cpc.code}{cpc.inventive ? '*' : ''}
                      </span>
                    ))}
                    {patent.cpcDetails!.length > 8 && (
                      <span className="text-xs text-muted-foreground">
                        +{patent.cpcDetails!.length - 8} more
                      </span>
                    )}
                  </div>
                ) : patent.cpcCodes?.length > 0 ? (
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
                ) : null}

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
                          <HighlightedText
                            text={patent.fullAbstract || patent.abstract}
                            queryTerms={queryTerms.raw}
                            snippetQuotes={patent.snippets?.filter(s => s.source === 'abstract').map(s => s.quote)}
                          />
                        </p>
                      </div>
                    )}
                    {patent.independentClaims && patent.independentClaims.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold mb-1">
                          Independent Claims ({patent.independentClaims.length}{patent.totalClaimCount ? ` of ${patent.totalClaimCount} total` : ''})
                        </h3>
                        <div className="space-y-2">
                          {patent.independentClaims.map((claim, i) => (
                            <div key={i} className="text-sm text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground">Claim {claim.claimNumber}:</span>{' '}
                              <HighlightedText
                                text={claim.text}
                                queryTerms={queryTerms.raw}
                                snippetQuotes={patent.snippets?.filter(s => s.source === 'claim').map(s => s.quote)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : patent.firstClaim ? (
                      <div>
                        <h3 className="text-sm font-semibold mb-1">First Claim</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          <HighlightedText
                            text={patent.firstClaim}
                            queryTerms={queryTerms.raw}
                            snippetQuotes={patent.snippets?.filter(s => s.source === 'claim').map(s => s.quote)}
                          />
                        </p>
                      </div>
                    ) : null}
                    {patent.descriptionSnippet && (
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Description Excerpt</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-6">
                          <HighlightedText
                            text={patent.descriptionSnippet}
                            queryTerms={queryTerms.raw}
                          />
                        </p>
                      </div>
                    )}
                    {(patent.familyId || patent.entityStatus) && (
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {patent.familyId && <span>Family: {patent.familyId}</span>}
                        {patent.entityStatus && <span>Entity: {patent.entityStatus}</span>}
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

          {concepts && concepts.length > 0 && (
            <TabsContent value="prior-art">
              <PriorArtAnalysis
                query={query}
                concepts={concepts}
                patents={allRankedPatents}
                reportState={priorArtReport}
                onReportStateChange={setPriorArtReport}
              />
            </TabsContent>
          )}

          {concepts && concepts.length > 0 && (
            <TabsContent value="full-report">
              <FullReportTab
                query={query}
                concepts={concepts}
                patents={allRankedPatents}
                searchMeta={searchMeta}
                priorArtResult={priorArtReport.result}
                priorArtConcepts={priorArtReport.usedConcepts}
                fullReportSections={fullReportSections}
                onFullReportSectionsChange={setFullReportSections}
              />
            </TabsContent>
          )}

          {searchMeta?.searchLog && searchMeta.searchLog.length > 0 && (
            <TabsContent value="search-report">
              <div className="pt-4 space-y-4">
                {/* Section 1 — Report Header */}
                <div className="border rounded-lg bg-slate-50/50 overflow-hidden">
                  <div className="px-4 py-3 border-b bg-slate-100/80">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-bold text-slate-800">Patent Search Report</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Generated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const reportData = buildSearchReportData();
                            if (reportData) exportSearchReportPDF(reportData);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                          Export PDF
                        </button>
                        <button
                          onClick={async () => {
                            const reportData = buildSearchReportData();
                            if (reportData) await exportSearchReportDOCX(reportData);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                          Export DOCX
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="px-4 py-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200 font-medium">
                        {searchMeta.mode === 'pro-auto' ? 'Pro Auto' : searchMeta.mode === 'pro-interactive' ? 'Pro Interactive' : 'Quick'}
                      </span>
                      {searchMeta.strategy && (
                        <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 font-medium capitalize">
                          {searchMeta.strategy === 'onion-ring' ? 'Onion Ring' : searchMeta.strategy}
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-200 font-medium">
                        {searchMeta.searchLog.length} queries
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-200 font-medium">
                        {searchMeta.uniqueCount} unique results
                      </span>
                      {searchMeta.totalDurationMs && (
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                          {(searchMeta.totalDurationMs / 1000).toFixed(1)}s total
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Query: </span>
                      <span className="italic">{query}</span>
                    </div>
                  </div>
                </div>

                {/* Section 2 — Search Strategy Summary */}
                {searchMeta.strategy && (
                  <div className="border rounded-lg bg-slate-50/50 overflow-hidden">
                    <div className="px-4 py-3 border-b bg-slate-100/80">
                      <h3 className="text-sm font-semibold text-slate-800">Search Strategy Summary</h3>
                    </div>
                    <div className="px-4 py-3 text-xs text-slate-600 space-y-1">
                      <p>
                        <span className="font-medium text-slate-700">Strategy: </span>
                        {searchMeta.strategy === 'telescoping' && 'Telescoping — Broad/Moderate/Narrow tiers progressively narrowing scope'}
                        {searchMeta.strategy === 'onion-ring' && 'Onion Ring — Adaptive layers expanding outward until diminishing returns'}
                        {searchMeta.strategy === 'faceted' && 'Faceted — Concept-pair queries covering all facet combinations'}
                      </p>
                      <p>
                        <span className="font-medium text-slate-700">Rounds: </span>
                        {[...new Set(searchMeta.searchLog.map(e => e.round))].length}
                        {searchMeta.mergeCount !== undefined && searchMeta.mergeCount > 0 && ` | ${searchMeta.mergeCount} merged duplicates`}
                        {searchMeta.layersStopped !== undefined && ` | Stopped at layer ${searchMeta.layersStopped}`}
                        {searchMeta.pairCount !== undefined && ` | ${searchMeta.pairCount} concept pairs`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Section 3 — Query Execution Log */}
                <div className="border rounded-lg bg-slate-50/50 overflow-hidden">
                  <div className="px-4 py-3 border-b bg-slate-100/80">
                    <h3 className="text-sm font-semibold text-slate-800">Query Execution Log</h3>
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
                </div>

                {/* Section 4 — Source Traceability */}
                {allRankedPatents.length > 0 && (
                  <div className="border rounded-lg bg-slate-50/50 overflow-hidden">
                    <div className="px-4 py-3 border-b bg-slate-100/80">
                      <h3 className="text-sm font-semibold text-slate-800">Top Results Source Traceability</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Which queries found each top-ranked patent
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-slate-50/50">
                            <th className="text-left px-3 py-2 font-semibold w-10">Rank</th>
                            <th className="text-left px-3 py-2 font-semibold min-w-[100px]">Patent ID</th>
                            <th className="text-left px-3 py-2 font-semibold">Title</th>
                            <th className="text-center px-3 py-2 font-semibold w-14">Score</th>
                            <th className="text-left px-3 py-2 font-semibold min-w-[140px]">Found By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedPatents.slice(0, 15).map((patent) => {
                            // Build lookup: map foundBy labels to search log query strings
                            const queryLookup: Record<string, string> = {};
                            if (searchMeta.searchLog) {
                              for (const logEntry of searchMeta.searchLog) {
                                // Match against common foundBy patterns
                                const key = `round${logEntry.round}-${logEntry.label.toLowerCase().replace(/\s+/g, '-')}`;
                                queryLookup[key] = logEntry.query;
                                // Also match label directly
                                queryLookup[logEntry.label.toLowerCase().replace(/\s+/g, '-')] = logEntry.query;
                              }
                            }

                            return (
                              <tr key={patent.patentId} className="border-b hover:bg-slate-50/30">
                                <td className="px-3 py-2 font-bold text-slate-500">#{patent.rank}</td>
                                <td className="px-3 py-2 font-mono font-medium text-slate-700">
                                  {patent.patentNumber || patent.patentId}
                                </td>
                                <td className="px-3 py-2 text-slate-600 truncate max-w-[250px]" title={patent.title}>
                                  {patent.title}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${
                                    patent.score >= 80 ? 'bg-green-100 text-green-700' :
                                    patent.score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                                    patent.score >= 40 ? 'bg-orange-100 text-orange-700' :
                                    'bg-red-100 text-red-700'
                                  }`}>
                                    {patent.score.toFixed(1)}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {(patent.foundBy || []).map((source, si) => {
                                      const badge = getFoundByBadge(source);
                                      const matchedQuery = queryLookup[source];
                                      return badge ? (
                                        <span
                                          key={si}
                                          className={`px-1.5 py-0.5 rounded border cursor-help ${badge.color}`}
                                          title={matchedQuery ? `Query: ${matchedQuery.substring(0, 120)}` : source}
                                        >
                                          {badge.label}
                                        </span>
                                      ) : null;
                                    })}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Section 5 — Source Attribution Summary */}
                <div className="border rounded-lg bg-slate-50/50 overflow-hidden">
                  <div className="px-4 py-3 border-b bg-slate-100/80">
                    <h3 className="text-sm font-semibold text-slate-800">Source Attribution Summary</h3>
                  </div>
                  <div className="px-4 py-3">
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
