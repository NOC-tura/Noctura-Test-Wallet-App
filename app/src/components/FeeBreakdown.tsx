import { SOL_FEE } from '../utils/fees';

export function FeeBreakdown({ nocFee, solFee = SOL_FEE, relayerPaysGas = false }: { nocFee: number; solFee?: number; relayerPaysGas?: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Transaction Fees</h3>
      <div className="flex items-center justify-between text-sm">
        <span>NOC Fee:</span>
        <span className="font-mono">{nocFee.toFixed(2)} NOC</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>SOL Fee:</span>
        {relayerPaysGas ? (
          <span className="text-green-400 text-xs">Covered by relayer ✓</span>
        ) : (
          <span className="font-mono">~{solFee.toFixed(6)} SOL</span>
        )}
      </div>
      <div className="flex items-center justify-between font-semibold">
        <span>Total:</span>
        {relayerPaysGas ? (
          <span className="font-mono">{nocFee.toFixed(2)} NOC only</span>
        ) : (
          <span className="font-mono">{nocFee.toFixed(2)} NOC + ~{solFee.toFixed(6)} SOL</span>
        )}
      </div>
      <p className="text-xs text-neutral-500 mt-1">
        {relayerPaysGas 
          ? 'The privacy fee covers relayer service including Solana gas fees.'
          : 'NOC privacy fee + standard Solana network fee.'}
      </p>
    </div>
  );
}
