import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Copy } from 'lucide-react';
import { SearchResultSkeleton } from '../ui/skeleton';
import { SearchResult } from '../SearchResult';
import { analyzeParagraph } from '../../services/airagraphService';
import { copyToClipboard } from '../booleanSearchUtils';

const AIragraphTab: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [selectedCC, setSelectedCC] = useState('US');
  const [localConcepts, setLocalConcepts] = useState<string[]>([]);
  const [localTerms, setLocalTerms] = useState<string[]>([]);
  const [localResult, setLocalResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleGenerateSearch = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    try {
      const response = await analyzeParagraph(inputText.trim());
      setLocalResult(response.search);
      setLocalConcepts(response.concepts);
      setLocalTerms(response.terms);
    } catch (error) {
      console.error('Error analyzing paragraph:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formattedResult = localResult ? `${localResult} AND CC=${selectedCC}` : '';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="paragraph-input" className="text-xs">Enter Paragraph or Concepts</Label>
        <Textarea
          id="paragraph-input"
          placeholder="Enter a paragraph, sentences, or concepts to analyze..."
          value={inputText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
          className="min-h-[120px] text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
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
          </SelectContent>
        </Select>

        <Button
          onClick={handleGenerateSearch}
          disabled={isLoading || !inputText.trim()}
          className="flex-1"
          size="sm"
        >
          {isLoading ? 'Analyzing...' : 'Analyze & Generate'}
        </Button>
      </div>

      {isLoading && <SearchResultSkeleton />}

      {localResult && !isLoading && (
        <div className="space-y-3">
          <div className="border rounded-lg p-3 bg-blue-50 border-blue-200">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold">Generated Search</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => handleCopy(formattedResult, 'search')}
              >
                <Copy className="h-3 w-3 mr-1" />
                <span className="text-xs">
                  {copiedField === 'search' ? 'Copied!' : 'Copy'}
                </span>
              </Button>
            </div>
            <SearchResult result={formattedResult} />
          </div>

          {localConcepts.length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <Label className="text-xs font-semibold">Extracted Concepts</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {localConcepts.map((concept, index) => (
                  <span key={index} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {concept}
                  </span>
                ))}
              </div>
            </div>
          )}

          {localTerms.length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <Label className="text-xs font-semibold">Terms & Synonyms</Label>
              <div className="mt-1 space-y-1">
                {localTerms.map((term, index) => (
                  <div key={index} className="text-xs text-muted-foreground">{term}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AIragraphTab;
