import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';
import { ScoreBreakdown } from '../utils/scoringUtils';

interface ScoreTooltipProps {
  score: number;
  breakdown: ScoreBreakdown;
  badgeClassName: string;
}

const SIGNAL_LABELS: { key: keyof Omit<ScoreBreakdown, 'final'>; label: string; weight: number }[] = [
  { key: 'aiSemantic', label: 'AI Semantic', weight: 25 },
  { key: 'termFrequency', label: 'Term Frequency', weight: 15 },
  { key: 'titleHits', label: 'Title Hits', weight: 15 },
  { key: 'coverage', label: 'Coverage', weight: 15 },
  { key: 'proximity', label: 'Proximity', weight: 10 },
  { key: 'claimPresence', label: 'Claim Presence', weight: 10 },
  { key: 'multiSource', label: 'Multi-Source', weight: 5 },
  { key: 'cpcRelevance', label: 'CPC Relevance', weight: 5 },
];

function getBarColor(score: number): string {
  if (score >= 70) return 'bg-green-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-red-400';
}

const ScoreTooltip: React.FC<ScoreTooltipProps> = ({ score, breakdown, badgeClassName }) => {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white cursor-help ${badgeClassName}`}>
            {score}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="p-0 w-64">
          <div className="p-3">
            <div className="text-xs font-semibold mb-2">Score Breakdown</div>
            <div className="space-y-1.5">
              {SIGNAL_LABELS.map(({ key, label, weight }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${getBarColor(breakdown[key])}`}
                      style={{ width: `${breakdown[key]}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono w-8 text-right">{breakdown[key]}</span>
                  <span className="text-xs text-muted-foreground w-8 text-right">{weight}%</span>
                </div>
              ))}
            </div>
            <div className="border-t mt-2 pt-2 flex items-center justify-between">
              <span className="text-xs font-semibold">Final Score</span>
              <span className="text-sm font-bold">{breakdown.final}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ScoreTooltip;
