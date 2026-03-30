import React, { useEffect, useState } from 'react';
import { useCreditContext } from '../../contexts/CreditContext';
import { getPurchaseHistory, PurchaseRecord } from '../../services/creditService';
import { Button } from '../ui/button';
import CreditPurchase from '../CreditPurchase';

const CreditsTab: React.FC = () => {
  const { credits, hasSubscription, openCustomerPortal } = useCreditContext();
  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    getPurchaseHistory()
      .then((records) => {
        if (!cancelled) setHistory(records);
      })
      .catch((err) => {
        console.warn('Failed to load purchase history:', err);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const balance = credits?.balance ?? 0;
  const subCredits = credits?.subscriptionCredits ?? 0;
  const topCredits = credits?.topupCredits ?? 0;

  const availableColor = balance >= 3
    ? 'text-green-700'
    : balance >= 1
      ? 'text-yellow-700'
      : 'text-red-700';

  return (
    <div className="space-y-4">
      {/* A. Balance Overview */}
      <div className="grid grid-cols-3 gap-2">
        <div className="border rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Subscription</div>
          <div className={`text-xl font-bold ${subCredits > 0 ? 'text-blue-600' : 'text-muted-foreground'}`}>{subCredits}</div>
          <div className="text-[10px] text-muted-foreground">credits</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Top-Up</div>
          <div className={`text-xl font-bold ${topCredits > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>{topCredits}</div>
          <div className="text-[10px] text-muted-foreground">credits</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Used</div>
          <div className="text-xl font-bold">{credits?.totalUsed ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">lifetime</div>
        </div>
      </div>

      {/* B. Subscription Status */}
      {hasSubscription && credits?.subscription && (
        <div className="border rounded-lg p-2.5 bg-blue-50/50 space-y-1.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold capitalize">{credits.subscription.planId}</span>
              <span className="text-[10px] text-muted-foreground ml-1.5">plan</span>
            </div>
            <span className="text-[10px] text-green-600 font-medium bg-green-100 px-1.5 py-0.5 rounded-full">Active</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {credits.subscription.monthlyAllocation} credits/mo
            {credits.subscription.currentPeriodEnd && (
              <> &middot; Renews {new Date(credits.subscription.currentPeriodEnd).toLocaleDateString()}</>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] w-full"
            onClick={() => openCustomerPortal()}
          >
            Manage Subscription
          </Button>
        </div>
      )}

      {/* Total balance summary */}
      <div className="border rounded-lg p-2 text-center">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Available</div>
        <div className={`text-2xl font-bold ${availableColor}`}>{balance}</div>
        <div className="text-[10px] text-muted-foreground">
          {subCredits > 0 && topCredits > 0
            ? `${subCredits} subscription + ${topCredits} top-up`
            : subCredits > 0 ? 'subscription credits'
            : topCredits > 0 ? 'top-up credits'
            : 'credits'}
        </div>
      </div>

      {/* C. Purchase / Subscribe */}
      <CreditPurchase />

      {/* D. Purchase History */}
      <div>
        <h3 className="text-xs font-semibold mb-2">Purchase History</h3>
        {historyLoading ? (
          <div className="text-xs text-muted-foreground text-center py-4">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4 border rounded-lg bg-muted/20">
            No purchases yet
          </div>
        ) : (
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {history.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between px-2 py-1.5 border rounded text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {record.date
                      ? new Date(record.date).toLocaleDateString()
                      : '—'}
                  </span>
                  <span className="font-medium">{record.packLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-600 font-semibold">+{record.credits}</span>
                  <span className="text-muted-foreground">
                    ${(record.amountPaid / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditsTab;
