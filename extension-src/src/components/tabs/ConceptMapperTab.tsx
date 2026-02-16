import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Copy, Check, Plus, X, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { SearchResultSkeleton } from '../ui/skeleton';
import { SearchResult } from '../SearchResult';
import { copyToClipboard } from '../booleanSearchUtils';
import { extractConcepts, ExtractedConcept, ConceptCategory, ConceptImportance, ProSearchMode, TerminologySwap, generateFromConcepts, GenerateFromConceptsResponse } from '../../services/apiService';
import { buildSearchesFromConcepts, ConceptForSearch } from '../../utils/conceptSearchBuilder';
import {
  runTripleSearch,
  runProAutoSearch,
  runProInteractiveSearch,
  ProSearchProgress,
  RefinementDashboardData,
  UserRefinementSelections,
} from '../../utils/patentSearchPipeline';
import RefinementDashboard from '../RefinementDashboard';
import { useCreditGate } from '../../hooks/useCreditGate';
import { useCreditContext } from '../../contexts/CreditContext';
import InsufficientCreditsModal from '../InsufficientCreditsModal';
import AnimatedCreditPill from '../AnimatedCreditPill';

interface ManagedConcept extends ExtractedConcept {
  id: string;
  enabled: boolean;
}

const CATEGORY_COLORS: Record<ConceptCategory, string> = {
  device: 'bg-blue-100 text-blue-700 border-blue-200',
  process: 'bg-green-100 text-green-700 border-green-200',
  material: 'bg-amber-100 text-amber-700 border-amber-200',
  property: 'bg-purple-100 text-purple-700 border-purple-200',
  context: 'bg-slate-100 text-slate-700 border-slate-200',
};

const IMPORTANCE_COLORS: Record<ConceptImportance, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-slate-100 text-slate-500',
};

let conceptIdCounter = 0;
function nextId(): string {
  return `concept-${++conceptIdCounter}`;
}

