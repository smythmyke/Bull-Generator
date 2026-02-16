import { useState, useCallback } from 'react';
import { useCreditContext } from '../contexts/CreditContext';

export function useCreditGate() {
  const { useCredit, canSearch } = useCreditContext();
  const [checkingAction, setCheckingAction] = useState<string | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [showPurchasePrompt, setShowPurchasePrompt] = useState(false);

  const withCreditCheck = useCallback(
    async <T>(action: string, amount: number, fn: () => Promise<T>): Promise<T | undefined> => {
      setCheckingAction(action);
      setCreditError(null);
      setShowPurchasePrompt(false);

      try {
        await useCredit(action, amount);
        const result = await fn();
        return result;
      } catch (err: any) {
        if (err.status === 402) {
          setShowPurchasePrompt(true);
          setCreditError('No searches remaining. Purchase credits to continue.');
        } else {
          setCreditError(err.message || 'Credit check failed');
        }
        return undefined;
      } finally {
        setCheckingAction(null);
      }
    },
    [useCredit]
  );

  const dismissPurchasePrompt = useCallback(() => {
    setShowPurchasePrompt(false);
    setCreditError(null);
  }, []);

  return {
    checkingAction,
    creditError,
    showPurchasePrompt,
    canSearch,
    withCreditCheck,
    dismissPurchasePrompt,
  };
}
