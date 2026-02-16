import { useState, useCallback, useRef, useEffect } from 'react';
import { processBatchWithRetry } from '../services/groqService';
import { stopWords } from '../components/BooleanSearchGenerator';

interface TechnicalSynonyms {
  [key: string]: string[];
}

interface SearchResults {
  broad: string;
  moderate: string;
  narrow: string;
}

const useSynonyms = (technicalSynonyms: TechnicalSynonyms = {}, customSynonyms: Record<string, string[]> = {}) => {
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const processWords = useCallback(async (words: string[]): Promise<SearchResults | null> => {
    console.log('useSynonyms.processWords called with words:', words);
    
    // Filter out stop words and empty strings
    const validWords = words
      .map(word => word.toLowerCase().trim())
      .filter(word => word && !stopWords.has(word));

    console.log('Filtered valid words:', validWords);

    if (validWords.length === 0) {
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('Calling processBatchWithRetry with validWords:', validWords);
      // Process words in batches of 8
      const response = await processBatchWithRetry(validWords);
      console.log('Received response from processBatchWithRetry:', response);
      
      if (isMounted.current) {
        const results = {
          broad: response.broad,
          moderate: response.moderate,
          narrow: response.narrow
        };
        
        console.log('Setting search results:', results);
        setSearchResults(results);
        return results;
      } else {
        console.log('Component unmounted, not setting results');
      }
    } catch (err) {
      if (isMounted.current) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred while processing words';
        console.error('Error processing words:', err);
        setError(errorMessage);
      }
    } finally {
      if (isMounted.current) {
        console.log('Setting isLoading to false');
        setIsLoading(false);
      }
    }

    return null;
  }, []);

  const clearResults = useCallback(() => {
    console.log('Clearing search results and error');
    setSearchResults(null);
    setError(null);
  }, []);

  return { 
    processWords,
    clearResults,
    searchResults,
    isLoading,
    error
  };
};

export default useSynonyms;
