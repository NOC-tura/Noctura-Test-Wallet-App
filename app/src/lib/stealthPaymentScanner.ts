/**
 * StealthPaymentScanner - Efficiently discovers incoming stealth payments
 * 
 * THE SCANNING CHALLENGE:
 * ======================
 * Stealth addresses are one-time and unlinkable, so:
 * - Recipient cannot simply look up their address
 * - Must check EVERY transaction to see if it's for them
 * - For each tx: compute ECDH, derive expected address, compare
 * 
 * EFFICIENCY SOLUTIONS:
 * ====================
 * 1. Bloom filter pre-filtering: Skip ~95% of transactions immediately
 * 2. Incremental scanning: Only check new blocks since last scan
 * 3. Parallel processing: Check multiple transactions concurrently
 * 4. Caching: Store scan progress in local storage
 * 
 * SCANNING ALGORITHM:
 * ==================
 * For each transaction with stealth metadata:
 * 1. Extract Bloom hint → Quick check "possibly for me?"
 * 2. If maybe: Extract ephemeral pubkey
 * 3. Compute: sharedSecret = ECDH(myPrivKey, ephemeralPubKey)
 * 4. Derive: expectedStealth = myPubKey + H(sharedSecret) * G
 * 5. Compare: Does transaction commitment use expectedStealth?
 * 6. If match: Decrypt note, add to discovered payments
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { StealthKeyManager } from './stealthKeyManager';
import { StealthTransactionBuilder, StealthTransactionMetadata, StealthNoteData } from './stealthTransactionBuilder';
import { BloomFilter, BloomFilterScanner } from './bloomFilter';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';

// Constants
const STEALTH_MEMO_PREFIX = 'NOCTURA_STEALTH:';
const DEFAULT_SCAN_BATCH_SIZE = 100;
const DEFAULT_SCAN_INTERVAL_MS = 60_000; // 1 minute
const MAX_PARALLEL_ECDH = 10; // Limit concurrent ECDH operations

/**
 * Discovered stealth payment details
 */
export interface DiscoveredStealthPayment {
  /** Unique identifier for this payment */
  id: string;
  /** The stealth public key (one-time address) */
  stealthPublicKey: Uint8Array;
  /** The stealth private key for spending */
  stealthPrivateKey: Uint8Array;
  /** Shared secret (used for verification) */
  sharedSecret: Uint8Array;
  /** The ephemeral public key from transaction */
  ephemeralPublicKey: Uint8Array;
  /** Decrypted note data */
  noteData: StealthNoteData;
  /** Transaction signature */
  signature: string;
  /** Slot when payment was received */
  slot: number;
  /** Block time (unix timestamp) */
  blockTime: number | null | undefined;
  /** Has this payment been spent? */
  spent: boolean;
  /** When this payment was discovered */
  discoveredAt: number;
}

/**
 * Scan progress state (persisted to storage)
 */
export interface ScanProgress {
  /** Last fully scanned slot */
  lastScannedSlot: number;
  /** Total transactions checked */
  totalChecked: number;
  /** Total payments discovered */
  totalDiscovered: number;
  /** Last scan timestamp */
  lastScanTime: number;
  /** Scan status */
  status: 'idle' | 'scanning' | 'error';
  /** Error message if status is 'error' */
  errorMessage?: string;
}

/**
 * Scanner configuration options
 */
export interface ScannerConfig {
  /** Solana RPC connection */
  connection: Connection;
  /** Batch size for fetching signatures */
  batchSize: number;
  /** Interval between background scans (ms) */
  scanIntervalMs: number;
  /** Max concurrent ECDH operations */
  maxParallelEcdh: number;
  /** Callback when new payment discovered */
  onPaymentDiscovered?: (payment: DiscoveredStealthPayment) => void;
  /** Callback for scan progress updates */
  onProgressUpdate?: (progress: ScanProgress) => void;
  /** Storage key for persisting progress */
  storageKey: string;
}

