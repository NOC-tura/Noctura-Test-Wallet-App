import { useEffect, useState } from 'react';
import { requestAuthentication } from '../utils/auth';

function formatAmount(amount: bigint): string {
  const num = Number(amount);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 9,
  }).format(num);
}

type Mode = 'pre_sign' | 'post_sign' | 'history' | 'pending';
type Context = 'shielded' | 'transparent';

type RevealHandler = () => boolean | Promise<boolean> | void | Promise<void>;

interface AmountDisplayProps {
  amount: bigint;
  token: string;
  mode: Mode;
  context: Context;
  onReveal?: RevealHandler;
}

/**
 * Conceals amounts in shielded context; shows once pre-sign, then hides with optional reveal.
 */
export function AmountDisplay({ amount, token, mode, context, onReveal }: AmountDisplayProps) {
  const [revealed, setRevealed] = useState<boolean>(mode === 'pre_sign');

  useEffect(() => {
    if (!revealed || mode === 'pre_sign') return;
    const timer = setTimeout(() => setRevealed(false), 30_000);
    return () => clearTimeout(timer);
  }, [revealed, mode]);

  const handleReveal = async () => {
    // Request authentication before revealing
    const authenticated = await requestAuthentication();
    if (!authenticated) return;
    
    if (onReveal) {
      const result = await onReveal();
      if (result === false) return;
    }
    setRevealed(true);
  };

  // Transparent context always shows
  if (context === 'transparent') {
    return <span>{formatAmount(amount)} {token}</span>;
  }

  // Pre-sign: show once with warning
  if (mode === 'pre_sign') {
    return (
      <div>
        <div className="font-semibold">{formatAmount(amount)} {token}</div>
        <div className="text-sm text-amber-600">⚠️ Amount will be hidden after signing</div>
      </div>
    );
  }

  if (revealed) {
    return <span>{formatAmount(amount)} {token}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span>•••••••••••• {token}</span>
      {onReveal && (
        <button className="text-blue-600 underline" onClick={handleReveal}>
          🔓 Reveal Amount
        </button>
      )}
    </div>
  );
}
