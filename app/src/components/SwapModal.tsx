import React, { useState, useEffect, useCallback } from 'react';
import { getSwapQuote, formatQuoteForDisplay } from '../lib/relayerSwap';

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'transparent' | 'shielded';
  // Balances
  transparentSolBalance: number;
  transparentNocBalance: number;
  shieldedSolBalance: number;
  shieldedNocBalance: number;
  // Callbacks
  onSwap: (params: SwapParams) => Promise<void>;
  // Loading state
  isLoading?: boolean;
  statusMessage?: string;
}

export interface SwapParams {
  fromToken: 'SOL' | 'NOC';
  toToken: 'SOL' | 'NOC';
  amount: string;
  mode: 'transparent' | 'shielded';
  slippage: number;
}

export interface SwapQuote {
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;
  fee: number;
  route: string;
}

export function SwapModal({
  isOpen,
  onClose,
  mode,
  transparentSolBalance,
  transparentNocBalance,
  shieldedSolBalance,
  shieldedNocBalance,
  onSwap,
  isLoading = false,
  statusMessage = '',
}: SwapModalProps) {
  const [fromToken, setFromToken] = useState<'SOL' | 'NOC'>('SOL');
  const [toToken, setToToken] = useState<'SOL' | 'NOC'>('NOC');
  const [amount, setAmount] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<{ amount: string; output: string; fromToken: string; toToken: string } | null>(null);
  const [slippage, setSlippage] = useState(0.5);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [fetchingQuote, setFetchingQuote] = useState(false);

  const isShielded = mode === 'shielded';
  const themeColor = isShielded ? '#8b5cf6' : '#00f0ff';

  // Get current balances based on mode
  const getBalance = (token: 'SOL' | 'NOC') => {
    if (isShielded) {
      return token === 'SOL' ? shieldedSolBalance : shieldedNocBalance;
    }
    return token === 'SOL' ? transparentSolBalance : transparentNocBalance;
  };

  const fromBalance = getBalance(fromToken);
  const toBalance = getBalance(toToken);

  // Swap tokens when user clicks the swap arrow
  const handleSwapTokens = useCallback(() => {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
    setQuote(null);
  }, [fromToken, toToken]);

  // Fetch quote when amount changes (debounced)
  useEffect(() => {
    const fetchQuote = async () => {
      if (!amount || parseFloat(amount) <= 0) {
        setQuote(null);
        return;
      }

      setFetchingQuote(true);
      try {
        // Get quote from Noctura relayer
        const relayerQuote = await getSwapQuote(fromToken, amount, Math.round(slippage * 100));
        
        if (relayerQuote) {
          const formatted = formatQuoteForDisplay(relayerQuote);
          setQuote({
            inputAmount: amount,
            outputAmount: formatted.outputAmount,
            priceImpact: formatted.priceImpact,
            fee: relayerQuote.fee,
            route: 'Noctura',
          });
        } else {
          // Fallback to estimate if relayer unavailable
          const inputAmount = parseFloat(amount);
          const rate = fromToken === 'SOL' ? 273 : 1 / 273;
          const feePercent = 0.12;
          const outputAmount = inputAmount * rate * (1 - feePercent / 100);
          
          setQuote({
            inputAmount: amount,
            outputAmount: outputAmount.toFixed(fromToken === 'SOL' ? 2 : 6),
            priceImpact: 0,
            fee: inputAmount * rate * (feePercent / 100),
            route: 'Noctura',
          });
        }
      } catch (err) {
        console.error('Failed to fetch quote:', err);
        setQuote(null);
      } finally {
        setFetchingQuote(false);
      }
    };

    const debounce = setTimeout(fetchQuote, 500);
    return () => clearTimeout(debounce);
  }, [amount, fromToken, toToken, slippage]);

  // Handle swap button click
  const handleSwap = async () => {
    if (!amount || parseFloat(amount) <= 0 || !quote) return;

    try {
      await onSwap({
        fromToken,
        toToken,
        amount,
        mode,
        slippage,
      });
      
      // Success - show themed success modal
      setSuccessData({
        amount,
        output: quote.outputAmount,
        fromToken,
        toToken,
      });
      setShowSuccess(true);
      setAmount('');
      setQuote(null);
    } catch (err) {
      // Error is already handled in App.tsx
      console.error('[SwapModal] Swap error:', err);
    }
  };

  // Validation
  const parsedAmount = parseFloat(amount) || 0;
  // Don't show insufficient balance warning while swap is in progress (balance changes during swap)
  const insufficientBalance = !isLoading && parsedAmount > fromBalance;
  const isSwapDisabled = 
    !amount || 
    parsedAmount <= 0 || 
    insufficientBalance || 
    isLoading || 
    !quote;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
      <div 
        className={`bg-[#1a1f3a] rounded-2xl max-w-md w-full border relative overflow-hidden ${isShielded ? 'p-4 space-y-3' : 'p-6 space-y-4'}`}
        style={{ borderColor: `${themeColor}40` }}
      >
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
              <path d="M16 3l4 4-4 4"/>
              <path d="M20 7H4"/>
              <path d="M8 21l-4-4 4-4"/>
              <path d="M4 17h16"/>
            </svg>
            {isShielded ? 'Shielded Swap' : 'Swap'}
          </h2>
          <button 
            onClick={onClose} 
            className="text-neutral-400 hover:text-white transition p-1"
            disabled={isLoading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Mode indicator */}
        <div 
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ 
            backgroundColor: `${themeColor}15`,
            border: `1px solid ${themeColor}30`
          }}
        >
          {isShielded ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span style={{ color: themeColor }}>Private swap from shielded balance</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <span style={{ color: themeColor }}>Swap via Noctura (0.12% fee)</span>
            </>
          )}
        </div>

        {/* From Token */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">From</span>
            <span className="text-neutral-400">
              Balance: {fromBalance.toFixed(fromToken === 'SOL' ? 6 : 2)} {fromToken}
            </span>
          </div>
          <div 
            className="flex items-center gap-3 bg-[#0d1225] rounded-xl p-3 border"
            style={{ borderColor: `${themeColor}20` }}
          >
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 flex items-center justify-center">
                <img 
                  src={fromToken === 'SOL' ? '/sol-logo.png' : '/LOGO.png'}
                  alt={fromToken}
                  className="rounded-full object-contain"
                  style={{ width: fromToken === 'SOL' ? '24px' : '40px', height: fromToken === 'SOL' ? '24px' : '40px' }}
                />
              </div>
              <select
                value={fromToken}
                onChange={(e) => {
                  const newFrom = e.target.value as 'SOL' | 'NOC';
                  setFromToken(newFrom);
                  if (newFrom === toToken) {
                    setToToken(newFrom === 'SOL' ? 'NOC' : 'SOL');
                  }
                  setQuote(null);
                }}
                className="bg-transparent text-white font-semibold text-lg outline-none cursor-pointer"
              >
                <option value="SOL">SOL</option>
                <option value="NOC">NOC</option>
              </select>
            </div>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-right text-xl text-white outline-none"
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Swap Arrow */}
        <div className="flex justify-center">
          <button
            onClick={handleSwapTokens}
            className="p-2 rounded-full transition hover:scale-110"
            style={{ backgroundColor: `${themeColor}20` }}
            disabled={isLoading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
              <path d="M7 16V4M7 4L3 8M7 4l4 4"/>
              <path d="M17 8v12M17 20l4-4M17 20l-4-4"/>
            </svg>
          </button>
        </div>

        {/* To Token */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">To</span>
            <span className="text-neutral-400">
              Balance: {toBalance.toFixed(toToken === 'SOL' ? 6 : 2)} {toToken}
            </span>
          </div>
          <div 
            className="flex items-center gap-3 bg-[#0d1225] rounded-xl p-3 border"
            style={{ borderColor: `${themeColor}20` }}
          >
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 flex items-center justify-center">
                <img 
                  src={toToken === 'SOL' ? '/sol-logo.png' : '/LOGO.png'}
                  alt={toToken}
                  className="rounded-full object-contain"
                  style={{ width: toToken === 'SOL' ? '24px' : '40px', height: toToken === 'SOL' ? '24px' : '40px' }}
                />
              </div>
              <select
                value={toToken}
                onChange={(e) => {
                  const newTo = e.target.value as 'SOL' | 'NOC';
                  setToToken(newTo);
                  if (newTo === fromToken) {
                    setFromToken(newTo === 'SOL' ? 'NOC' : 'SOL');
                  }
                  setQuote(null);
                }}
                className="bg-transparent text-white font-semibold text-lg outline-none cursor-pointer"
              >
                <option value="SOL">SOL</option>
                <option value="NOC">NOC</option>
              </select>
            </div>
            <div className="flex-1 text-right text-xl text-white">
              {fetchingQuote ? (
                <span className="text-neutral-500">Loading...</span>
              ) : quote ? (
                quote.outputAmount
              ) : (
                <span className="text-neutral-500">0.00</span>
              )}
            </div>
          </div>
        </div>

        {/* Quote Details */}
        {quote && (
          <div 
            className={`space-y-2 rounded-lg text-sm ${isShielded ? 'p-2' : 'p-3'}`}
            style={{ backgroundColor: `${themeColor}10` }}
          >
            <div className="flex justify-between text-neutral-400">
              <span>Rate</span>
              <span className="text-white">
                1 {fromToken} = {(parseFloat(quote.outputAmount) / parseFloat(quote.inputAmount)).toFixed(fromToken === 'SOL' ? 2 : 6)} {toToken}
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>Price Impact</span>
              <span className={quote.priceImpact > 1 ? 'text-yellow-400' : 'text-green-400'}>
                {quote.priceImpact.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>Network Fee</span>
              <span className="text-white">~{quote.fee} SOL</span>
            </div>
            {isShielded && (
              <div className="flex justify-between text-neutral-400">
                <span>Privacy Fee</span>
                <span style={{ color: themeColor }}>0.25 NOC</span>
              </div>
            )}
            <div className="flex justify-between text-neutral-400">
              <span>Slippage Tolerance</span>
              <button
                onClick={() => setShowSlippageSettings(!showSlippageSettings)}
                className="flex items-center gap-1"
                style={{ color: themeColor }}
              >
                {slippage}%
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Slippage Settings */}
        {showSlippageSettings && (
          <div className="flex gap-2">
            {[0.1, 0.5, 1.0, 3.0].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSlippage(s);
                  setShowSlippageSettings(false);
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                  slippage === s ? 'text-white' : 'text-neutral-400'
                }`}
                style={{ 
                  backgroundColor: slippage === s ? `${themeColor}30` : `${themeColor}10`,
                  borderColor: slippage === s ? themeColor : 'transparent',
                  borderWidth: 1
                }}
              >
                {s}%
              </button>
            ))}
          </div>
        )}

        {/* Insufficient Balance Warning */}
        {insufficientBalance && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
            Insufficient {fromToken} balance. You have {fromBalance.toFixed(fromToken === 'SOL' ? 6 : 2)} {fromToken}.
          </div>
        )}

        {/* Shielded Swap Info - only show on larger screens */}
        {isShielded && (
          <div 
            className="text-xs p-2 rounded-lg hidden sm:block"
            style={{ backgroundColor: `${themeColor}10`, border: `1px solid ${themeColor}20` }}
          >
            <p style={{ color: themeColor }}>
              <strong>Shielded Swap:</strong> Private swap via shielded pool.
            </p>
          </div>
        )}

        {/* Status Message */}
        {statusMessage && (
          <div 
            className={`text-sm rounded-lg flex items-center gap-2 ${isShielded ? 'p-2' : 'p-3'}`}
            style={{ backgroundColor: `${themeColor}15`, color: themeColor }}
          >
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1"/>
            </svg>
            {statusMessage}
          </div>
        )}

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={isSwapDisabled}
          className={`w-full rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${isShielded ? 'py-3 text-base' : 'py-4 text-lg'}`}
          style={{ 
            backgroundColor: isSwapDisabled ? '#4a5568' : themeColor,
            color: isSwapDisabled ? '#a0aec0' : '#fff'
          }}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1"/>
              </svg>
              Swapping...
            </span>
          ) : insufficientBalance ? (
            'Insufficient Balance'
          ) : !quote ? (
            'Enter Amount'
          ) : isShielded ? (
            `Swap ${amount} ${fromToken} → ${quote.outputAmount} ${toToken} (Private)`
          ) : (
            `Swap ${amount} ${fromToken} → ${quote.outputAmount} ${toToken}`
          )}
        </button>
      </div>

      {/* Success Modal Overlay */}
      {showSuccess && successData && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
          <div className="text-center p-6 space-y-4">
            {/* Success Icon */}
            <div 
              className="w-20 h-20 mx-auto rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${themeColor}20`, border: `3px solid ${themeColor}` }}
            >
              <svg 
                width="40" 
                height="40" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke={themeColor}
                strokeWidth="3"
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>

            {/* Title */}
            <h3 className="text-2xl font-bold text-white">Swap Successful!</h3>

            {/* Details */}
            <div className="space-y-2 text-gray-300">
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg">Swapped</span>
                <span className="font-bold text-white text-xl">{successData.amount} {successData.fromToken}</span>
              </div>
              <div className="flex items-center justify-center gap-2 text-2xl" style={{ color: themeColor }}>
                ↓
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg">Received</span>
                <span className="font-bold text-xl" style={{ color: themeColor }}>{successData.output} {successData.toToken}</span>
              </div>
            </div>

            {/* Subtext */}
            <p className="text-gray-400 text-sm">Your balances have been updated</p>

            {/* Close Button */}
            <button
              onClick={() => {
                setShowSuccess(false);
                setSuccessData(null);
                onClose();
              }}
              className="mt-4 px-8 py-3 rounded-xl font-semibold text-lg transition hover:opacity-90"
              style={{ backgroundColor: themeColor, color: '#fff' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SwapModal;
