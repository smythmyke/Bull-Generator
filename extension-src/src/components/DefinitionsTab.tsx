import React, { useState } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { getDefinition } from '../services/definitionService';
import { SearchResultSkeleton } from './ui/skeleton';

const DefinitionsTab = () => {
  const [definitionInput, setDefinitionInput] = useState('');
  const [definition, setDefinition] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchDefinition = async () => {
    if (!definitionInput.trim()) return;

    setIsLoading(true);
    setDefinition(null);
    try {
      const result = await getDefinition(definitionInput.trim());
      setDefinition(result);
    } catch (error) {
      console.error('Error fetching definition:', error);
      setDefinition(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      fetchDefinition();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={definitionInput}
          onChange={(e) => setDefinitionInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a word to define..."
          className="flex-1 text-sm"
          disabled={isLoading}
        />
        <Button
          onClick={fetchDefinition}
          disabled={isLoading || !definitionInput.trim()}
          size="sm"
        >
          {isLoading ? 'Looking up...' : 'Define'}
        </Button>
      </div>

      {isLoading && <SearchResultSkeleton />}

      {definition && !isLoading && (
        <div className="border rounded-lg p-3 bg-muted/30">
          <Label className="text-xs font-semibold capitalize">{definitionInput}</Label>
          <p className="mt-1 text-sm text-muted-foreground">{definition}</p>
        </div>
      )}

      {definition === null && !isLoading && definitionInput && (
        <div className="text-xs text-muted-foreground">
          No definition found. Try a different term.
        </div>
      )}
    </div>
  );
};

export default DefinitionsTab;
