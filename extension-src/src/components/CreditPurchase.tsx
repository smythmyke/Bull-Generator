import React, { useState } from 'react';
import { useCreditContext } from '../contexts/CreditContext';
import { Button } from './ui/button';

interface CreditPurchaseProps {
  compact?: boolean;
}

const PLANS = [
  { id: 'searcher', name: 'Searcher', credits: 20, price: '$9', perCredit: '$0.45', rollover: null },
  { id: 'pro', name: 'Pro', credits: 60, price: '$19', perCredit: '$0.32', rollover: 30, badge: 'Popular' },
  { id: 'firm', name: 'Firm', credits: 150, price: '$39', perCredit: '$0.26', rollover: 75, badge: 'Best Value' },
];

const PACKS = [
  { id: 'pack_10', credits: 10, price: '$2.00', perCredit: '$0.20' },
  { id: 'pack_30', credits: 30, price: '$5.00', perCredit: '$0.17' },
  { id: 'pack_75', credits: 75, price: '$10.00', perCredit: '$0.13' },
];

const CreditPurchase: React.FC<CreditPurchaseProps> = ({ compact = false }) => {
  const { purchaseCredits, purchaseSubscription, openCustomerPortal, hasSubscription, credits } = useCreditContext();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentPlanId = credits?.subscription?.planId;

  const handleBuyPack = async (packId: string) => {
    setLoadingId(packId);
    setError(null);
    try {
      await purchaseCredits(packId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setLoadingId(null);
    }
  };

  const handleSubscribe = async (planId: string) => {
    setLoadingId(planId);
    setError(null);
    try {
      if (hasSubscription) {
        await openCustomerPortal();
      } else {
        await purchaseSubscription(planId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoadingId(null);
    }
  };

  // Compact mode: just show top-up packs (for InsufficientCreditsModal)
  if (compact) {
    return (
      <div className="space-y-1.5">
        {!hasSubscription && (
          <p className="text-[10px] text-muted-foreground text-center mb-1">
            Or <button onClick={() => handleSubscribe('pro')} className="text-primary underline font-medium">subscribe</button> for monthly credits
          </p>
        )}
        {PACKS.map((pack) => (
          <button
            key={pack.id}
            onClick={() => handleBuyPack(pack.id)}
            disabled={loadingId !== null}
            className="w-full flex items-center justify-between px-3 py-2 border rounded-lg hover:bg-secondary/50 transition-colors text-left disabled:opacity-50"
          >
            <div>
              <span className="text-sm font-semibold">{pack.credits} searches</span>
              <span className="text-xs text-muted-foreground ml-2">{pack.perCredit}/ea</span>
            </div>
            <span className="text-sm font-bold text-primary">
              {loadingId === pack.id ? '...' : pack.price}
            </span>
          </button>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Subscription Plans */}
      <div>
        <h3 className="text-xs font-semibold mb-2">Monthly Plans</h3>
        <div className="grid grid-cols-3 gap-2">
          {PLANS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative border rounded-lg p-2.5 text-center space-y-1 transition-colors ${
                  isCurrent ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
                }`}
              >
                {(plan as any).badge && !isCurrent && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-gradient-to-r from-blue-500 to-purple-500 text-white">
                    {(plan as any).badge}
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-green-500 text-white">
                    Current
                  </span>
                )}
                <div className="text-xs font-bold">{plan.name}</div>
                <div className="text-lg font-bold text-primary">{plan.price}<span className="text-[10px] font-normal text-muted-foreground">/mo</span></div>
                <div className="text-xs">{plan.credits} credits</div>
                {plan.rollover !== null && (
                  <div className="text-[9px] text-muted-foreground">up to {plan.rollover} rollover</div>
                )}
                <Button
                  size="sm"
                  variant={isCurrent ? 'outline' : 'default'}
                  className="w-full h-6 text-[10px]"
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={loadingId !== null}
                >
                  {loadingId === plan.id ? '...' : isCurrent ? 'Manage' : 'Subscribe'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted-foreground">Need more? Add credits anytime</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Top-Up Packs */}
      <div>
        <div className="grid grid-cols-3 gap-2">
          {PACKS.map((pack) => (
            <div
              key={pack.id}
              className="border rounded-lg p-2.5 text-center space-y-1 hover:border-primary/50 transition-colors"
            >
              <div className="text-lg font-bold">{pack.credits}</div>
              <div className="text-[10px] text-muted-foreground">credits</div>
              <div className="text-sm font-semibold text-primary">{pack.price}</div>
              <div className="text-[9px] text-muted-foreground">{pack.perCredit}/credit</div>
              <Button
                size="sm"
                className="w-full h-6 text-[10px]"
                onClick={() => handleBuyPack(pack.id)}
                disabled={loadingId !== null}
              >
                {loadingId === pack.id ? '...' : 'Buy'}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-600 text-center">{error}</p>}
      <p className="text-[9px] text-muted-foreground text-center">Quick searches are always free. 1 credit = 1 Pro search.</p>
    </div>
  );
};

export default CreditPurchase;
