import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Reorg handling utilities for detecting chain reorganizations
 * and safely re-anchoring to confirmed roots.
 */

export interface ReorgCheckpoint {
  slot: number;
  root: string; // base58 Merkle root
  timestamp: number;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized';
}

export interface ReorgDetectionConfig {
  checkIntervalMs: number; // How often to check for reorgs
  maxRollbackSlots: number; // Max slots to accept as reorg
  minFinalizedGapSlots: number; // Min slots ahead of finalized to warn
}

export const DEFAULT_REORG_CONFIG: ReorgDetectionConfig = {
  checkIntervalMs: 10_000, // Check every 10 seconds
  maxRollbackSlots: 50, // Accept reorg up to 50 slots deep
  minFinalizedGapSlots: 10, // Warn if current > finalized + 10 slots
};

export class ReorgDetector {
  private checkpoints: ReorgCheckpoint[] = [];
  private lastConfirmedSlot: number = 0;
  private lastFinalizedSlot: number = 0;
  private connection: Connection;
  private config: ReorgDetectionConfig;
  private checkIntervalId: NodeJS.Timeout | null = null;

  constructor(connection: Connection, config: Partial<ReorgDetectionConfig> = {}) {
    this.connection = connection;
    this.config = { ...DEFAULT_REORG_CONFIG, ...config };
  }

  /**
   * Start periodic reorg detection
   */
  startMonitoring(): void {
    if (this.checkIntervalId) return;
    this.checkForReorg(); // Check immediately
    this.checkIntervalId = setInterval(() => {
      this.checkForReorg();
    }, this.config.checkIntervalMs);
    console.log(`[ReorgDetector] Monitoring started (interval: ${this.config.checkIntervalMs}ms)`);
  }

  /**
   * Stop periodic reorg detection
   */
  stopMonitoring(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log(`[ReorgDetector] Monitoring stopped`);
    }
  }

  /**
   * Check current chain state for reorgs
   */
  async checkForReorg(): Promise<boolean> {
    try {
      const blockHeight = await this.connection.getBlockHeight('confirmed');
      const confirmedSlot = await this.connection.getSlot('confirmed');
      const currentSlot = await this.connection.getSlot('processed');

      // Check if we've rolled back from a previously confirmed slot
      if (this.lastConfirmedSlot > 0 && currentSlot < this.lastConfirmedSlot) {
        const rollback = this.lastConfirmedSlot - currentSlot;
        if (rollback > this.config.maxRollbackSlots) {
          console.error(`[ReorgDetector] ❌ CRITICAL: Potential deep reorg detected! Rollback: ${rollback} slots`);
          return true;
        } else {
          console.warn(`[ReorgDetector] ⚠️ Shallow reorg detected. Rollback: ${rollback} slots (acceptable, < ${this.config.maxRollbackSlots})`);
        }
      }

      // Check finality gap (use confirmedSlot as finality proxy)
      const finalityGap = currentSlot - confirmedSlot;
      if (finalityGap > this.config.minFinalizedGapSlots) {
        console.warn(`[ReorgDetector] ⚠️ Large finality gap: ${finalityGap} slots ahead of confirmed`);
      }

      this.lastConfirmedSlot = currentSlot;
      this.lastFinalizedSlot = confirmedSlot;

      return false; // No critical reorg detected
    } catch (err) {
      console.error('[ReorgDetector] Error checking for reorg:', err);
      return false; // Assume no reorg on error
    }
  }

  /**
   * Record a merkle root with confirmation level
   */
  recordCheckpoint(root: string, slot: number, confirmationStatus: 'processed' | 'confirmed' | 'finalized'): void {
    this.checkpoints.push({
      slot,
      root,
      timestamp: Date.now(),
      confirmationStatus,
    });

    // Keep only last 100 checkpoints
    if (this.checkpoints.length > 100) {
      this.checkpoints = this.checkpoints.slice(-100);
    }

    console.log(`[ReorgDetector] Recorded checkpoint: root=${root.slice(0, 8)}... slot=${slot} status=${confirmationStatus}`);
  }

  /**
   * Get the most recent finalized root checkpoint
   */
  getFinalizedRoot(): string | null {
    const finalized = this.checkpoints
      .filter((cp) => cp.confirmationStatus === 'finalized')
      .sort((a, b) => b.slot - a.slot)[0];
    return finalized ? finalized.root : null;
  }

  /**
   * Get the most recent confirmed root checkpoint
   */
  getConfirmedRoot(): string | null {
    const confirmed = this.checkpoints
      .filter((cp) => cp.confirmationStatus === 'confirmed' || cp.confirmationStatus === 'finalized')
      .sort((a, b) => b.slot - a.slot)[0];
    return confirmed ? confirmed.root : null;
  }

  /**
   * Check if a root is in our finalized checkpoint history
   */
  isRootFinalized(root: string): boolean {
    return this.checkpoints.some((cp) => cp.root === root && cp.confirmationStatus === 'finalized');
  }

  /**
   * Get all checkpoints for debugging
   */
  getAllCheckpoints(): ReorgCheckpoint[] {
    return [...this.checkpoints];
  }
}

/**
 * Retry a shielded transaction with a fallback to finalized root if reorg detected
 */
export async function reorgSafeExecute<T>(
  executeWithRoot: (root: string) => Promise<T>,
  getRootForStatus: (status: 'confirmed' | 'finalized') => string,
  detector: ReorgDetector
): Promise<T> {
  try {
    // Try with confirmed root first (faster)
    const confirmedRoot = getRootForStatus('confirmed');
    console.log(`[ReorgSafe] Attempting with confirmed root: ${confirmedRoot.slice(0, 8)}...`);
    return await executeWithRoot(confirmedRoot);
  } catch (err) {
    // Fallback to finalized root on error
    console.warn(`[ReorgSafe] Confirmed root failed, falling back to finalized root:`, (err as Error).message);
    const finalizedRoot = getRootForStatus('finalized');
    if (!finalizedRoot) {
      throw new Error('No finalized root available for fallback');
    }
    console.log(`[ReorgSafe] Retrying with finalized root: ${finalizedRoot.slice(0, 8)}...`);
    return await executeWithRoot(finalizedRoot);
  }
}
