import React, { useState } from 'react';
import { Workflow, Search, FileCheck, Shield, BarChart3, Clock, ShieldAlert } from 'lucide-react';
import RiskProfilePanel from '../RiskProfilePanel';

interface WorkflowCard {
  id: string;
  name: string;
  description: string;
  credits: string;
  icon: React.ReactNode;
  live?: boolean;
}

const WORKFLOWS: WorkflowCard[] = [
  {
    id: 'risk-profile',
    name: 'Patent Risk Profile',
    description: 'Patent number → instant risk verdict: validity challenges, litigation, status & term',
    credits: '~40 credits',
    icon: <ShieldAlert className="h-3.5 w-3.5 text-red-500" />,
    live: true,
  },
  {
    id: 'prior-art-hunter',
    name: 'Prior Art Hunter',
    description: 'Invention description → ranked prior art report with citations',
    credits: '~30 credits',
    icon: <Search className="h-3.5 w-3.5 text-blue-500" />,
  },
  {
    id: 'claim-analyzer',
    name: 'Claim Analyzer',
    description: 'Upload application → claim-by-claim novelty analysis',
    credits: '~50 credits',
    icon: <FileCheck className="h-3.5 w-3.5 text-purple-500" />,
  },
  {
    id: 'fto-check',
    name: 'Freedom-to-Operate',
    description: 'Product description → active-patent infringement risk matrix',
    credits: '~100 credits',
    icon: <Shield className="h-3.5 w-3.5 text-amber-500" />,
  },
  {
    id: 'tech-landscape',
    name: 'Technology Landscape',
    description: 'Technology area → top assignees, filing trends, white space',
    credits: '~200 credits',
    icon: <BarChart3 className="h-3.5 w-3.5 text-emerald-500" />,
  },
];

const WorkflowsTab: React.FC = () => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Workflow className="h-3.5 w-3.5 text-purple-500" />
          Workflows
        </div>
        <p className="mt-1 text-muted-foreground">
          One-shot deliverables for patent professionals. <b>Patent Risk Profile</b> is live; more agents arrive in future releases.
        </p>
      </div>

      <div className="space-y-1.5">
        {WORKFLOWS.map((wf) => {
          const expanded = expandedId === wf.id;
          return (
            <div key={wf.id} className={`rounded-lg border bg-card overflow-hidden ${wf.live ? '' : 'opacity-75'}`}>
              <button
                onClick={() => wf.live && setExpandedId(expanded ? null : wf.id)}
                disabled={!wf.live}
                className={`w-full text-left px-3 py-2 ${wf.live ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {wf.icon}
                  {wf.name}
                  {wf.live ? (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-green-700">
                      Live
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-amber-700">
                      <Clock className="h-2.5 w-2.5" />
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {wf.description}
                </p>
                <p className="mt-1.5 text-[10px] text-muted-foreground/80">
                  {wf.live ? 'Cost' : 'Planned cost'}: {wf.credits}
                </p>
              </button>
              {wf.live && expanded && <RiskProfilePanel />}
            </div>
          );
        })}
      </div>

      <div className="border-t pt-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Recent runs</div>
        <div className="rounded border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
          No runs yet
        </div>
      </div>
    </div>
  );
};

export default WorkflowsTab;
