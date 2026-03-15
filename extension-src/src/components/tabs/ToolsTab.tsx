import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Languages } from 'lucide-react';
import SynonymSearch from '../SynonymSearch';
import DefinitionsTab from '../DefinitionsTab';

const ToolsTab: React.FC = () => {
  const [synonymsOpen, setSynonymsOpen] = useState(true);
  const [definitionsOpen, setDefinitionsOpen] = useState(false);

  return (
    <div className="space-y-2">
      {/* Synonyms Section */}
      <div className="border rounded-lg overflow-hidden">
        <button
          onClick={() => setSynonymsOpen(!synonymsOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          {synonymsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Languages className="h-3.5 w-3.5 text-blue-500" />
          Synonym Finder
        </button>
        {synonymsOpen && (
          <div className="px-3 py-2">
            <SynonymSearch />
          </div>
        )}
      </div>

      {/* Definitions Section */}
      <div className="border rounded-lg overflow-hidden">
        <button
          onClick={() => setDefinitionsOpen(!definitionsOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          {definitionsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <BookOpen className="h-3.5 w-3.5 text-purple-500" />
          Technical Definitions
        </button>
        {definitionsOpen && (
          <div className="px-3 py-2">
            <DefinitionsTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolsTab;
