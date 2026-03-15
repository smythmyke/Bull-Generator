import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useCreditContext } from '../contexts/CreditContext';
import CreditPurchase from './CreditPurchase';

interface InsufficientCreditsModalProps {
  onDismiss: () => void;
  creditsNeeded?: number;
}

const InsufficientCreditsModal: React.FC<InsufficientCreditsModalProps> = ({
  onDismiss,
  creditsNeeded = 1,
}) => {
  const { credits } = useCreditContext();
  const available = credits ? credits.balance : 0;

  return (
    <div className="border-2 border-red-300 rounded-lg p-3 bg-gradient-to-b from-red-50 to-white shadow-sm space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-red-800">No searches remaining</h3>
            <p className="text-xs text-red-600 mt-0.5">
              You've used all your credits. Purchase more to continue searching.
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-red-600 text-lg leading-none ml-2"
        >
          &times;
        </button>
      </div>

      {/* Needed vs Available */}
      <div className="flex items-center justify-center gap-3">
        <div className="flex-1 text-center border rounded-lg py-2 bg-white">
          <div className="text-lg font-bold text-red-600">{creditsNeeded}</div>
          <div className="text-[10px] text-muted-foreground">Needed</div>
        </div>
        <span className="text-muted-foreground text-xs font-medium">vs</span>
        <div className="flex-1 text-center border rounded-lg py-2 bg-white">
          <div className="text-lg font-bold text-red-600">{available}</div>
          <div className="text-[10px] text-muted-foreground">Available</div>
        </div>
      </div>

      <CreditPurchase compact />
    </div>
  );
};

export default InsufficientCreditsModal;
