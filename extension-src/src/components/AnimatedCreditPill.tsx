import React, { useEffect, useRef, useState } from 'react';
import { useCreditContext } from '../contexts/CreditContext';

interface FloatingNumber {
  id: number;
  value: number;
  type: 'add' | 'subtract';
}

let floatId = 0;

interface AnimatedCreditPillProps {
  onClick?: () => void;
}

const AnimatedCreditPill: React.FC<AnimatedCreditPillProps> = ({ onClick }) => {
  const { credits, isLoading } = useCreditContext();
  const [floats, setFloats] = useState<FloatingNumber[]>([]);
  const [bumping, setBumping] = useState(false);
  const prevTotal = useRef<number | null>(null);
  const isInitial = useRef(true);

  const totalAvailable = credits
    ? credits.freeSearchesRemaining + credits.balance
    : 0;

  useEffect(() => {
    if (credits === null) return;

    const currentTotal = credits.freeSearchesRemaining + credits.balance;

    if (isInitial.current) {
      prevTotal.current = currentTotal;
      isInitial.current = false;
      return;
    }

    if (prevTotal.current !== null && prevTotal.current !== currentTotal) {
      const diff = currentTotal - prevTotal.current;

      // Floating number
      const id = ++floatId;
      setFloats((prev) => [
        ...prev,
        { id, value: Math.abs(diff), type: diff > 0 ? 'add' : 'subtract' },
      ]);
      setTimeout(() => {
        setFloats((prev) => prev.filter((f) => f.id !== id));
      }, 2000);

      // Bump
      setBumping(true);
      setTimeout(() => setBumping(false), 300);
    }

    prevTotal.current = currentTotal;
  }, [credits]);

  if (isLoading || !credits) return null;

  // Color states
  let colorClasses: string;
  if (totalAvailable >= 3) {
    colorClasses = 'bg-green-100 text-green-700 border-green-300';
  } else if (totalAvailable >= 1) {
    colorClasses = 'bg-yellow-100 text-yellow-700 border-yellow-300';
  } else {
    colorClasses = 'bg-red-100 text-red-700 border-red-300';
  }

  // Display text
  let displayText: string;
  if (totalAvailable === 0) {
    displayText = '0 searches';
  } else {
    const parts: string[] = [];
    if (credits.freeSearchesRemaining > 0) {
      parts.push(`${credits.freeSearchesRemaining} free`);
    }
    if (credits.balance > 0) {
      parts.push(`${credits.balance} credits`);
    }
    displayText = parts.join(' · ') || '0 searches';
  }

  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer transition-transform ${colorClasses} ${bumping ? 'animate-credit-bump' : ''}`}
    >
      {displayText}

      {/* Floating numbers */}
      {floats.map((f) => (
        <span
          key={f.id}
          className={`absolute left-1/2 -translate-x-1/2 -top-1 text-xs font-bold pointer-events-none animate-credit-float ${
            f.type === 'add' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {f.type === 'add' ? '+' : '-'}{f.value}
        </span>
      ))}
    </button>
  );
};

export default AnimatedCreditPill;
