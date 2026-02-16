import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { AlertTriangle, Copy, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Label } from '../ui/label';
import { SearchResult } from '../SearchResult';
import { SearchResultSkeleton } from '../ui/skeleton';
import { copyToClipboard } from '../booleanSearchUtils';
import { generateSearchStrings, SearchResponse } from '../../services/apiService';
import { stopWords, fields } from '../BooleanSearchGenerator';
import { sanitizeForGooglePatents, runTripleSearch } from '../../utils/patentSearchPipeline';

interface SearchState {
  broad: string;
  moderate: string;
  narrow: string;
  terms: { term: string; synonyms: string[] }[];
}

const UnifiedSearchTab: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [selectedField, setSelectedField] = useState('ALL');
  const [selectedCC, setSelectedCC] = useState('US');
  const [searchSystem, setSearchSystem] = useState('orbit');
  const [results, setResults] = useState<SearchState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState({
    broad: true,
    moderate: true,
    narrow: true,
  });
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [searchingField, setSearchingField] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<string>('');
  const isMounted = useRef(true);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const toggleSection = (section: 'broad' | 'moderate' | 'narrow') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => {
      if (isMounted.current) setCopiedField(null);
    }, 2000);
  };

  const searchOnPatents = async (booleanQuery: string, field: string) => {
    setSearchingField(field);
    setSearchProgress('Preparing triple search...');
    setErrors([]);

    try {
      await runTripleSearch({
        rawText: inputText.trim(),
        booleanQuery,
        includeNPL: true,
        onProgress: (msg) => {
          if (isMounted.current) setSearchProgress(msg);
        },
      });
      if (isMounted.current) setSearchProgress('Done!');
    } catch (err) {
      console.error('[PSG] Triple search failed:', err);
      if (isMounted.current) {
        setErrors([`Search failed: ${err instanceof Error ? err.message : String(err)}`]);
      }
    } finally {
      setTimeout(() => {
        if (isMounted.current) {
          setSearchingField(null);
          setSearchProgress('');
        }
      }, 2000);
    }
  };

  // Field prefix mapping
  const FIELD_PREFIXES: Record<string, string> = {
    'Title': 'TI',
    'Abstract': 'AB',
    'Title, Abstract, Claims': 'TAC',
    'Claims': 'CL',
    'Full Text': 'FT',
    'ALL': ''
  };

  const replaceSearchField = (searchString: string, newField: string): string => {
    if (!searchString || newField === 'ALL') return searchString;
    const fieldPrefix = FIELD_PREFIXES[newField];
    if (!fieldPrefix) return searchString;
    const fieldMatch = searchString.match(/^(FT|AB|TI|TAC|CA)=/);
    if (fieldMatch) {
      return searchString.replace(fieldMatch[0], `${fieldPrefix}=`);
    }
    return `${fieldPrefix}=${searchString}`;
  };

  const formatResult = (searchString: string): string => {
    const withField = replaceSearchField(searchString, selectedField);
    if (searchSystem === 'google-patents') {
      return withField; // Google Patents doesn't use CC
    }
    return `${withField} AND CC=${selectedCC}`;
  };

  const handleGenerateAll = useCallback(async () => {
    if (!inputText.trim()) {
      setErrors(['Please enter search terms']);
      return;
    }

    const words = inputText.trim().split(/\s+/).filter(
      word => !stopWords.has(word.toLowerCase())
    );

    if (words.length === 0) {
      setErrors(['Please enter valid search terms (not just stop words)']);
      return;
    }

    setIsLoading(true);
    setErrors([]);
    setResults(null);

    try {
      const response: SearchResponse = await generateSearchStrings(words, searchSystem);

      if (isMounted.current) {
        setResults({
          broad: response.broad,
          moderate: response.moderate,
          narrow: response.narrow,
          terms: response.terms || [],
        });
      }
    } catch (error) {
      if (isMounted.current) {
        const message = error instanceof Error ? error.message : 'Error generating search strings';
        setErrors([message]);
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [inputText, searchSystem]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerateAll();
    }
  };

  const renderResultSection = (
    type: 'broad' | 'moderate' | 'narrow',
    label: string,
    colorClass: string,
    description: string,
  ) => {
    if (!results) return null;
    const raw = results[type];
    if (!raw) return null;
    const formatted = formatResult(raw);
    const isExpanded = expandedSections[type];

    const isThisSearching = searchingField === type;

    return (
      <div className={`border rounded-lg overflow-hidden ${colorClass}`}>
        <button
          className="w-full flex items-center justify-between p-3 text-left hover:bg-black/5 transition-colors"
          onClick={() => toggleSection(type)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs text-muted-foreground">{description}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(formatted, type);
              }}
            >
              <Copy className="h-3 w-3 mr-1" />
              <span className="text-xs">
                {copiedField === type ? 'Copied!' : 'Copy'}
              </span>
            </Button>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        {isExpanded && (
          <div className="px-3 pb-3 border-t">
            <SearchResult result={formatted} />
            <Button
              onClick={(e) => {
                e.stopPropagation();
                searchOnPatents(formatted, type);
              }}
              disabled={!!searchingField}
              className="w-full mt-2 h-9 text-sm font-semibold gap-2"
              size="sm"
            >
              <Search className="h-4 w-4" />
              {isThisSearching ? 'Searching...' : `Search ${label} on Google Patents`}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Select value={selectedField} onValueChange={setSelectedField}>
            <SelectTrigger className="w-28 text-xs">
              <SelectValue placeholder="Field" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(fields).map((field) => (
                <SelectItem key={field} value={field}>{field}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {searchSystem !== 'google-patents' && (
            <Select value={selectedCC} onValueChange={setSelectedCC}>
              <SelectTrigger className="w-16 text-xs">
                <SelectValue placeholder="CC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">US</SelectItem>
                <SelectItem value="EP">EP</SelectItem>
                <SelectItem value="WO">WO</SelectItem>
                <SelectItem value="JP">JP</SelectItem>
                <SelectItem value="CN">CN</SelectItem>
                <SelectItem value="KR">KR</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <Label className="text-xs font-medium">Search Terms</Label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerateAll(); } }}
          placeholder="Enter search terms (e.g., wireless charging electric vehicle)..."
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
        />
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {errors.map((error, i) => (
              <div key={i}>{error}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleGenerateAll}
        className="w-full"
        disabled={isLoading || !inputText.trim()}
      >
        {isLoading ? 'Generating...' : 'Generate All Searches'}
      </Button>

      {isLoading && (
        <div className="space-y-3">
          <SearchResultSkeleton />
          <SearchResultSkeleton />
          <SearchResultSkeleton />
        </div>
      )}

      {results && !isLoading && (
        <div className="space-y-2">
          {renderResultSection('broad', 'Broad', 'border-green-200 bg-green-50', 'FT= / OR groups / AND')}
          {renderResultSection('moderate', 'Moderate', 'border-yellow-200 bg-yellow-50', 'TAC= / AND groups')}
          {renderResultSection('narrow', 'Narrow', 'border-red-200 bg-red-50', 'TAC= / 2D proximity')}

          {results.terms && results.terms.length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <Label className="text-xs font-semibold">Terms & Synonyms</Label>
              <div className="mt-2 space-y-1">
                {results.terms.map((term, index) => (
                  <div key={index} className="text-xs">
                    <span className="font-medium">{term.term}:</span>{' '}
                    <span className="text-muted-foreground">{term.synonyms.join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search Progress */}
      {searchProgress && (
        <div className="border rounded-lg p-3 bg-secondary/30">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            <span className="text-sm">{searchProgress}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedSearchTab;
