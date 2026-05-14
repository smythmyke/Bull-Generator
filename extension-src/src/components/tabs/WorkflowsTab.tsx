import React from 'react';
import { Workflow, Search, FileCheck, Shield, BarChart3, Clock } from 'lucide-react';

interface WorkflowCard {
  id: string;
  name: string;
  description: string;
  credits: string;
  icon: React.ReactNode;
}

const WORKFLOWS: WorkflowCard[] = [
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
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Workflow className="h-3.5 w-3.5 text-purple-500" />
          Workflows
          <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          One-shot deliverables for patent professionals. Each agent will open a full-tab report when launched. Workflows arrive in a future release.
        </p>
      </div>

      <div className="space-y-1.5">
        {WORKFLOWS.map((wf) => (
          <div
            key={wf.id}
            className="rounded-lg border bg-card px-3 py-2 opacity-75"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {wf.icon}
              {wf.name}
              <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-amber-700">
                <Clock className="h-2.5 w-2.5" />
                Coming soon
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {wf.description}
            </p>
            <p className="mt-1.5 text-[10px] text-muted-foreground/80">
              Planned cost: {wf.credits}
            </p>
          </div>
        ))}
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
