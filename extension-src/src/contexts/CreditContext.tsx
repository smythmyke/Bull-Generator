import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuthContext } from './AuthContext';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { app } from '../firebaseConfig';
import {
  initCredits as initCreditsApi,
  createCreditCheckout,
  createSubscriptionCheckout,
  createCustomerPortalSession,
  CreditBalance,
} from '../services/creditService';

interface CreditContextType {
  credits: CreditBalance | null;
  isLoading: boolean;
  error: string | null;
  canSearch: boolean;
  hasSubscription: boolean;
  isFreeUser: boolean;
  refreshBalance: () => Promise<void>;
  purchaseCredits: (packId: string) => Promise<void>;
  purchaseSubscription: (planId: string) => Promise<void>;
  openCustomerPortal: () => Promise<void>;
  clearError: () => void;
  /** Update local balance after server-side deduction */
  applyDeduction: (newBalance: number) => void;
}

const CreditContext = createContext<CreditContextType>({
  credits: null,
  isLoading: true,
  error: null,
  canSearch: false,
  hasSubscription: false,
  isFreeUser: true,
  refreshBalance: async () => {},
  purchaseCredits: async () => {},
  purchaseSubscription: async () => {},
  openCustomerPortal: async () => {},
  clearError: () => {},
  applyDeduction: () => {},
});

export const useCreditContext = () => useContext(CreditContext);

function parseBalanceFromSnapshot(data: Record<string, any>): CreditBalance {
  const subCredits = data.subscriptionCredits || 0;
  // Backward compat: old docs only have flat `balance`
  const topCredits = data.topupCredits ?? data.balance ?? 0;
  const sub = data.subscription || null;

  return {
    balance: subCredits + topCredits,
    subscriptionCredits: subCredits,
    topupCredits: topCredits,
    freeCreditsGranted: data.freeCreditsGranted || data.starterCredited || false,
    totalUsed: data.totalUsed || 0,
    totalPurchased: data.totalPurchased || 0,
    subscription: sub ? {
      planId: sub.planId,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      monthlyAllocation: sub.monthlyAllocation,
    } : null,
  };
}

export const CreditProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuthContext();
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real-time Firestore listener on credits/{uid}
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setCredits(null);
      setIsLoading(false);
      return;
    }

    const db = getFirestore(app);
    const unsubscribe = onSnapshot(
      doc(db, 'credits', user.uid),
      (snapshot) => {
        if (snapshot.exists()) {
          setCredits(parseBalanceFromSnapshot(snapshot.data()));
        } else {
          // No doc yet — initialize via API (grants starter credits)
          initCreditsApi().then((balance) => {
            setCredits(balance);
          }).catch(() => {
            // Fallback: show 5 starter credits optimistically
            setCredits({
              balance: 5,
              subscriptionCredits: 0,
              topupCredits: 5,
              freeCreditsGranted: false,
              totalUsed: 0,
              totalPurchased: 0,
              subscription: null,
            });
          });
        }
        setIsLoading(false);
      },
      (err) => {
        console.error('Error listening to credits:', err);
        refreshBalance().catch(() => {});
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isAuthenticated, user]);

  const hasSubscription = credits?.subscription?.status === 'active';
  const isFreeUser = (credits?.totalPurchased || 0) === 0 && !hasSubscription;
  const canSearch = credits !== null && credits.balance > 0;

  const refreshBalance = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const balance = await initCreditsApi();
      setCredits(balance);
    } catch (err) {
      console.error('Failed to refresh balance:', err);
    }
  }, [isAuthenticated]);

  const purchaseCredits = useCallback(async (packId: string) => {
    setError(null);
    try {
      const { url } = await createCreditCheckout(packId);
      window.open(url, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start checkout';
      setError(message);
      throw err;
    }
  }, []);

  const purchaseSubscription = useCallback(async (planId: string) => {
    setError(null);
    try {
      const { url } = await createSubscriptionCheckout(planId);
      window.open(url, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start subscription checkout';
      setError(message);
      throw err;
    }
  }, []);

  const openCustomerPortal = useCallback(async () => {
    setError(null);
    try {
      const { url } = await createCustomerPortalSession();
      window.open(url, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open billing portal';
      setError(message);
      throw err;
    }
  }, []);

  const applyDeduction = useCallback((newBalance: number) => {
    setCredits((prev) => {
      if (!prev) return prev;
      // Approximate: we don't know exact pool split, but total is authoritative
      const diff = prev.balance - newBalance;
      const subDeduct = Math.min(prev.subscriptionCredits, diff);
      return {
        ...prev,
        balance: newBalance,
        subscriptionCredits: prev.subscriptionCredits - subDeduct,
        topupCredits: prev.topupCredits - (diff - subDeduct),
      };
    });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = {
    credits,
    isLoading,
    error,
    canSearch,
    hasSubscription,
    isFreeUser,
    refreshBalance,
    purchaseCredits,
    purchaseSubscription,
    openCustomerPortal,
    clearError,
    applyDeduction,
  };

  return (
    <CreditContext.Provider value={value}>
      {children}
    </CreditContext.Provider>
  );
};

export default CreditContext;
