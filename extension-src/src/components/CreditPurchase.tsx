import React, { useState } from 'react';
import { useCreditContext } from '../contexts/CreditContext';
import { Button } from './ui/button';

interface CreditPurchaseProps {
  compact?: boolean;
}

const PACKS = [
  { id: 'pack_10', credits: 10, price: '$2.00', perCredit: '$0.20' },
  { id: 'pack_25', credits: 25, price: '$4.50', perCredit: '$0.18' },
  { id: 'pack_50', credits: 50, price: '$8.00', perCredit: '$0.16' },
  { id: 'pack_100', credits: 100, price: '$15.00', perCredit: '$0.15' },
];

const CreditPurchase: React.FC<CreditPurchaseProps> = ({ compact = false }) => {
  const { purchaseCredits } = useCreditContext();
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBuy = async (packId: string) => {
    setLoadingPack(packId);
    setError(null);
    try {
      await purchaseCredits(packId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setLoadingPack(null);
    }
  };

  if (compact) {
    return (
      <div className="space-y-1.5">
        {PACKS.map((pack) => (
          <button
            key={pack.id}
            onClick={() => handleBuy(pack.id)}
            disabled={loadingPack !== null}
            className="w-full flex items-center justify-between px-3 py-2 border rounded-lg hover:bg-secondary/50 transition-colors text-left disabled:opacity-50"
          >
            <div>
              <span className="text-sm font-semibold">{pack.credits} searches</span>
              <span className="text-xs text-muted-foreground ml-2">{pack.perCredit}/ea</span>
            </div>
            <span className="text-sm font-bold text-primary">
              {loadingPack === pack.id ? '...' : pack.price}
            </span>
          </button>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Purchase Search Credits</h3>
      <div className="grid grid-cols-2 gap-2">
        {PACKS.map((pack) => (
          <div
            key={pack.id}
            className="border rounded-lg p-3 text-center space-y-1.5 hover:border-primary/50 transition-colors"
          >
            <div className="text-lg font-bold">{pack.credits}</div>
            <div className="text-xs text-muted-foreground">searches</div>
            <div className="text-sm font-semibold text-primary">{pack.price}</div>
            <div className="text-[10px] text-muted-foreground">{pack.perCredit}/search</div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => handleBuy(pack.id)}
              disabled={loadingPack !== null}
            >
              {loadingPack === pack.id ? 'Opening...' : 'Buy'}
            </Button>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-600 text-center">{error}</p>}
    </div>
  );
};

export default CreditPurchase;