const ConceptMapperTab: React.FC = () => {
  const { checkingAction, showPurchasePrompt, canSearch, withCreditCheck, dismissPurchasePrompt } = useCreditGate();
  const { credits } = useCreditContext();
  const [inputText, setInputText] = useState('');
  const [concepts, setConcepts] = useState<ManagedConcept[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [searchingField, setSearchingField] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState('');
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ConceptCategory>('device');
  const [newSynonyms, setNewSynonyms] = useState('');
  const [addingSynonymFor, setAddingSynonymFor] = useState<string | null>(null);
  const [newSynonymText, setNewSynonymText] = useState('');
  const isMounted = useRef(true);

  // Pro search state
  const [searchMode, setSearchMode] = useState<ProSearchMode>('quick');
  const [proSearchPhase, setProSearchPhase] = useState('');
  const [proSearchPercent, setProSearchPercent] = useState(0);
  const [proSearchMessage, setProSearchMessage] = useState('');

  // Refinement dashboard state (interactive mode)
  const [showRefinementDashboard, setShowRefinementDashboard] = useState(false);
  const [refinementData, setRefinementData] = useState<RefinementDashboardData | null>(null);
  const refinementResolveRef = useRef<((selections: UserRefinementSelections) => void) | null>(null);
  const [selectedPatentIds, setSelectedPatentIds] = useState<Set<string>>(new Set());
  const [selectedCPCCodes, setSelectedCPCCodes] = useState<Set<string>>(new Set());
  const [acceptedSwapIndices, setAcceptedSwapIndices] = useState<Set<number>>(new Set());

  // AI-generated smart searches (with proximity operators)
  const [smartSearches, setSmartSearches] = useState<GenerateFromConceptsResponse | null>(null);
  const [isGeneratingSearches, setIsGeneratingSearches] = useState(false);
  const generateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  // Build search previews from enabled concepts (simple fallback)
  const conceptsForSearch: ConceptForSearch[] = useMemo(() =>
    concepts.map(c => ({
      name: c.name,
      synonyms: c.synonyms,
      enabled: c.enabled,
      importance: c.importance,
    })),
    [concepts]
  );

  const simpleSearches = useMemo(
    () => buildSearchesFromConcepts(conceptsForSearch),
    [conceptsForSearch]
  );

  // Use AI-generated searches if available, otherwise fall back to simple builder
  const generatedSearches = smartSearches || simpleSearches;

  const hasEnabledConcepts = concepts.some(c => c.enabled);

  // Generate smart searches via AI (debounced)
  const regenerateSmartSearches = useCallback((managedConcepts: ManagedConcept[]) => {
    if (generateDebounceRef.current) clearTimeout(generateDebounceRef.current);

    const enabled = managedConcepts.filter(c => c.enabled);
    if (enabled.length === 0) {
      setSmartSearches(null);
      return;
    }

    generateDebounceRef.current = setTimeout(async () => {
      setIsGeneratingSearches(true);
      try {
        const result = await generateFromConcepts(
          enabled.map(c => ({
            name: c.name,
            synonyms: c.synonyms,
            category: c.category,
            importance: c.importance,
            enabled: true,
          }))
        );
        if (isMounted.current) setSmartSearches(result);
      } catch (err) {
        console.warn('Smart search generation failed, using simple builder:', err);
      } finally {
        if (isMounted.current) setIsGeneratingSearches(false);
      }
    }, 800);
  }, []);

  const handleExtract = async () => {
    if (!inputText.trim()) return;
    setIsExtracting(true);
    setError('');
    setConcepts([]);
    setSmartSearches(null);

    try {
      const response = await extractConcepts(inputText.trim());
      if (isMounted.current) {
        const managed: ManagedConcept[] = (response.concepts || []).map(c => ({
          ...c,
          id: nextId(),
          enabled: true,
        }));
        setConcepts(managed);
        // Fire AI search generation immediately
        regenerateSmartSearches(managed);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to extract concepts');
      }
    } finally {
      if (isMounted.current) setIsExtracting(false);
    }
  };

  const toggleConcept = (id: string) => {
    setConcepts(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c);
      regenerateSmartSearches(updated);
      return updated;
    });
  };

  const removeSynonym = (conceptId: string, synIndex: number) => {
    setConcepts(prev => {
      const updated = prev.map(c =>
        c.id === conceptId
          ? { ...c, synonyms: c.synonyms.filter((_, i) => i !== synIndex) }
          : c
      );
      regenerateSmartSearches(updated);
      return updated;
    });
  };

  const addSynonym = (conceptId: string, synonym: string) => {
    const trimmed = synonym.trim();
    if (!trimmed) return;
    setConcepts(prev => {
      const updated = prev.map(c =>
        c.id === conceptId
          ? { ...c, synonyms: [...c.synonyms, trimmed] }
          : c
      );
      regenerateSmartSearches(updated);
      return updated;
    });
    setNewSynonymText('');
    setAddingSynonymFor(null);
  };

  const addManualConcept = () => {
    const name = newName.trim();
    if (!name) return;
    const synonyms = newSynonyms
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const concept: ManagedConcept = {
      id: nextId(),
      name,
      category: newCategory,
      synonyms,
      importance: 'medium',
      enabled: true,
    };
    setConcepts(prev => {
      const updated = [...prev, concept];
      regenerateSmartSearches(updated);
      return updated;
    });
    setNewName('');
    setNewSynonyms('');
    setShowAddForm(false);
  };

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => {
      if (isMounted.current) setCopiedField(null);
    }, 2000);
  };

  const handleSearch = async (level: 'broad' | 'moderate' | 'narrow') => {
    if (!hasEnabledConcepts) return;

    await withCreditCheck(level, 1, async () => {
      setSearchingField(level);
      setSearchProgress('Starting search...');
      setError('');

      // Build a keyword-style query from enabled concept names instead of the full paragraph
      const smartRawText = concepts
        .filter(c => c.enabled)
        .map(c => c.name.includes(' ') ? `"${c.name}"` : c.name)
        .join(' ');

      try {
        await runTripleSearch({
          rawText: smartRawText,
          booleanQuery: generatedSearches[level],
          includeNPL: true,
          concepts: concepts.filter(c => c.enabled).map(c => ({ name: c.name, synonyms: c.synonyms })),
          onProgress: (msg) => {
            if (isMounted.current) setSearchProgress(msg);
          },
        });
        if (isMounted.current) setSearchProgress('Done!');
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Search failed');
        }
      } finally {
        setTimeout(() => {
          if (isMounted.current) {
            setSearchingField(null);
            setSearchProgress('');
          }
        }, 2000);
      }
    });
  };

  // Pro search handlers
  const handleProAutoSearch = async () => {
    if (!hasEnabledConcepts) return;

    await withCreditCheck('pro-auto', 2, async () => {
      setSearchingField('pro-auto');
      setError('');

      try {
        await runProAutoSearch({
          originalParagraph: inputText.trim(),
          concepts: conceptsForSearch,
          onProgress: (progress: ProSearchProgress) => {
            if (isMounted.current) {
              setProSearchPhase(progress.phase);
              setProSearchPercent(progress.percent);
              setProSearchMessage(progress.message);
            }
          },
        });
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Pro Auto search failed');
        }
      } finally {
        if (isMounted.current) {
          setSearchingField(null);
          setProSearchPhase('');
          setProSearchPercent(0);
          setProSearchMessage('');
        }
      }
    });
  };

  const handleRefinementContinue = useCallback(() => {
    if (!refinementResolveRef.current || !refinementData) return;

    // Build updated concepts from accepted terminology swaps
    const updatedConcepts: ConceptForSearch[] = conceptsForSearch
      .filter((c) => c.enabled)
      .map((c) => {
        const newSyns = [...c.synonyms];
        acceptedSwapIndices.forEach((idx) => {
          const swap = refinementData.terminologySwaps[idx];
          if (swap && swap.userTerm.toLowerCase() === c.name.toLowerCase()) {
            for (const pt of swap.patentTerms) {
              if (!newSyns.includes(pt)) newSyns.push(pt);
            }
          }
        });
        return { ...c, synonyms: newSyns };
      });

    const selections: UserRefinementSelections = {
      selectedPatentIds: Array.from(selectedPatentIds),
      selectedCPCCodes: Array.from(selectedCPCCodes),
      acceptedTermSwaps: Array.from(acceptedSwapIndices).map((i) => refinementData.terminologySwaps[i]).filter(Boolean),
      updatedConcepts,
    };

    refinementResolveRef.current(selections);
    refinementResolveRef.current = null;
    setShowRefinementDashboard(false);
    setRefinementData(null);
    setSelectedPatentIds(new Set());
    setSelectedCPCCodes(new Set());
    setAcceptedSwapIndices(new Set());
  }, [conceptsForSearch, refinementData, selectedPatentIds, selectedCPCCodes, acceptedSwapIndices]);

  const handleRefinementCancel = useCallback(() => {
    // Resolve with empty selections — pipeline will use defaults
    if (refinementResolveRef.current) {
      refinementResolveRef.current({
        selectedPatentIds: [],
        selectedCPCCodes: [],
        acceptedTermSwaps: [],
        updatedConcepts: [],
      });
      refinementResolveRef.current = null;
    }
    setShowRefinementDashboard(false);
    setRefinementData(null);
    setSearchingField(null);
    setProSearchPhase('');
    setProSearchPercent(0);
    setProSearchMessage('');
  }, []);

  const handleProInteractiveSearch = async () => {
    if (!hasEnabledConcepts) return;

    await withCreditCheck('pro-interactive', 3, async () => {
      setSearchingField('pro-interactive');
      setError('');

      try {
        await runProInteractiveSearch({
          originalParagraph: inputText.trim(),
          concepts: conceptsForSearch,
          onProgress: (progress: ProSearchProgress) => {
            if (isMounted.current) {
              setProSearchPhase(progress.phase);
              setProSearchPercent(progress.percent);
              setProSearchMessage(progress.message);
            }
          },
          onPause: (data: RefinementDashboardData) => {
            return new Promise<UserRefinementSelections>((resolve) => {
              if (isMounted.current) {
                // Pre-select top patent IDs (first 3) and top CPC codes (first 3)
                const preselectedPatents = new Set(data.patents.slice(0, 3).map((p: any) => p.patentId));
                const preselectedCPCs = new Set(data.cpcSuggestions.slice(0, 3).map((c) => c.code));

                setRefinementData(data);
                setSelectedPatentIds(preselectedPatents);
                setSelectedCPCCodes(preselectedCPCs);
                setAcceptedSwapIndices(new Set());
                setShowRefinementDashboard(true);
                refinementResolveRef.current = resolve;
              }
            });
          },
        });
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Pro Interactive search failed');
        }
      } finally {
        if (isMounted.current) {
          setSearchingField(null);
          setProSearchPhase('');
          setProSearchPercent(0);
          setProSearchMessage('');
          setShowRefinementDashboard(false);
        }
      }
    });
  };

  const isProSearching = searchingField === 'pro-auto' || searchingField === 'pro-interactive';

  return (
    <div className="space-y-3">
      {/* A. Input Area */}
      <div className="space-y-2">
        <Label htmlFor="concept-input" className="text-xs">Describe your invention or technology</Label>
        <Textarea
          id="concept-input"
          placeholder="Paste a paragraph describing your invention..."
          value={inputText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleExtract(); }
          }}
          className="min-h-[80px] text-sm"
          rows={4}
        />
        <Button
          onClick={handleExtract}
          disabled={isExtracting || !inputText.trim()}
          className="w-full"
          size="sm"
        >
          {isExtracting ? 'Extracting...' : 'Extract Concepts'}
        </Button>
      </div>

      {isExtracting && <SearchResultSkeleton />}

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
          {error}
        </div>
      )}

      {/* B. Concept Cards */}
      {concepts.length > 0 && !isExtracting && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Concepts ({concepts.filter(c => c.enabled).length}/{concepts.length} active)</Label>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {concepts.map(concept => (
              <div
                key={concept.id}
                className={`border rounded-lg p-2 transition-opacity ${
                  concept.enabled ? 'bg-white border-border' : 'opacity-60 bg-muted/30 border-muted'
                }`}
              >
                {/* Row 1: Toggle + Name + Badges */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleConcept(concept.id)}
                    className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      concept.enabled
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-muted-foreground/30 bg-transparent'
                    }`}
                  >
                    {concept.enabled && <Check className="h-3 w-3" />}
                  </button>
                  <span className="text-sm font-medium flex-1 truncate">{concept.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase font-medium ${IMPORTANCE_COLORS[concept.importance]}`}>
                    {concept.importance}
                  </span>
                </div>

                {/* Row 2: Category badge */}
                <div className="ml-7 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CATEGORY_COLORS[concept.category]}`}>
                    {concept.category}
                  </span>
                </div>

                {/* Row 3: Synonym chips */}
                <div className="ml-7 mt-1.5 flex flex-wrap gap-1 items-center">
                  {concept.synonyms.map((syn, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-0.5 text-[11px] bg-secondary px-1.5 py-0.5 rounded"
                    >
                      {syn}
                      <button
                        onClick={() => removeSynonym(concept.id, i)}
                        className="text-muted-foreground hover:text-destructive ml-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {addingSynonymFor === concept.id ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="text"
                        value={newSynonymText}
                        onChange={(e) => setNewSynonymText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addSynonym(concept.id, newSynonymText);
                          if (e.key === 'Escape') { setAddingSynonymFor(null); setNewSynonymText(''); }
                        }}
                        className="text-[11px] w-20 border rounded px-1 py-0.5 bg-background"
                        placeholder="synonym"
                        autoFocus
                      />
                      <button
                        onClick={() => addSynonym(concept.id, newSynonymText)}
                        className="text-primary"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setAddingSynonymFor(concept.id)}
                      className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="h-2.5 w-2.5" /> add
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* C. Add Concept (collapsible) */}
      {concepts.length > 0 && !isExtracting && (
        <div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {showAddForm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Add custom concept
          </button>
          {showAddForm && (
            <div className="mt-2 space-y-2 border rounded-lg p-2 bg-muted/20">
              <Input
                placeholder="Concept name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="text-xs h-8"
              />
              <Select value={newCategory} onValueChange={(v) => setNewCategory(v as ConceptCategory)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="device">Device</SelectItem>
                  <SelectItem value="process">Process</SelectItem>
                  <SelectItem value="material">Material</SelectItem>
                  <SelectItem value="property">Property</SelectItem>
                  <SelectItem value="context">Context</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Synonyms (comma-separated)"
                value={newSynonyms}
                onChange={(e) => setNewSynonyms(e.target.value)}
                className="text-xs h-8"
              />
              <Button size="sm" className="w-full h-7 text-xs" onClick={addManualConcept} disabled={!newName.trim()}>
                <Plus className="h-3 w-3 mr-1" /> Add Concept
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Insufficient Credits Modal */}
      {showPurchasePrompt && (
        <InsufficientCreditsModal onDismiss={dismissPurchasePrompt} />
      )}

      {/* D. Mode Selector */}
      {hasEnabledConcepts && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">Search Mode</Label>
            <AnimatedCreditPill />
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-secondary/30 rounded-lg">
            {([
              { mode: 'quick' as ProSearchMode, label: 'Quick', desc: '3 searches' },
              { mode: 'pro-auto' as ProSearchMode, label: 'Pro Auto', desc: '2-round AI' },
              { mode: 'pro-interactive' as ProSearchMode, label: 'Pro Interactive', desc: '3-round guided' },
            ]).map(({ mode, label, desc }) => (
              <button
                key={mode}
                onClick={() => setSearchMode(mode)}
                disabled={!!searchingField}
                className={`px-2 py-1.5 rounded text-center transition-colors ${
                  searchMode === mode
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-secondary/50 text-muted-foreground'
                }`}
              >
                <div className="text-[11px] font-semibold">{label}</div>
                <div className="text-[9px] opacity-80">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* E. Refinement Dashboard (interactive mode pauses) */}
      {showRefinementDashboard && refinementData && (
        <div className="border-2 border-primary/30 rounded-lg p-3 bg-primary/5">
          <RefinementDashboard
            roundNumber={refinementData.roundNumber}
            patents={refinementData.patents}
            cpcSuggestions={refinementData.cpcSuggestions}
            terminologySwaps={refinementData.terminologySwaps}
            conceptHealth={refinementData.conceptHealth}
            selectedPatentIds={selectedPatentIds}
            onTogglePatent={(id) => setSelectedPatentIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            selectedCPCCodes={selectedCPCCodes}
            onToggleCPC={(code) => setSelectedCPCCodes((prev) => {
              const next = new Set(prev);
              if (next.has(code)) next.delete(code); else next.add(code);
              return next;
            })}
            acceptedSwapIndices={acceptedSwapIndices}
            onToggleSwap={(idx) => setAcceptedSwapIndices((prev) => {
              const next = new Set(prev);
              if (next.has(idx)) next.delete(idx); else next.add(idx);
              return next;
            })}
            onContinue={handleRefinementContinue}
            onCancel={handleRefinementCancel}
          />
        </div>
      )}

      {/* F. Generated Searches (Quick mode) or Pro Search Button */}
      {hasEnabledConcepts && !showRefinementDashboard && (
        <div className="space-y-2">
          {searchMode === 'quick' ? (
            <>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold">Generated Searches</Label>
                {isGeneratingSearches && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="animate-spin rounded-full h-2.5 w-2.5 border-b border-primary" />
                    AI optimizing...
                  </span>
                )}
                {smartSearches && !isGeneratingSearches && (
                  <span className="text-[10px] text-emerald-600 font-medium">AI-enhanced</span>
                )}
              </div>
              {(['broad', 'moderate', 'narrow'] as const).map(level => {
                const search = generatedSearches[level];
                if (!search) return null;
                const colorClass = level === 'broad'
                  ? 'border-green-200 bg-green-50'
                  : level === 'moderate'
                    ? 'border-yellow-200 bg-yellow-50'
                    : 'border-red-200 bg-red-50';
                const isThisSearching = searchingField === level;
                return (
                  <div key={level} className={`border rounded-lg p-2 ${colorClass}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold capitalize">{level}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => handleCopy(search, level)}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        <span className="text-[10px]">{copiedField === level ? 'Copied!' : 'Copy'}</span>
                      </Button>
                    </div>
                    <SearchResult result={search} />
                    <Button
                      onClick={() => handleSearch(level)}
                      disabled={!!searchingField || !canSearch || checkingAction !== null}
                      className="w-full mt-2 h-9 text-sm font-semibold gap-2"
                      size="sm"
                    >
                      <Search className="h-4 w-4" />
                      {checkingAction === level ? 'Checking credits...' : isThisSearching ? 'Searching...' : `Search ${level.charAt(0).toUpperCase() + level.slice(1)} (1 credit)`}
                    </Button>
                  </div>
                );
              })}
            </>
          ) : searchMode === 'pro-auto' ? (
            <Button
              onClick={handleProAutoSearch}
              disabled={!!searchingField || !canSearch || checkingAction !== null}
              className="w-full h-11 text-sm font-bold gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              size="sm"
            >
              <Search className="h-4 w-4" />
              {checkingAction === 'pro-auto' ? 'Checking credits...' : searchingField === 'pro-auto' ? 'Running Pro Auto...' : 'Run Pro Auto Search (2 credits)'}
            </Button>
          ) : (
            <Button
              onClick={handleProInteractiveSearch}
              disabled={!!searchingField || !canSearch || checkingAction !== null}
              className="w-full h-11 text-sm font-bold gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
              size="sm"
            >
              <Search className="h-4 w-4" />
              {checkingAction === 'pro-interactive' ? 'Checking credits...' : searchingField === 'pro-interactive' ? 'Running Pro Interactive...' : 'Run Pro Interactive Search (3 credits)'}
            </Button>
          )}
        </div>
      )}

      {/* G. Search Progress */}
      {searchProgress && !isProSearching && (
        <div className="border rounded-lg p-3 bg-secondary/30">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            <span className="text-sm">{searchProgress}</span>
          </div>
        </div>
      )}

      {/* H. Pro Search Progress (with progress bar + phase badges) */}
      {isProSearching && proSearchMessage && !showRefinementDashboard && (
        <div className="border rounded-lg p-3 bg-secondary/30 space-y-2">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            <span className="text-sm flex-1">{proSearchMessage}</span>
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${proSearchPercent}%` }}
            />
          </div>
          {/* Phase badges */}
          <div className="flex flex-wrap gap-1">
            {(['round1', 'analyzing', 'similarity', 'round2', 'round3', 'deep-scrape', 'done'] as const).map((phase) => {
              const phaseLabels: Record<string, string> = {
                round1: 'R1', analyzing: 'AI', similarity: 'Similar',
                round2: 'R2', round3: 'R3', 'deep-scrape': 'Scrape', done: 'Done',
              };
              const isActive = proSearchPhase === phase;
              const isPast = ['round1', 'analyzing', 'similarity', 'round2', 'round3', 'deep-scrape', 'done']
                .indexOf(proSearchPhase) > ['round1', 'analyzing', 'similarity', 'round2', 'round3', 'deep-scrape', 'done'].indexOf(phase);
              // Hide round3 for pro-auto
              if (phase === 'round3' && searchMode === 'pro-auto') return null;
              return (
                <span
                  key={phase}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isPast
                        ? 'bg-green-100 text-green-700'
                        : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {phaseLabels[phase]}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConceptMapperTab;
