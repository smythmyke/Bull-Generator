import { useState, useCallback, useRef, useEffect } from 'react';
import { getSynonyms } from '../services/synonymService';

const useSynonymLookup = () => {
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const lookupSynonyms = useCallback(async (word: string): Promise<string[]> => {
    console.log('Looking up synonyms for word:', word);
    
    if (!word.trim()) {
      return [];
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await getSynonyms(word.trim());
      console.log('Received synonyms:', results);
      
      if (isMounted.current) {
        setSynonyms(results);
        return results;
      }
    } catch (err) {
      if (isMounted.current) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred while getting synonyms';
        console.error('Error getting synonyms:', err);
        setError(errorMessage);
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }

    return [];
  }, []);

  const clearResults = useCallback(() => {
    console.log('Clearing synonym results and error');
    setSynonyms([]);
    setError(null);
  }, []);

  return { 
    lookupSynonyms,
    clearResults,
    synonyms,
    isLoading,
    error
  };
};

export default useSynonymLookup;
