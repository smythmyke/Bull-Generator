import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Languages, Gavel, ExternalLink } from 'lucide-react';
import SynonymSearch from '../SynonymSearch';
import DefinitionsTab from '../DefinitionsTab';

// Company litigation can return many rows, so it opens a full-tab report
// (report.html) rather than cramming results into the side panel.
function openCompanyLitigation(): void {
  const url = chrome.runtime.getURL('report.html?workflow=company-litigation');
  chrome.tabs.create({ url });
}

const ToolsTab: React.FC = () => {
  const [synonymsOpen, setSynonymsOpen] = useState(true);
  const [definitionsOpen, setDefinitionsOpen] = useState(false);

  return (
    <div className="space-y-2">
      {/* Company Litigation Lookup — opens a full-tab report (top of Tools) */}
      <button
        onClick={openCompanyLitigation}
        className="w-full text-left border rounded-lg px-3 py-2 hover:bg-muted/30 hover:border-blue-300 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-medium">
          <Gavel className="h-3.5 w-3.5 text-blue-600" />
          Company Litigation Lookup
          <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600">
            <ExternalLink className="h-2.5 w-2.5" /> Open report
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Every district-court patent suit a company has been in — opens a full-tab report.
        </p>
      </button>

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
