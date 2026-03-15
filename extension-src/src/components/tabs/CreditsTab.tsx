import React, { useEffect, useState } from 'react';
import { useCreditContext } from '../../contexts/CreditContext';
import { getPurchaseHistory, PurchaseRecord } from '../../services/creditService';
import { Button } from '../ui/button';

const PACKS = [
  { id: 'pack_10', credits: 10, price: '$2.00', perCredit: '$0.20', badge: null },
  { id: 'pack_25', credits: 25, price: '$4.50', perCredit: '$0.18', badge: 'Most Popular' as const },
  { id: 'pack_50', credits: 50, price: '$8.00', perCredit: '$0.16', badge: null },
  { id: 'pack_100', credits: 100, price: '$15.00', perCredit: '$0.15', badge: 'Best Value' as const },
];

const BADGE_STYLES: Record<string, string> = {
  'Most Popular': 'bg-gradient-to-r from-blue-500 to-purple-500 text-white',
  'Best Value': 'bg-gradient-to-r from-amber-500 to-orange-500 text-white',
};

const CreditsTab: React.FC = () => {
  const { credits, purchaseCredits } = useCreditContext();
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
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

  const handleBuy = async (packId: string) => {
    setLoadingPack(packId);
    setPurchaseError(null);
    try {
      await purchaseCredits(packId);
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setLoadingPack(null);
    }
  };

  const balance = credits?.balance ?? 0;

  const availableColor = balance >= 3
    ? 'text-green-700'
    : balance >= 1
      ? 'text-yellow-700'
      : 'text-red-700';

  return (
    <div className="space-y-4">
      {/* A. Balance Overview */}
      <div className="grid grid-cols-2 gap-2">
        <div className="border rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Available</div>
          <div className={`text-xl font-bold ${availableColor}`}>{balance}</div>
          <div className="text-[10px] text-muted-foreground">credits</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Used</div>
          <div className="text-xl font-bold">{credits?.totalUsed ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">lifetime</div>
        </div>
      </div>

      {/* B. Purchase Packs */}
      <div>
        <h3 className="text-xs font-semibold mb-2">Purchase Search Credits</h3>
        <div className="grid grid-cols-2 gap-2">
          {PACKS.map((pack) => (
            <div
              key={pack.id}
              className="relative border rounded-lg p-3 text-center space-y-1.5 hover:border-primary/50 transition-colors"
            >
              {pack.badge && (
                <span className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${BADGE_STYLES[pack.badge]}`}>
                  {pack.badge}
                </span>
              )}
              <div className="text-lg font-bold">{pack.credits}</div>
              <div className="text-xs text-muted-foreground">credits</div>
              <div className="text-sm font-semibold text-primary">{pack.price}</div>
              <div className="text-[10px] text-muted-foreground">{pack.perCredit}/credit</div>
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => handleBuy(pack.id)}
                disabled={loadingPack !== null}
              >
                {loadingPack === pack.id ? (
                  <span className="flex items-center gap-1">
                    <span className="animate-spin rounded-full h-3 w-3 border-b border-white" />
                    Opening...
                  </span>
                ) : (
                  'Buy'
                )}
              </Button>
            </div>
          ))}
        </div>
        {purchaseError && <p className="text-xs text-red-600 text-center mt-2">{purchaseError}</p>}
      </div>

      {/* C. Purchase History */}
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
