import { useState, useEffect, useCallback, useRef, SetStateAction, Dispatch } from 'react';
import useSynonyms from '../hooks/useSynonyms';
import { stopWords } from '../components/BooleanSearchGenerator';
import { copyToClipboard } from '../components/booleanSearchUtils';

interface SearchResults {
  broad: string;
  moderate: string;
  narrow: string;
}

interface UseBooleanSearchState {
  inputText: string;
  setInputText: Dispatch<SetStateAction<string>>;
  words: string[];
  searchSystem: string;
  setSearchSystem: Dispatch<SetStateAction<string>>;
  selectedField: string;
  setSelectedField: Dispatch<SetStateAction<string>>;
  selectedCC: string;
  setSelectedCC: Dispatch<SetStateAction<string>>;
  customSynonyms: Record<string, string[]>;
  setCustomSynonyms: Dispatch<SetStateAction<Record<string, string[]>>>;
  result: string;
  setResult: Dispatch<SetStateAction<string>>;
  validationErrors: string[];
  setValidationErrors: Dispatch<SetStateAction<string[]>>;
  searchHistory: string[];
  setSearchHistory: Dispatch<SetStateAction<string[]>>;
  useTruncation: boolean;
  setUseTruncation: Dispatch<SetStateAction<boolean>>;
  wordType: 'auto' | 'verb' | 'noun' | 'spelling';
  setWordType: Dispatch<SetStateAction<'auto' | 'verb' | 'noun' | 'spelling'>>;
  synonymInput: string;
  setSynonymInput: Dispatch<SetStateAction<string>>;
  synonymResults: Record<string, string[]>;
  setSynonymResults: Dispatch<SetStateAction<Record<string, string[]>>>;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  searchInput: string;
  setSearchInput: Dispatch<SetStateAction<string>>;
  searchResult: string;
  setSearchResult: Dispatch<SetStateAction<string>>;
  searchTerms: { word: string, synonyms: string[] }[];
  handleInputChange: (input: string) => void;
  handleGenerateSearch: (mode: 'broad' | 'moderate' | 'narrow') => Promise<void>;
  copyToClipboard: (text: string) => void;
}

// Field prefix mapping
const FIELD_PREFIXES: Record<string, string> = {
  'Title': 'TI',
  'Abstract': 'AB',
  'Title, Abstract, Claims': 'TAC',
  'Claims': 'CL',
  'Full Text': 'FT',
  'ALL': ''
};

// Helper function to replace search field prefix
const replaceSearchField = (searchString: string, newField: string): string => {
  if (!searchString) return searchString;
  
  // If no field is selected (ALL), return the original string
  if (newField === 'ALL') return searchString;
  
  // Get the correct field prefix
  const fieldPrefix = FIELD_PREFIXES[newField];
  if (!fieldPrefix) return searchString;
  
  // Extract the existing field prefix if it exists
  const fieldMatch = searchString.match(/^(FT|AB|TI|TAC|CA)=/);
  if (fieldMatch) {
    return searchString.replace(fieldMatch[0], `${fieldPrefix}=`);
  }
  
  // If no field prefix exists, add the new one
  return `${fieldPrefix}=${searchString}`;
};

const useBooleanSearchState = (): UseBooleanSearchState => {
  const isMounted = useRef(true);
  const [inputText, setInputText] = useState<string>('');
  const [words, setWords] = useState<string[]>([]);
  const [searchSystem, setSearchSystem] = useState<string>('orbit');
  const [selectedField, setSelectedField] = useState<string>('ALL');
  const [selectedCC, setSelectedCC] = useState<string>('US');
  const [customSynonyms, setCustomSynonyms] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [useTruncation, setUseTruncation] = useState<boolean>(true);
  const [wordType, setWordType] = useState<'auto' | 'verb' | 'noun' | 'spelling'>('auto');
  const [synonymInput, setSynonymInput] = useState<string>('');
  const [synonymResults, setSynonymResults] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchResult, setSearchResult] = useState<string>('');
  const [searchTerms, setSearchTerms] = useState<{ word: string, synonyms: string[] }[]>([]);

  const { processWords, searchResults } = useSynonyms({}, customSynonyms);

  // Safe state setters
  const safeSetWords = useCallback((value: SetStateAction<string[]>) => {
    if (isMounted.current) setWords(value);
  }, []);

  const safeSetSynonymResults = useCallback((value: SetStateAction<Record<string, string[]>>) => {
    if (isMounted.current) setSynonymResults(value);
  }, []);

  const safeSetIsLoading = useCallback((value: SetStateAction<boolean>) => {
    if (isMounted.current) setIsLoading(value);
  }, []);

  const safeSetResult = useCallback((value: SetStateAction<string>) => {
    if (isMounted.current) setResult(value);
  }, []);

  const safeSetSearchHistory = useCallback((value: SetStateAction<string[]>) => {
    if (isMounted.current) setSearchHistory(value);
  }, []);

  useEffect(() => {
    if (inputText.trim()) {
      safeSetWords(inputText.trim().split(/\s+/));
    }
    return () => {
      safeSetWords([]);
    };
  }, [inputText, safeSetWords]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleInputChange = useCallback((input: string) => {
    if (!isMounted.current) return;
    setInputText(input);
    setSynonymInput(input);
  }, []);

  const handleGenerateSearch = useCallback(async (mode: 'broad' | 'moderate' | 'narrow') => {
    if (!isMounted.current) return;

    safeSetIsLoading(true);
    safeSetResult('');
    setValidationErrors([]);

    try {
      const words = inputText.trim().split(/\s+/).filter(word => !stopWords.has(word.toLowerCase()));
      if (words.length === 0) {
        setValidationErrors(['Please enter search terms']);
        return;
      }

      const results = await processWords(words);
      
      if (!results) {
        throw new Error('Failed to process search terms');
      }

      // Get the result for the selected mode and apply field replacement if needed
      const searchString = results[mode];
      const finalResult = replaceSearchField(searchString, selectedField);
      
      // Add CC to the search result
      const resultWithCC = `${finalResult} AND CC=${selectedCC}`;
      
      safeSetResult(resultWithCC);
      safeSetSearchHistory(prev => [...prev, inputText]);

    } catch (error) {
      console.error('Error generating search:', error);
      setValidationErrors(['Error generating search terms']);
    } finally {
      safeSetIsLoading(false);
    }
  }, [inputText, processWords, safeSetResult, safeSetSearchHistory, safeSetIsLoading, selectedField, selectedCC]);

  return {
    inputText,
    setInputText,
    words,
    searchSystem,
    setSearchSystem,
    selectedField,
    setSelectedField,
    selectedCC,
    setSelectedCC,
    customSynonyms,
    setCustomSynonyms,
    result,
    setResult,
    validationErrors,
    setValidationErrors,
    searchHistory,
    setSearchHistory,
    useTruncation,
    setUseTruncation,
    wordType,
    setWordType,
    synonymInput,
    setSynonymInput,
    synonymResults,
    setSynonymResults,
    isLoading,
    setIsLoading,
    searchInput,
    setSearchInput,
    searchResult,
    setSearchResult,
    searchTerms,
    handleInputChange,
    handleGenerateSearch,
    copyToClipboard
  };
};

export default useBooleanSearchState;
