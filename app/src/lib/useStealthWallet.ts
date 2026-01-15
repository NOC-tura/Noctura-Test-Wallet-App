/**
 * React Hook for Stealth Address Integration
 * 
 * This hook provides a seamless integration of stealth addresses
 * into the Noctura wallet. It handles:
 * - Automatic initialization when wallet is ready
 * - Background scanning for incoming payments
 * - Balance aggregation (stealth + regular shielded)
 * - Sending via stealth when appropriate
 * 
 * USAGE:
 * ======
 * function WalletComponent() {
 *   const { keypair } = useWallet();
 *   const stealth = useStealthWallet(keypair);
 *   
 *   // Check stealth balance
 *   console.log('Stealth SOL:', stealth.getStealthBalance(WSOL_MINT));
 *   
 *   // Send via stealth
 *   if (stealth.shouldUseStealthAddress(recipientAddress)) {
 *     const result = await stealth.buildStealthPayment({
 *       recipientAddress,
 *       amount: 1_000_000_000n,
 *       mint: WSOL_MINT,
 *     });
 *   }
 * }
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
  StealthWallet, 
  StealthWalletConfig, 
  StealthWalletState,
  DiscoveredStealthPayment,
  ScanProgress,
  StealthTransactionResult,
  PreparedStealthSpend,
} from './stealthAddressSystem';
import { connection } from './solana';

// Re-export types for convenience
export type { 
  StealthWalletState, 
  DiscoveredStealthPayment, 
  ScanProgress 
};

/**
 * Options for the stealth wallet hook
 */
export interface UseStealthWalletOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Custom scan interval (default: 60s) */
  scanIntervalMs?: number;
  /** Auto-start scanning when wallet is ready */
  autoStart?: boolean;
  /** Callback when new payment is discovered */
  onPaymentDiscovered?: (payment: DiscoveredStealthPayment) => void;
}

/**
 * Return type of useStealthWallet hook
 */
export interface UseStealthWalletReturn {
  /** Whether stealth system is initialized */
  isInitialized: boolean;
  /** Whether background scanning is active */
  isScanning: boolean;
  /** Current scan progress */
  scanProgress: ScanProgress;
  /** Discovered stealth payments */
  stealthPayments: DiscoveredStealthPayment[];
  /** Get stealth balance for a specific mint */
  getStealthBalance: (mint: string) => bigint;
  /** Get all stealth balances */
  getAllStealthBalances: () => Map<string, bigint>;
  /** Start background scanning */
  startScanning: () => void;
  /** Stop background scanning */
  stopScanning: () => void;
  /** Trigger manual scan */
  scanNow: () => Promise<DiscoveredStealthPayment[]>;
  /** Check if address should use stealth */
  shouldUseStealthAddress: (address: string) => boolean;
  /** Build a stealth payment transaction */
  buildStealthPayment: (params: {
    recipientAddress: string;
    amount: bigint;
    mint: string;
  }) => Promise<StealthTransactionResult>;
  /** Prepare to spend a stealth payment */
  prepareSpend: (paymentId: string, destinationAddress: string) => PreparedStealthSpend;
  /** Mark a payment as spent */
  markSpent: (paymentId: string) => void;
  /** Convert stealth payment to standard shielded note format */
  toShieldedNote: (paymentId: string) => {
    commitment: bigint;
    nullifier: bigint;
    amount: bigint;
    secret: bigint;
    randomness: bigint;
    mint: string;
    owner: string;
    needsWipe: Uint8Array[];
  };
  /** Error state (if any) */
  error: string | null;
}

/**
 * React hook for stealth wallet functionality
 * 
 * This hook manages the lifecycle of the stealth address system,
 * automatically initializing when a keypair is available and
 * cleaning up on unmount.
 */
