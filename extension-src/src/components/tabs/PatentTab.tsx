import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import {
  FileText,
  ExternalLink,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { fetchPatentDossier, PatentDossier, PatentStatus } from '../../services/apiService';
import { useCreditGate } from '../../hooks/useCreditGate';
import InsufficientCreditsModal from '../InsufficientCreditsModal';

const DOSSIER_CREDIT_COST = 3;
const RECENT_LIMIT = 5;

interface RecentEntry {
  patentNumber: string;
  title: string;
  status: PatentStatus;
}

function statusChipClass(status: PatentStatus): string {
  switch (status) {
    case 'active':
      return 'bg-green-50 border-green-200 text-green-700';
    case 'lapsed':
    case 'expired':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'pending':
      return 'bg-amber-50 border-amber-200 text-amber-700';
    default:
      return 'bg-muted/30 border-border text-muted-foreground';
  }
}

function statusIcon(status: PatentStatus): React.ReactNode {
  switch (status) {
    case 'active':
      return <CheckCircle2 className="h-3 w-3" />;
    case 'lapsed':
    case 'expired':
      return <XCircle className="h-3 w-3" />;
    case 'pending':
      return <Clock className="h-3 w-3" />;
    default:
      return null;
  }
}

const PatentTab: React.FC = () => {
  const [input, setInput] = useState('');
  const [dossier, setDossier] = useState<PatentDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const { showPurchasePrompt, withCreditCheck, dismissPurchasePrompt, creditError } =
    useCreditGate();

  const handleFetch = useCallback(
    async (numberToFetch?: string) => {
      const target = (numberToFetch ?? input).trim();
      if (!target) return;
      setError(null);

      await withCreditCheck('patent-dossier', DOSSIER_CREDIT_COST, async () => {
        setLoading(true);
        try {
          const result = await fetchPatentDossier(target);
          setDossier(result);
          setRecents((prev) => {
            const entry: RecentEntry = {
              patentNumber: result.patentNumber,
              title: result.header.title,
              status: result.header.status,
            };
            const without = prev.filter((r) => r.patentNumber !== entry.patentNumber);
            return [entry, ...without].slice(0, RECENT_LIMIT);
          });
          return result;
        } finally {
          setLoading(false);
        }
      });
    },
    [input, withCreditCheck]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleFetch();
    },
    [handleFetch]
  );

  const familyCount = dossier?.family.members.length ?? 0;
  const claimCount = dossier?.claims.totalCount ?? 0;
  const forwardCount = dossier?.citations.forwardCount ?? 0;
  const backwardCount = dossier?.citations.backwardCount ?? 0;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <FileText className="h-3.5 w-3.5 text-blue-500" />
          Patent Dossier
          <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground">
            3 credits / patent
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          Enter a patent number for a quick summary. Open the full dossier for the complete report.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-1.5">
        <Label htmlFor="patent-number" className="text-xs">
          Patent number
        </Label>
        <div className="flex gap-1.5">
          <Input
            id="patent-number"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. US10867416B2 or EP3500001"
            className="h-8 text-xs"
            disabled={loading}
          />
          <Button
            type="submit"
            size="sm"
            className="h-8 text-xs px-3"
            disabled={loading || !input.trim()}
          >
            <Search className="mr-1 h-3 w-3" />
            {loading ? '...' : 'Fetch'}
          </Button>
        </div>
      </form>

      {(error || creditError) && !showPurchasePrompt && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-3 w-3" />
          <AlertDescription className="text-xs">{error || creditError}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="rounded border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground animate-pulse">
          Fetching dossier...
        </div>
      )}

      {dossier && !loading && (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <div className="text-[11px] font-mono text-blue-600">{dossier.patentNumber}</div>
            <div className="text-xs font-medium leading-snug">{dossier.header.title}</div>
            {dossier.header.currentAssignee && (
              <div className="text-[11px] text-muted-foreground">
                {dossier.header.currentAssignee}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div
              className={`rounded border px-2 py-1.5 text-[10px] flex items-center gap-1 ${statusChipClass(
                dossier.header.status
              )}`}
            >
              {statusIcon(dossier.header.status)}
              <div>
                <div className="font-medium leading-tight">Status</div>
                <div className="leading-tight">{dossier.header.statusLabel}</div>
              </div>
            </div>
            <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
              <div className="font-medium">Family</div>
              <div>
                {familyCount} {familyCount === 1 ? 'member' : 'members'}
              </div>
            </div>
            <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
              <div className="font-medium">Claims</div>
              <div>
                {claimCount} ({dossier.claims.independentNumbers.length} indep)
              </div>
            </div>
            <div className="rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
              <div className="font-medium">Citations</div>
              <div>
                {forwardCount}↓ &nbsp; {backwardCount}↑
              </div>
            </div>
          </div>

          {dossier.cached && (
            <div className="text-[10px] text-muted-foreground italic">
              Loaded from cache (no credits used)
            </div>
          )}

          <Button
            variant="default"
            className="w-full h-8 text-xs"
            onClick={() => {
              const url = chrome.runtime.getURL(
                `patent.html?number=${encodeURIComponent(dossier.patentNumber)}`
              );
              chrome.tabs.create({ url });
            }}
          >
            <ExternalLink className="mr-1.5 h-3 w-3" />
            Open full dossier
          </Button>
        </div>
      )}

      {recents.length > 0 && (
        <div className="border-t pt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Recent dossiers</div>
          <div className="space-y-1">
            {recents.map((r) => (
              <button
                key={r.patentNumber}
                onClick={() => {
                  setInput(r.patentNumber);
                  handleFetch(r.patentNumber);
                }}
                className="w-full text-left rounded border bg-card hover:bg-muted/40 px-2 py-1.5 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-blue-600">
                    {r.patentNumber}
                  </span>
                  <span className="ml-auto">
                    <span
                      className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] border ${statusChipClass(
                        r.status
                      )}`}
                    >
                      {statusIcon(r.status)}
                      {r.status}
                    </span>
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground line-clamp-1 leading-snug">
                  {r.title || '—'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!dossier && !loading && recents.length === 0 && (
        <div className="border-t pt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Recent dossiers</div>
          <div className="rounded border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
            No dossiers yet
          </div>
        </div>
      )}

      {showPurchasePrompt && (
        <InsufficientCreditsModal
          onDismiss={dismissPurchasePrompt}
          creditsNeeded={DOSSIER_CREDIT_COST}
        />
      )}
    </div>
  );
};

export default PatentTab;
