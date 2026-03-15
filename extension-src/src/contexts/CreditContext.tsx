import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuthContext } from './AuthContext';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { app } from '../firebaseConfig';
import {
  getCreditBalance,
  createCreditCheckout,
  CreditBalance,
} from '../services/creditService';

interface CreditContextType {
  credits: CreditBalance | null;
  isLoading: boolean;
  error: string | null;
  canSearch: boolean;
  refreshBalance: () => Promise<void>;
  purchaseCredits: (packId: string) => Promise<void>;
  clearError: () => void;
  /** Update local balance after server-side deduction */
  applyDeduction: (newBalance: number) => void;
}

const CreditContext = createContext<CreditContextType>({
  credits: null,
  isLoading: true,
  error: null,
  canSearch: false,
  refreshBalance: async () => {},
  purchaseCredits: async () => {},
  clearError: () => {},
  applyDeduction: () => {},
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
          setCredits({
            balance: data.balance || 0,
            totalUsed: data.totalUsed || 0,
          });
        } else {
          // No doc yet = fresh user, server will create with starter credits on first call
          setCredits({
            balance: 5,
            totalUsed: 0,
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

  const canSearch = credits !== null && credits.balance > 0;

  const refreshBalance = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const balance = await getCreditBalance();
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

  const applyDeduction = useCallback((newBalance: number) => {
    setCredits((prev) => {
      if (!prev) return prev;
      return { ...prev, balance: newBalance };
    });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = {
    credits,
    isLoading,
    error,
    canSearch,
    refreshBalance,
    purchaseCredits,
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