export function useStealthWallet(
  keypair: Keypair | null,
  options: UseStealthWalletOptions = {}
): UseStealthWalletReturn {
  const {
    debug = false,
    scanIntervalMs = 60_000,
    autoStart = true,
    onPaymentDiscovered,
  } = options;

  // Stealth wallet instance (mutable ref to avoid re-renders)
  const stealthWalletRef = useRef<StealthWallet | null>(null);
  
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    lastScannedSlot: 0,
    totalChecked: 0,
    totalDiscovered: 0,
    lastScanTime: 0,
    status: 'idle',
  });
  const [stealthPayments, setStealthPayments] = useState<DiscoveredStealthPayment[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Connection instance - use global connection from solana module
  // (memoized to ensure same reference)
  const connectionRef = useMemo(() => connection, []);

  // Initialize stealth wallet when keypair becomes available
  useEffect(() => {
    if (!keypair) {
      // Clean up if keypair is removed
      if (stealthWalletRef.current) {
        stealthWalletRef.current.destroy();
        stealthWalletRef.current = null;
        setIsInitialized(false);
        setIsScanning(false);
      }
      return;
    }

    try {
      if (debug) {
        console.log('[useStealthWallet] Initializing with keypair:', 
          keypair.publicKey.toBase58().slice(0, 16) + '...');
      }

      // Create stealth wallet instance
      const stealthWallet = new StealthWallet({
        connection: connectionRef,
        userKeypair: keypair,
        scanIntervalMs,
        debug,
        onPaymentDiscovered: (payment) => {
          if (debug) {
            console.log('[useStealthWallet] Payment discovered:', payment.id);
          }
          // Update state
          setStealthPayments(prev => [...prev, payment]);
          // Call user callback
          onPaymentDiscovered?.(payment);
        },
        onProgressUpdate: (progress) => {
          setScanProgress(progress);
          setIsScanning(progress.status === 'scanning');
        },
        onBalanceUpdate: () => {
          // Force re-render when balance changes
          setStealthPayments(stealthWallet.getStealthPayments());
        },
      });

      stealthWalletRef.current = stealthWallet;
      setIsInitialized(true);
      setError(null);

      // Load existing payments
      const existingPayments = stealthWallet.getStealthPayments();
      setStealthPayments(existingPayments);

      // Auto-start scanning if enabled
      if (autoStart) {
        stealthWallet.startScanning();
        setIsScanning(true);
      }

      if (debug) {
        console.log('[useStealthWallet] Initialized successfully');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize stealth wallet';
      setError(message);
      console.error('[useStealthWallet] Initialization error:', err);
    }

    // Cleanup on unmount or keypair change
    return () => {
      if (stealthWalletRef.current) {
        if (debug) {
          console.log('[useStealthWallet] Cleaning up');
        }
        stealthWalletRef.current.destroy();
        stealthWalletRef.current = null;
      }
    };
  }, [keypair, connectionRef, scanIntervalMs, debug, autoStart, onPaymentDiscovered]);

  // Get stealth balance for a specific mint
  const getStealthBalance = useCallback((mint: string): bigint => {
    if (!stealthWalletRef.current) return 0n;
    return stealthWalletRef.current.getStealthBalance(mint);
  }, [isInitialized, stealthPayments]); // Re-run when payments change

  // Get all stealth balances
  const getAllStealthBalances = useCallback((): Map<string, bigint> => {
    if (!stealthWalletRef.current) return new Map();
    return stealthWalletRef.current.getAllStealthBalances();
  }, [isInitialized, stealthPayments]);

  // Start scanning
  const startScanning = useCallback(() => {
    if (!stealthWalletRef.current) {
      setError('Stealth wallet not initialized');
      return;
    }
    stealthWalletRef.current.startScanning();
    setIsScanning(true);
  }, [isInitialized]);

  // Stop scanning
  const stopScanning = useCallback(() => {
    if (!stealthWalletRef.current) return;
    stealthWalletRef.current.stopScanning();
    setIsScanning(false);
  }, [isInitialized]);

  // Manual scan
  const scanNow = useCallback(async (): Promise<DiscoveredStealthPayment[]> => {
    if (!stealthWalletRef.current) {
      setError('Stealth wallet not initialized');
      return [];
    }
    try {
      const newPayments = await stealthWalletRef.current.scanNow();
      setStealthPayments(stealthWalletRef.current.getStealthPayments());
      return newPayments;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      setError(message);
      return [];
    }
  }, [isInitialized]);

  // Check if should use stealth
  const shouldUseStealthAddress = useCallback((address: string): boolean => {
    if (!stealthWalletRef.current) return false;
    return stealthWalletRef.current.shouldUseStealthAddress(address);
  }, [isInitialized]);

  // Build stealth payment
  const buildStealthPayment = useCallback(async (params: {
    recipientAddress: string;
    amount: bigint;
    mint: string;
  }) => {
    if (!stealthWalletRef.current) {
      throw new Error('Stealth wallet not initialized');
    }
    return stealthWalletRef.current.buildStealthPayment(params);
  }, [isInitialized]);

  // Prepare spend
  const prepareSpend = useCallback((
    paymentId: string,
    destinationAddress: string
  ) => {
    if (!stealthWalletRef.current) {
      throw new Error('Stealth wallet not initialized');
    }
    return stealthWalletRef.current.prepareSpend(paymentId, destinationAddress);
  }, [isInitialized]);

  // Mark spent
  const markSpent = useCallback((paymentId: string) => {
    if (!stealthWalletRef.current) return;
    stealthWalletRef.current.markSpent(paymentId);
    setStealthPayments(stealthWalletRef.current.getStealthPayments());
  }, [isInitialized]);

  // Convert to shielded note
  const toShieldedNote = useCallback((paymentId: string) => {
    if (!stealthWalletRef.current) {
      throw new Error('Stealth wallet not initialized');
    }
    return stealthWalletRef.current.toShieldedNote(paymentId);
  }, [isInitialized]);

  return {
    isInitialized,
    isScanning,
    scanProgress,
    stealthPayments,
    getStealthBalance,
    getAllStealthBalances,
    startScanning,
    stopScanning,
    scanNow,
    shouldUseStealthAddress,
    buildStealthPayment,
    prepareSpend,
    markSpent,
    toShieldedNote,
    error,
  };
}

/**
 * Format stealth balance for display
 */
export function formatStealthBalanceDisplay(
  atoms: bigint,
  tokenType: 'SOL' | 'NOC'
): string {
  const decimals = tokenType === 'SOL' ? 9 : 6;
  const divisor = BigInt(10 ** decimals);
  const whole = atoms / divisor;
  const fraction = atoms % divisor;
  
  const fractionStr = fraction.toString().padStart(decimals, '0');
  // Trim trailing zeros but keep at least 2 decimal places for display
  const trimmed = fractionStr.replace(/0+$/, '').padEnd(2, '0');
  
  return `${whole}.${trimmed}`;
}

/**
 * Hook to get combined balance (regular shielded + stealth)
 */
export function useCombinedShieldedBalance(
  regularShieldedBalance: bigint,
  stealthBalance: bigint
): bigint {
  return useMemo(() => {
    return regularShieldedBalance + stealthBalance;
  }, [regularShieldedBalance, stealthBalance]);
}

export default useStealthWallet;