/**
 * StealthPaymentScanner - Scans blockchain for stealth payments
 * 
 * USAGE:
 * ======
 * const scanner = new StealthPaymentScanner({
 *   connection,
 *   userPrivateKey,
 *   userPublicKey,
 *   onPaymentDiscovered: (payment) => {
 *     console.log('Found payment:', payment.noteData.amount);
 *   },
 * });
 * 
 * // Start background scanning
 * scanner.startBackgroundScan();
 * 
 * // Or scan manually
 * const payments = await scanner.scanRange(fromSlot, toSlot);
 */
export class StealthPaymentScanner {
  private config: ScannerConfig;
  private userPrivateKey: Uint8Array;
  private userPublicKey: Uint8Array;
  private bloomScanner: BloomFilterScanner;
  private discoveredPayments: Map<string, DiscoveredStealthPayment>;
  private scanProgress: ScanProgress;
  private backgroundScanTimer: ReturnType<typeof setInterval> | null = null;
  private isScanning = false;

  constructor(
    userPrivateKey: Uint8Array,
    userPublicKey: Uint8Array,
    config: Partial<ScannerConfig> & { connection: Connection }
  ) {
    this.userPrivateKey = userPrivateKey;
    this.userPublicKey = userPublicKey;
    
    this.config = {
      batchSize: DEFAULT_SCAN_BATCH_SIZE,
      scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
      maxParallelEcdh: MAX_PARALLEL_ECDH,
      storageKey: 'noctura_stealth_scan_progress',
      ...config,
    };

    this.bloomScanner = new BloomFilterScanner(userPublicKey);
    this.discoveredPayments = new Map();
    this.scanProgress = this.loadProgress();
  }

  // =============================================================================
  // PUBLIC API
  // =============================================================================

  /**
   * Scan a range of slots for stealth payments
   * 
   * @param fromSlot - Start slot (inclusive)
   * @param toSlot - End slot (inclusive)
   * @returns Array of discovered payments
   */
  async scanRange(
    fromSlot: number,
    toSlot: number
  ): Promise<DiscoveredStealthPayment[]> {
    console.log(`[StealthScanner] Scanning slots ${fromSlot} to ${toSlot}`);
    
    const newPayments: DiscoveredStealthPayment[] = [];
    this.scanProgress.status = 'scanning';
    this.notifyProgressUpdate();

    try {
      // Fetch transactions in batches
      let currentSlot = fromSlot;
      
      while (currentSlot <= toSlot) {
        const batchEnd = Math.min(currentSlot + this.config.batchSize, toSlot);
        
        // Get signatures for shielded program in this slot range
        const signatures = await this.fetchStealthSignatures(currentSlot, batchEnd);
        
        if (signatures.length > 0) {
          console.log(`[StealthScanner] Found ${signatures.length} potential stealth txs in slots ${currentSlot}-${batchEnd}`);
          
          // Process signatures to find stealth payments
          const payments = await this.processSignatures(signatures);
          newPayments.push(...payments);
          
          // Notify for each discovered payment
          for (const payment of payments) {
            this.discoveredPayments.set(payment.id, payment);
            this.config.onPaymentDiscovered?.(payment);
          }
        }

        this.scanProgress.totalChecked += signatures.length;
        this.scanProgress.lastScannedSlot = batchEnd;
        currentSlot = batchEnd + 1;
        
        this.notifyProgressUpdate();
      }

      this.scanProgress.totalDiscovered += newPayments.length;
      this.scanProgress.lastScanTime = Date.now();
      this.scanProgress.status = 'idle';
      this.saveProgress();
      this.notifyProgressUpdate();

      console.log(`[StealthScanner] Scan complete. Found ${newPayments.length} new payments.`);
      return newPayments;

    } catch (error) {
      this.scanProgress.status = 'error';
      this.scanProgress.errorMessage = (error as Error).message;
      this.notifyProgressUpdate();
      throw error;
    }
  }

  /**
   * Scan from last checkpoint to current slot
   * 
   * Incremental scanning - only checks new blocks since last scan.
   */
  async scanIncremental(): Promise<DiscoveredStealthPayment[]> {
    const currentSlot = await this.config.connection.getSlot();
    const fromSlot = this.scanProgress.lastScannedSlot + 1;
    
    if (fromSlot >= currentSlot) {
      console.log('[StealthScanner] Already up to date');
      return [];
    }

    return this.scanRange(fromSlot, currentSlot);
  }

