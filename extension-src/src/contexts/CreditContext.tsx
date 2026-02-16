import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuthContext } from './AuthContext';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { app } from '../firebaseConfig';
import {
  getCreditBalance,
  useCredit as useCreditAPI,
  createCreditCheckout,
  CreditBalance,
  UseResult,
} from '../services/creditService';

const FREE_DAILY_LIMIT = 5;

interface CreditContextType {
  credits: CreditBalance | null;
  isLoading: boolean;
  error: string | null;
  canSearch: boolean;
  useCredit: (action: string, amount?: number) => Promise<UseResult>;
  purchaseCredits: (packId: string) => Promise<void>;
  refreshBalance: () => Promise<void>;
  clearError: () => void;
}

const CreditContext = createContext<CreditContextType>({
  credits: null,
  isLoading: true,
  error: null,
  canSearch: false,
  useCredit: async () => ({ source: 'free', remaining: 0, freeSearchesRemaining: 0 }),
  purchaseCredits: async () => {},
  refreshBalance: async () => {},
  clearError: () => {},
});

export const useCreditContext = () => useContext(CreditContext);

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
          const data = snapshot.data();
          const today = new Date().toISOString().slice(0, 10);
          const freeUsed = data.freeSearchDate === today ? (data.freeSearchesUsed || 0) : 0;

          setCredits({
            balance: data.balance || 0,
            freeSearchesRemaining: Math.max(0, FREE_DAILY_LIMIT - freeUsed),
            freeSearchesUsed: freeUsed,
            totalUsed: data.totalUsed || 0,
          });
        } else {
          // No doc yet = fresh user with full free tier
          setCredits({
            balance: 0,
            freeSearchesRemaining: FREE_DAILY_LIMIT,
            freeSearchesUsed: 0,
            totalUsed: 0,
          });
        }
        setIsLoading(false);
      },
      (err) => {
        console.error('Error listening to credits:', err);
        // Fallback: fetch via API
        refreshBalance().catch(() => {});
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isAuthenticated, user]);

  const canSearch = credits !== null && (credits.freeSearchesRemaining > 0 || credits.balance > 0);

  const refreshBalance = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const balance = await getCreditBalance();
      setCredits(balance);
    } catch (err) {
      console.error('Failed to refresh balance:', err);
    }
  }, [isAuthenticated]);

  const handleUseCredit = useCallback(async (action: string, amount: number = 1): Promise<UseResult> => {
    setError(null);
    try {
      const result = await useCreditAPI(action, amount);
      // Update local state immediately (Firestore listener will also update)
      setCredits((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          balance: result.remaining,
          freeSearchesRemaining: result.freeSearchesRemaining,
          freeSearchesUsed: result.source === 'free'
            ? prev.freeSearchesUsed + amount
            : prev.freeSearchesUsed,
          totalUsed: prev.totalUsed + amount,
        };
      });
      return result;
    } catch (err: any) {
      if (err.status === 402) {
        setError('No searches remaining. Purchase credits to continue.');
      } else {
        setError(err.message || 'Failed to use credit');
      }
      throw err;
    }
  }, []);

  const purchaseCredits = useCallback(async (packId: string) => {
    setError(null);
    try {
      const { url } = await createCreditCheckout(packId);
      // Open checkout in new tab
      window.open(url, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start checkout';
      setError(message);
      throw err;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = {
    credits,
    isLoading,
    error,
    canSearch,
    useCredit: handleUseCredit,
    purchaseCredits,
    refreshBalance,
    clearError,
  };

  return (
    <CreditContext.Provider value={value}>
      {children}
    </CreditContext.Provider>
  );
};

export default CreditContext;
