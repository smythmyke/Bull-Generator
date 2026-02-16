import React, { useState } from 'react';
import { Button } from './ui/button';
import { ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import type { CPCSuggestion, TerminologySwap, ConceptHealth } from '../services/apiService';

interface RefinementDashboardProps {
  roundNumber: number;
  patents: any[];
  cpcSuggestions: CPCSuggestion[];
  terminologySwaps: TerminologySwap[];
  conceptHealth: ConceptHealth[];
  selectedPatentIds: Set<string>;
  onTogglePatent: (id: string) => void;
  selectedCPCCodes: Set<string>;
  onToggleCPC: (code: string) => void;
  acceptedSwapIndices: Set<number>;
  onToggleSwap: (index: number) => void;
  onContinue: () => void;
  onCancel: () => void;
}

function CollapsibleSection({ title, defaultOpen = true, children }: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary/30 hover:bg-secondary/50 transition-colors"
      >
        <span className="text-xs font-semibold">{title}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

const RefinementDashboard: React.FC<RefinementDashboardProps> = ({
  roundNumber,
  patents,
  cpcSuggestions,
  terminologySwaps,
  conceptHealth,
  selectedPatentIds,
  onTogglePatent,
  selectedCPCCodes,
  onToggleCPC,
  acceptedSwapIndices,
  onToggleSwap,
  onContinue,
  onCancel,
}) => {
  const healthBarWidth = (count: number, max: number) => {
    if (max === 0) return 0;
    return Math.min(100, (count / max) * 100);
  };
  const maxMatch = Math.max(1, ...conceptHealth.map((c) => c.matchCount));

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Round {roundNumber} Results</h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="text-xs text-muted-foreground">
        {patents.length} patents found. Select items below to refine the next round.
      </div>

      {/* Concept Health */}
      {conceptHealth.length > 0 && (
        <CollapsibleSection title="Concept Health">
          <div className="space-y-1.5">
            {conceptHealth.map((ch, i) => {
              const statusColor = ch.status === 'strong'
                ? 'bg-green-500'
                : ch.status === 'weak'
                  ? 'bg-yellow-500'
                  : 'bg-red-400';
              const statusLabel = ch.status === 'strong'
                ? `strong (${ch.matchCount})`
                : ch.status === 'weak'
                  ? `weak (${ch.matchCount})`
                  : `missing (${ch.matchCount})`;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] w-28 truncate" title={ch.conceptName}>
                    {ch.conceptName}
                  </span>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${statusColor}`}
                      style={{ width: `${healthBarWidth(ch.matchCount, maxMatch)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-20 text-right">
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Top Patents for Similarity */}
      {patents.length > 0 && (
        <CollapsibleSection title={`Top Patents (select for similar) — ${selectedPatentIds.size} selected`}>
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {patents.slice(0, 15).map((p) => (
              <label
                key={p.patentId}
                className="flex items-start gap-2 py-1 cursor-pointer hover:bg-secondary/20 rounded px-1"
              >
                <button
                  onClick={() => onTogglePatent(p.patentId)}
                  className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition-colors ${
                    selectedPatentIds.has(p.patentId)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/30 bg-transparent'
                  }`}
                >
                  {selectedPatentIds.has(p.patentId) && <Check className="h-2.5 w-2.5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium truncate">{p.patentId}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{p.title}</div>
                </div>
              </label>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* CPC Codes */}
      {cpcSuggestions.length > 0 && (
        <CollapsibleSection title={`CPC Codes (by frequency) — ${selectedCPCCodes.size} selected`}>
          <div className="space-y-1 max-h-[150px] overflow-y-auto">
            {cpcSuggestions.map((cpc, i) => (
              <label
                key={i}
                className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-secondary/20 rounded px-1"
              >
                <button
                  onClick={() => onToggleCPC(cpc.code)}
                  className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    selectedCPCCodes.has(cpc.code)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/30 bg-transparent'
                  }`}
                >
                  {selectedCPCCodes.has(cpc.code) && <Check className="h-2.5 w-2.5" />}
                </button>
                <span className="text-[11px] font-mono">{cpc.code}</span>
                <span className="text-[10px] text-muted-foreground flex-1 truncate">— {cpc.label}</span>
                <span className="text-[10px] text-muted-foreground">({cpc.frequency})</span>
              </label>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Terminology Swaps */}
      {terminologySwaps.length > 0 && (
        <CollapsibleSection title="Terminology Swaps">
          <div className="space-y-1.5">
            {terminologySwaps.map((swap, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">"{swap.userTerm}"</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium flex-1 truncate" title={swap.patentTerms.join(', ')}>
                  "{swap.patentTerms[0]}"
                  {swap.patentTerms.length > 1 && <span className="text-muted-foreground"> +{swap.patentTerms.length - 1}</span>}
                </span>
                <span className="text-[10px] text-muted-foreground">({swap.frequency}x)</span>
                <button
                  onClick={() => onToggleSwap(i)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    acceptedSwapIndices.has(i)
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                  }`}
                >
                  {acceptedSwapIndices.has(i) ? 'Accepted' : 'Accept'}
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          onClick={onContinue}
          className="flex-1 h-9 text-sm font-semibold"
          size="sm"
        >
          Continue to Round {roundNumber + 1}
        </Button>
        <Button
          onClick={onCancel}
          variant="outline"
          className="h-9 text-sm"
          size="sm"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default RefinementDashboard;
