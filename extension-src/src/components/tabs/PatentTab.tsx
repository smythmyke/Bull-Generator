import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { FileText, ExternalLink } from 'lucide-react';

const PatentTab: React.FC = () => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <FileText className="h-3.5 w-3.5 text-blue-500" />
          Patent Dossier
          <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          Enter a patent number for a full report: family, citations, claims, status, classification, and AI summary.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="patent-number" className="text-xs">Patent number</Label>
        <Input
          id="patent-number"
          placeholder="e.g. US10123456 or EP3500001"
          className="h-8 text-xs"
          disabled
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <div className="font-medium">Status</div>
          <div className="opacity-60">—</div>
        </div>
        <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <div className="font-medium">Family</div>
          <div className="opacity-60">—</div>
        </div>
        <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <div className="font-medium">Claims</div>
          <div className="opacity-60">—</div>
        </div>
        <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <div className="font-medium">Cites</div>
          <div className="opacity-60">—</div>
        </div>
      </div>

      <Button disabled className="w-full h-8 text-xs" variant="default">
        <ExternalLink className="mr-1.5 h-3 w-3" />
        Open full dossier
      </Button>

      <div className="border-t pt-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Recent dossiers</div>
        <div className="rounded border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
          No dossiers yet
        </div>
      </div>
    </div>
  );
};

export default PatentTab;