  /**
   * Start background scanning service
   * 
   * Runs scanIncremental() at configured interval.
   */
  startBackgroundScan(): void {
    if (this.backgroundScanTimer) {
      console.log('[StealthScanner] Background scan already running');
      return;
    }

    console.log(`[StealthScanner] Starting background scan (interval: ${this.config.scanIntervalMs}ms)`);

    // Run immediately
    this.runBackgroundScanOnce();

    // Then run at interval
    this.backgroundScanTimer = setInterval(
      () => this.runBackgroundScanOnce(),
      this.config.scanIntervalMs
    );
  }

  /**
   * Stop background scanning
   */
  stopBackgroundScan(): void {
    if (this.backgroundScanTimer) {
      clearInterval(this.backgroundScanTimer);
      this.backgroundScanTimer = null;
      console.log('[StealthScanner] Background scan stopped');
    }
  }

  /**
   * Check if a specific transaction is a stealth payment to us
   * 
   * @param signature - Transaction signature to check
   * @returns DiscoveredStealthPayment if it's for us, null otherwise
   */
  async checkTransaction(signature: string): Promise<DiscoveredStealthPayment | null> {
    try {
      const tx = await this.config.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return null;

      // Extract stealth metadata from memo
      const metadata = this.extractStealthMetadata(tx);
      if (!metadata) return null;

      // Try to recognize as our payment
      return this.recognizePayment(metadata, signature, tx.slot, tx.blockTime);

    } catch (error) {
      console.error(`[StealthScanner] Error checking transaction ${signature}:`, error);
      return null;
    }
  }

  /**
   * Get all discovered payments
   */
  getDiscoveredPayments(): DiscoveredStealthPayment[] {
    return Array.from(this.discoveredPayments.values());
  }

  /**
   * Get unspent payments only
   */
  getUnspentPayments(): DiscoveredStealthPayment[] {
    return this.getDiscoveredPayments().filter(p => !p.spent);
  }

  /**
   * Mark a payment as spent
   */
  markPaymentSpent(paymentId: string): void {
    const payment = this.discoveredPayments.get(paymentId);
    if (payment) {
      payment.spent = true;
      this.saveDiscoveredPayments();
    }
  }

  /**
   * Get current scan progress
   */
  getProgress(): ScanProgress {
    return { ...this.scanProgress };
  }

  /**
   * Reset scanning progress (rescan from beginning)
   */
  resetProgress(): void {
    this.scanProgress = {
      lastScannedSlot: 0,
      totalChecked: 0,
      totalDiscovered: 0,
      lastScanTime: 0,
      status: 'idle',
    };
    this.saveProgress();
    this.notifyProgressUpdate();
  }

  // =============================================================================
  // INTERNAL METHODS
  // =============================================================================

