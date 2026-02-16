import React, { useState } from 'react';
import useSynonymLookup from '../hooks/useSynonymLookup';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Copy } from 'lucide-react';
import { copyToClipboard } from './booleanSearchUtils';
import { SearchResultSkeleton } from './ui/skeleton';

const SynonymSearch: React.FC = () => {
  const [synonymInput, setSynonymInput] = useState('');
  const [copied, setCopied] = useState(false);
  const { lookupSynonyms, synonyms, isLoading, error } = useSynonymLookup();

  const handleSearch = async () => {
    if (!synonymInput.trim()) return;
    await lookupSynonyms(synonymInput);
  };

  const handleCopy = async () => {
    await copyToClipboard(synonyms.join(', '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          type="text"
          value={synonymInput}
          onChange={(e) => setSynonymInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Enter a word to find synonyms..."
          className="flex-1 text-sm"
          disabled={isLoading}
        />
        <Button
          onClick={handleSearch}
          disabled={isLoading || !synonymInput.trim()}
          size="sm"
        >
          {isLoading ? 'Finding...' : 'Find'}
        </Button>
      </div>

      {error && (
        <div className="text-destructive text-xs">{error}</div>
      )}

      {isLoading && <SearchResultSkeleton />}

      {synonyms.length > 0 && !isLoading && (
        <div className="border rounded-lg p-3 bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-semibold">
              Synonyms for "{synonymInput}"
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={handleCopy}
            >
              <Copy className="h-3 w-3 mr-1" />
              <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {synonyms.map((synonym, i) => (
              <span
                key={i}
                className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
              >
                {synonym}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SynonymSearch;
