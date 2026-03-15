import React from 'react';
import { useCreditContext } from '../contexts/CreditContext';

const CreditDisplay: React.FC = () => {
  const { credits, isLoading } = useCreditContext();

  if (isLoading || !credits) return null;

  return (
    <div className="flex items-center gap-1.5">
      {credits.balance > 0 ? (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
          {credits.balance} credits
        </span>
      ) : (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
          0 credits
        </span>
      )}
    </div>
  );
};

export default CreditDisplay;