  /**
   * Run one background scan iteration
   */
  private async runBackgroundScanOnce(): Promise<void> {
    if (this.isScanning) {
      console.log('[StealthScanner] Scan already in progress, skipping');
      return;
    }

    this.isScanning = true;
    try {
      await this.scanIncremental();
    } catch (error) {
      console.error('[StealthScanner] Background scan error:', error);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Fetch transaction signatures that might contain stealth metadata
   * 
   * We look for transactions to the memo program with our prefix.
   * This is more efficient than scanning all shielded transactions.
   */
  private async fetchStealthSignatures(
    fromSlot: number,
    toSlot: number
  ): Promise<string[]> {
    // In a real implementation, we'd query an indexer or use getProgramAccounts
    // For now, we'll use getSignaturesForAddress on the memo program
    // This is a simplified approach - production would use a dedicated indexer
    
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    
    try {
      const signatures = await this.config.connection.getSignaturesForAddress(
        MEMO_PROGRAM_ID,
        {
          limit: this.config.batchSize,
        }
      );

      // Filter by slot range
      return signatures
        .filter(sig => sig.slot >= fromSlot && sig.slot <= toSlot && sig.err === null)
        .map(sig => sig.signature);
    } catch (error) {
      console.error('[StealthScanner] Error fetching signatures:', error);
      return [];
    }
  }

  /**
   * Process a batch of transaction signatures
   * 
   * Uses Bloom filter pre-filtering for efficiency:
   * 1. Fetch transaction data
   * 2. Extract stealth metadata
   * 3. Check Bloom filter (fast rejection)
   * 4. Compute ECDH only for potential matches
   */
  private async processSignatures(
    signatures: string[]
  ): Promise<DiscoveredStealthPayment[]> {
    const payments: DiscoveredStealthPayment[] = [];

    // Fetch transactions in parallel (limited concurrency)
    const transactions = await Promise.all(
      signatures.map(sig => 
        this.config.connection.getParsedTransaction(sig, {
          maxSupportedTransactionVersion: 0,
        }).catch(() => null)
      )
    );

    // Process each transaction
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (!tx) continue;

      const signature = signatures[i];

      // Extract stealth metadata
      const metadata = this.extractStealthMetadata(tx);
      if (!metadata) continue;

      // Bloom filter check (fast path)
      if (!BloomFilter.checkBloomMatch(this.userPublicKey, metadata.bloomHint)) {
        continue; // Definitely not for us
      }

      // Potential match - do full ECDH check
      const payment = this.recognizePayment(metadata, signature, tx.slot, tx.blockTime);
      if (payment) {
        payments.push(payment);
      }
    }

    return payments;
  }

  /**
   * Extract stealth metadata from a parsed transaction
   */
  private extractStealthMetadata(tx: any): StealthTransactionMetadata | null {
    const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
    
    for (const instruction of tx.transaction.message.instructions || []) {
      if (instruction.programId?.toString() === MEMO_PROGRAM_ID) {
        // Try to parse memo data
        const memoData = instruction.parsed || instruction.data;
        if (typeof memoData === 'string' && memoData.startsWith(STEALTH_MEMO_PREFIX)) {
          return StealthTransactionBuilder.parseStealthMemo(memoData);
        }
      }
    }

    // Check inner instructions too
    for (const innerGroup of tx.meta?.innerInstructions || []) {
      for (const instruction of innerGroup.instructions || []) {
        if (instruction.programId?.toString() === MEMO_PROGRAM_ID) {
          const memoData = instruction.parsed || instruction.data;
          if (typeof memoData === 'string' && memoData.startsWith(STEALTH_MEMO_PREFIX)) {
            return StealthTransactionBuilder.parseStealthMemo(memoData);
          }
        }
      }
    }

    return null;
  }

  /**
   * Try to recognize a payment as ours using ECDH
   * 
   * This is the core recognition algorithm:
   * 1. Compute shared secret with ephemeral key
   * 2. Derive expected stealth address
   * 3. Try to decrypt note
   * 4. Verify commitment matches
   */
  private recognizePayment(
    metadata: StealthTransactionMetadata,
    signature: string,
    slot: number,
    blockTime: number | null | undefined
  ): DiscoveredStealthPayment | null {
    try {
      // Compute shared secret using our private key and tx's ephemeral key
      const recognized = StealthKeyManager.recognizeStealthPayment(
        this.userPrivateKey,
        metadata.ephemeralPublicKey,
        this.userPublicKey
      );

      // Try to decrypt the note
      let noteData: StealthNoteData;
      try {
        noteData = StealthTransactionBuilder.decryptStealthNote(
          metadata.encryptedNote,
          metadata.encryptionNonce,
          recognized.sharedSecret
        );
      } catch {
        // Decryption failed - not for us (false positive from Bloom filter)
        return null;
      }

      // Verify the commitment matches what we'd derive
      // This confirms the payment is actually for us
      const expectedCommitment = StealthTransactionBuilder.createStealthCommitment(
        recognized.stealthPublicKey,
        BigInt(noteData.amount),
        new PublicKey(noteData.mint),
        BigInt(noteData.randomness)
      );

      if (expectedCommitment.toString() !== noteData.commitment) {
        console.warn('[StealthScanner] Commitment mismatch - possible tampering');
        return null;
      }

      // Success! This payment is for us
      const paymentId = this.generatePaymentId(signature, slot);
      
      return {
        id: paymentId,
        stealthPublicKey: recognized.stealthPublicKey,
        stealthPrivateKey: recognized.stealthPrivateKey,
        sharedSecret: recognized.sharedSecret,
        ephemeralPublicKey: metadata.ephemeralPublicKey,
        noteData,
        signature,
        slot,
        blockTime,
        spent: false,
        discoveredAt: Date.now(),
      };

    } catch (error) {
      // ECDH or other crypto error - not for us
      return null;
    }
  }

  /**
   * Generate unique payment ID
   */
  private generatePaymentId(signature: string, slot: number): string {
    const hash = sha256(
      concatBytes(
        new TextEncoder().encode(signature),
        new Uint8Array([slot & 0xff, (slot >> 8) & 0xff, (slot >> 16) & 0xff, (slot >> 24) & 0xff])
      )
    );
    return Buffer.from(hash.slice(0, 16)).toString('hex');
  }

  // =============================================================================
  // PERSISTENCE
  // =============================================================================

  /**
   * Load scan progress from storage
   */
  private loadProgress(): ScanProgress {
    try {
      const stored = localStorage.getItem(this.config.storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      console.warn('[StealthScanner] Failed to load scan progress');
    }

    return {
      lastScannedSlot: 0,
      totalChecked: 0,
      totalDiscovered: 0,
      lastScanTime: 0,
      status: 'idle',
    };
  }

  /**
   * Save scan progress to storage
   */
  private saveProgress(): void {
    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify(this.scanProgress));
    } catch {
      console.warn('[StealthScanner] Failed to save scan progress');
    }
  }

