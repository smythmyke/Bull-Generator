import { detectWordType, getWordVariations, optimizeSearch, validateSearch, getRootWord } from '../utils/searchUtils';
import { PorterStemmer } from '../utils/porterStemmer';
import { useState } from 'react';
import React from 'react';

export const copyToClipboard = async (text: string): Promise<void> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
      
      textArea.remove();
    }
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
};

// New function to add wildcards to words
const addWildcard = (word: string): string => {
  // Don't add wildcard to short words or words that already have wildcards
  if (word.length < 3 || word.includes('*')) {
    return word;
  }
  return word + '*';
};

// New function to process feature combinations
const processFeatureCombination = (words: string[], synonyms: Record<string, string[]>): string => {
  const processedWords = words.map(word => {
    const wordSynonyms = synonyms[word] || [];
    const allTerms = [addWildcard(word), ...wordSynonyms.map(addWildcard)];
    return `(${allTerms.join(' OR ')})`;
  });

  // Replace first AND with 3d
  return processedWords.join(' 3d ');
};

export const generateSearch = async (
  inputText: string,
  stopWords: Set<string>,
  wordType: 'auto' | 'verb' | 'noun' | 'spelling' | 'classification',
  useTruncation: boolean,
  selectedField: string,
  searchSystem: string,
  setValidationErrors: React.Dispatch<React.SetStateAction<string[]>>,
  setResult: React.Dispatch<React.SetStateAction<string>>,
  setSearchHistory: React.Dispatch<React.SetStateAction<string[]>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  getSynonyms: (word: string) => Promise<string[]>,
  fields: Record<string, string>,
  mode: 'broad' | 'moderate' | 'narrow'
): Promise<void> => {
  if (!inputText.trim()) {
    setValidationErrors(['Please enter search terms']);
    return;
  }

  setResult('');
  setValidationErrors([]);

  try {
    setIsLoading(true);
    
    // Split input into words and filter out stop words
    const words = inputText.trim().split(/\s+/).filter(word => !stopWords.has(word.toLowerCase()));
    
    // Get synonyms for all words
    const synonymMap: Record<string, string[]> = {};
    for (const word of words) {
      const synonyms = await getSynonyms(word);
      synonymMap[word] = synonyms.slice(0, 6); // Limit to 6 synonyms per word
    }

    let searchTerms = '';

    if (mode === 'moderate') {
      // Group words into pairs for feature combinations
      const features: string[][] = [];
      for (let i = 0; i < words.length; i += 2) {
        if (i + 1 < words.length) {
          features.push([words[i], words[i + 1]]);
        } else {
          features.push([words[i]]);
        }
      }

      // Process each feature combination
      const featureStrings = features.map(feature => processFeatureCombination(feature, synonymMap));
      
      // Join all feature combinations with AND
      searchTerms = featureStrings.join(' AND ');
    } else if (mode === 'narrow') {
      // Existing narrow search logic
      const processedTerms = await Promise.all(words.map(async (word) => {
        const synonyms = synonymMap[word] || [];
        const allTerms = [addWildcard(word), ...synonyms.map(addWildcard)];
        return `(${allTerms.join(' NEAR/3 ')})`;
      }));
      searchTerms = processedTerms.join(' AND ');
    } else {
      // Existing broad search logic
      const processedTerms = await Promise.all(words.map(async (word) => {
        const synonyms = synonymMap[word] || [];
        const allTerms = [addWildcard(word), ...synonyms.map(addWildcard)];
        return `(${allTerms.join(' OR ')})`;
      }));
      searchTerms = processedTerms.join(' AND ');
    }

    // Optimize search terms
    searchTerms = optimizeSearch(searchTerms, mode);

    const finalSearch = `${fields[selectedField]}${searchTerms}`;

    if (validateSearch(finalSearch, searchSystem, 'W', setValidationErrors)) {
      setResult(finalSearch);
      setSearchHistory(prev => [...prev, finalSearch]);
    }
  } catch (error) {
    setValidationErrors(['Error generating search terms']);
  } finally {
    setIsLoading(false);
  }
};

export const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>, action: () => void) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    action();
  }
};

export const renderSearchResult = (result: string) => {
  return (
    <p 
      className="mt-2 font-mono break-all"
      dangerouslySetInnerHTML={{ __html: result }}
    />
  );
};
