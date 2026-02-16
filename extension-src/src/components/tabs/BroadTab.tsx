import React, { useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { AlertTriangle, Copy } from 'lucide-react';
import { LoadingSpinner } from '../ui/loading-spinner';
import { Label } from '../ui/label';
import { handleKeyPress } from '../booleanSearchUtils';
import useBooleanSearchState from '../../hooks/useBooleanSearchState';
import { fields } from '../BooleanSearchGenerator';
import { SearchResult } from '../SearchResult';

const BroadTab = () => {
  const isMounted = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const {
    inputText,
    setInputText,
    selectedField,
    setSelectedField,
    validationErrors,
    isLoading,
    result,
    searchTerms,
    handleInputChange,
    handleGenerateSearch,
    copyToClipboard
  } = useBooleanSearchState();

  useEffect(() => {
    return () => {
      isMounted.current = false;
      // Clean up any content in the tab
      if (contentRef.current) {
        contentRef.current.innerHTML = '';
      }
    };
  }, []);

  const handleLocalInputChange = (value: string) => {
    if (isMounted.current) {
      handleInputChange(value);
    }
  };

  const handleLocalGenerateSearch = () => {
    if (isMounted.current) {
      handleGenerateSearch('broad');
    }
  };

  return (
    <div className="space-y-4" ref={contentRef}>
      <div className="space-y-2">
        <Alert className="bg-blue-50 border-blue-200">
          <AlertDescription className="text-blue-700">
            Enter terms to generate a broad boolean search. Each term will be expanded with 3-4 synonyms for comprehensive results.
          </AlertDescription>
        </Alert>

        <div className="flex space-x-2">
          <Select value={selectedField} onValueChange={setSelectedField}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Field" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(fields).map((field: string) => (
                <SelectItem key={field} value={field}>{field}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={inputText}
            onChange={(e) => handleLocalInputChange(e.target.value)}
            onKeyPress={(e) => handleKeyPress(e, handleLocalGenerateSearch)}
            placeholder="Enter search terms..."
            className="flex-1"
          />
        </div>
      </div>

      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {validationErrors.map((error: string, i: number) => (
              <div key={i}>{error}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleLocalGenerateSearch}
        className="w-full"
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <LoadingSpinner className="mr-2" />
            Generating...
          </>
        ) : (
          'Generate Broad Search'
        )}
      </Button>

      {!isLoading && result && (
        <div className="mt-4 p-4 bg-gray-100 rounded relative">
          <div className="absolute top-2 right-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(result)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Label>Generated Search:</Label>
          <SearchResult result={result} />
          
          {/* Display search terms and synonyms */}
          <div className="mt-4">
            <Label className="text-sm font-semibold">Search Terms and Synonyms:</Label>
            {searchTerms.map((term: { word: string, synonyms: string[] }, index: number) => (
              <div key={index} className="mt-2 p-2 bg-white rounded">
                <span className="font-medium">{term.word}:</span>{' '}
                <span className="text-gray-600">{term.synonyms.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BroadTab;