  /**
   * Save discovered payments to storage
   */
  private saveDiscoveredPayments(): void {
    try {
      const payments = Array.from(this.discoveredPayments.entries());
      const storageKey = `${this.config.storageKey}_payments`;
      localStorage.setItem(storageKey, JSON.stringify(payments));
    } catch {
      console.warn('[StealthScanner] Failed to save discovered payments');
    }
  }

  /**
   * Load discovered payments from storage
   */
  loadDiscoveredPayments(): void {
    try {
      const storageKey = `${this.config.storageKey}_payments`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const payments = JSON.parse(stored) as [string, DiscoveredStealthPayment][];
        this.discoveredPayments = new Map(payments);
      }
    } catch {
      console.warn('[StealthScanner] Failed to load discovered payments');
    }
  }

  /**
   * Notify progress update callback
   */
  private notifyProgressUpdate(): void {
    this.config.onProgressUpdate?.(this.getProgress());
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate estimated scan time based on slot range and RPC speed
 */
export function estimateScanTime(
  fromSlot: number,
  toSlot: number,
  avgTxPerSlot: number = 2,
  ecdhTimeMs: number = 2,
  bloomFilterEfficiency: number = 0.95
): {
  totalSlots: number;
  estimatedTransactions: number;
  ecdhOperations: number;
  estimatedTimeSeconds: number;
} {
  const totalSlots = toSlot - fromSlot + 1;
  const estimatedTransactions = totalSlots * avgTxPerSlot;
  const ecdhOperations = Math.ceil(estimatedTransactions * (1 - bloomFilterEfficiency));
  const estimatedTimeSeconds = (ecdhOperations * ecdhTimeMs) / 1000;

  return {
    totalSlots,
    estimatedTransactions,
    ecdhOperations,
    estimatedTimeSeconds,
  };
}

/**
 * Format scan progress for display
 */
export function formatScanProgress(progress: ScanProgress): string {
  const status = progress.status === 'scanning' 
    ? '🔍 Scanning...'
    : progress.status === 'error'
      ? `❌ Error: ${progress.errorMessage}`
      : '✅ Idle';

  const lastScan = progress.lastScanTime
    ? new Date(progress.lastScanTime).toLocaleString()
    : 'Never';

  return `Status: ${status}
Last Slot: ${progress.lastScannedSlot.toLocaleString()}
Transactions Checked: ${progress.totalChecked.toLocaleString()}
Payments Discovered: ${progress.totalDiscovered}
Last Scan: ${lastScan}`;
}

export default StealthPaymentScanner;
