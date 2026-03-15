import { useState, useCallback } from 'react';
import { useCreditContext } from '../contexts/CreditContext';

export function useCreditGate() {
  const { canSearch, refreshBalance } = useCreditContext();
  const [creditError, setCreditError] = useState<string | null>(null);
  const [showPurchasePrompt, setShowPurchasePrompt] = useState(false);

  /**
   * Pre-flight check + error handler for AI calls.
   * Server handles actual credit deduction.
   * Firestore listener updates local balance automatically.
   */
  const withCreditCheck = useCallback(
    async <T>(action: string, _amount: number, fn: () => Promise<T>): Promise<T | undefined> => {
      setCreditError(null);
      setShowPurchasePrompt(false);

      if (!canSearch) {
        setShowPurchasePrompt(true);
        setCreditError('No credits remaining. Purchase credits to continue.');
        return undefined;
      }

      try {
        return await fn();
      } catch (err: any) {
        if (err.status === 402) {
          setShowPurchasePrompt(true);
          setCreditError('No credits remaining. Purchase credits to continue.');
          refreshBalance();
        } else {
          setCreditError(err.message || 'Request failed');
        }
        return undefined;
      }
    },
    [canSearch, refreshBalance]
  );

  const dismissPurchasePrompt = useCallback(() => {
    setShowPurchasePrompt(false);
    setCreditError(null);
  }, []);

  return {
    checkingAction: null as string | null,
    creditError,
    showPurchasePrompt,
    canSearch,
    withCreditCheck,
    dismissPurchasePrompt,
  };
}
