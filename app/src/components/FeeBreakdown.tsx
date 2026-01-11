import { SOL_FEE } from '../utils/fees';

export function FeeBreakdown({ nocFee, solFee = SOL_FEE }: { nocFee: number; solFee?: number }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Transaction Fees</h3>
      <div className="flex items-center justify-between text-sm">
        <span>NOC Fee:</span>
        <span className="font-mono">{nocFee.toFixed(2)} NOC</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>SOL Fee:</span>
        <span className="font-mono">{solFee.toFixed(9)} SOL</span>
      </div>
      <div className="flex items-center justify-between font-semibold">
        <span>Total:</span>
        <span className="font-mono">{nocFee.toFixed(2)} NOC + {solFee.toFixed(9)} SOL</span>
      </div>
      <button className="text-blue-600 text-sm underline" type="button">
        ℹ️ Why these fees?
      </button>
    </div>
  );
}
