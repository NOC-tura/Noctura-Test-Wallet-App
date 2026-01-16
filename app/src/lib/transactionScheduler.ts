/**
 * Transaction Scheduling
 * 
 * Privacy Enhancement Feature per Privacy Guide:
 * 
 * TIMING ANALYSIS MITIGATION:
 * - Add random delays before transaction submission
 * - Batch transactions for efficiency and privacy
 * - Schedule future transactions
 * - Prevent timing correlation attacks
 * 
 * Why timing matters:
 * - Transaction timing can reveal user behavior patterns
 * - Immediate responses to events leak information
 * - Batching multiple transactions looks like single user activity
 */

import { randomBytes } from '@noble/hashes/utils';
import { setEncrypted, getEncrypted, ENCRYPTED_STORAGE_KEYS } from './encryptedStorage';

/**
 * Scheduled transaction structure
 */
export interface ScheduledTransaction {
  id: string;
  type: 'shielded_transfer' | 'consolidate' | 'withdraw';
  params: Record<string, unknown>;
  scheduledAt: number;           // When it was scheduled
  executeAt: number;             // When to execute (Unix timestamp ms)
  status: 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  completedAt?: number;
  txHash?: string;
}

/**
 * Scheduling configuration
 */
export interface SchedulingConfig {
  enabled: boolean;
  minDelayMs: number;            // Minimum random delay
  maxDelayMs: number;            // Maximum random delay
  batchWindowMs: number;         // Window to batch transactions
  maxBatchSize: number;          // Maximum transactions per batch
  retryDelayMs: number;          // Delay before retry
  maxRetries: number;            // Maximum retry attempts
}

/**
 * Default scheduling configuration
 */
export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  enabled: true,
  minDelayMs: 1000,              // 1 second minimum
  maxDelayMs: 30000,             // 30 seconds maximum
  batchWindowMs: 60000,          // 1 minute batch window
  maxBatchSize: 5,               // 5 transactions per batch
  retryDelayMs: 5000,            // 5 second retry delay
  maxRetries: 3,
};

/**
 * Delay preset options
 */
export const DELAY_PRESETS = {
  immediate: { min: 0, max: 1000 },           // 0-1 second
  fast: { min: 1000, max: 5000 },             // 1-5 seconds
  normal: { min: 5000, max: 30000 },          // 5-30 seconds
  slow: { min: 30000, max: 120000 },          // 30s-2min
  paranoid: { min: 60000, max: 300000 },      // 1-5 minutes
  batch: { min: 300000, max: 900000 },        // 5-15 minutes (for batching)
} as const;

/**
 * Generate unique transaction ID
 */
function generateTxId(): string {
  return `stx_${Date.now()}_${bytesToHex(randomBytes(4))}`;
}

/**
 * Convert bytes to hex
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate cryptographically secure random delay
 */
export function generateRandomDelay(minMs: number, maxMs: number): number {
  const range = maxMs - minMs;
  const randomValue = Number(BigInt('0x' + bytesToHex(randomBytes(4))) % BigInt(range + 1));
  return minMs + randomValue;
}

/**
 * TransactionScheduler - Manage scheduled transactions
 */
export class TransactionScheduler {
  private password: string;
  private config: SchedulingConfig;
  private transactions: ScheduledTransaction[] = [];
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onExecute: ((tx: ScheduledTransaction) => Promise<string | null>) | null = null;

  constructor(password: string, config: Partial<SchedulingConfig> = {}) {
    this.password = password;
    this.config = { ...DEFAULT_SCHEDULING_CONFIG, ...config };
  }

  /**
   * Load scheduled transactions from storage
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const stored = await getEncrypted<ScheduledTransaction[]>(
        ENCRYPTED_STORAGE_KEYS.TRANSACTION_HISTORY + '_scheduled',
        this.password
      );
      this.transactions = stored || [];
      this.loaded = true;
      console.log(`[Scheduler] Loaded ${this.transactions.length} scheduled transactions`);
    } catch {
      this.transactions = [];
      this.loaded = true;
    }
  }

  /**
   * Save scheduled transactions
   */
  private async save(): Promise<void> {
    await setEncrypted(
      ENCRYPTED_STORAGE_KEYS.TRANSACTION_HISTORY + '_scheduled',
      this.transactions,
      this.password
    );
  }

  /**
   * Set execution callback
   */
  setExecuteCallback(callback: (tx: ScheduledTransaction) => Promise<string | null>): void {
    this.onExecute = callback;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.timer) return;
    
    this.timer = setInterval(() => this.processQueue(), 5000); // Check every 5 seconds
    console.log('[Scheduler] Started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Scheduler] Stopped');
    }
  }

  /**
   * Schedule a transaction with random delay
   */
  async scheduleWithDelay(
    type: ScheduledTransaction['type'],
    params: Record<string, unknown>,
    delayPreset: keyof typeof DELAY_PRESETS = 'normal',
    priority: ScheduledTransaction['priority'] = 'normal'
  ): Promise<ScheduledTransaction> {
    await this.load();

    const preset = DELAY_PRESETS[delayPreset];
    const delay = generateRandomDelay(preset.min, preset.max);
    const now = Date.now();

    const tx: ScheduledTransaction = {
      id: generateTxId(),
      type,
      params,
      scheduledAt: now,
      executeAt: now + delay,
      status: 'pending',
      priority,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    this.transactions.push(tx);
    await this.save();

    console.log(`[Scheduler] Scheduled ${type} transaction, delay: ${Math.round(delay / 1000)}s`);
    return tx;
  }

  /**
   * Schedule a transaction for specific time
   */
  async scheduleAt(
    type: ScheduledTransaction['type'],
    params: Record<string, unknown>,
    executeAt: Date | number,
    priority: ScheduledTransaction['priority'] = 'normal'
  ): Promise<ScheduledTransaction> {
    await this.load();

    const executeTime = typeof executeAt === 'number' ? executeAt : executeAt.getTime();
    const now = Date.now();

    const tx: ScheduledTransaction = {
      id: generateTxId(),
      type,
      params,
      scheduledAt: now,
      executeAt: executeTime,
      status: 'pending',
      priority,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    this.transactions.push(tx);
    await this.save();

    console.log(`[Scheduler] Scheduled ${type} transaction for ${new Date(executeTime).toISOString()}`);
    return tx;
  }

  /**
   * Schedule for next batch window
   */
  async scheduleForBatch(
    type: ScheduledTransaction['type'],
    params: Record<string, unknown>
  ): Promise<ScheduledTransaction> {
    await this.load();

    // Find next batch window
    const now = Date.now();
    const batchWindowStart = Math.ceil(now / this.config.batchWindowMs) * this.config.batchWindowMs;
    
    // Add random offset within batch window
    const offset = generateRandomDelay(0, this.config.batchWindowMs / 2);
    const executeAt = batchWindowStart + offset;

    return this.scheduleAt(type, params, executeAt, 'normal');
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (!this.loaded) await this.load();
    if (!this.onExecute) return;

    const now = Date.now();
    const ready = this.transactions.filter(
      tx => tx.status === 'pending' && tx.executeAt <= now
    );

    // Sort by priority and scheduled time
    ready.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.scheduledAt - b.scheduledAt;
    });

    // Process batch
    const batch = ready.slice(0, this.config.maxBatchSize);
    
    for (const tx of batch) {
      await this.executeTransaction(tx);
    }
  }

  /**
   * Execute a single transaction
   */
  private async executeTransaction(tx: ScheduledTransaction): Promise<void> {
    if (!this.onExecute) return;

    tx.status = 'executing';
    await this.save();

    try {
      console.log(`[Scheduler] Executing ${tx.type} transaction ${tx.id}`);
      const txHash = await this.onExecute(tx);
      
      tx.status = 'completed';
      tx.completedAt = Date.now();
      tx.txHash = txHash || undefined;
      
      console.log(`[Scheduler] Completed ${tx.id}: ${txHash}`);
    } catch (error) {
      tx.retryCount++;
      tx.lastError = error instanceof Error ? error.message : 'Unknown error';
      
      if (tx.retryCount >= tx.maxRetries) {
        tx.status = 'failed';
        console.error(`[Scheduler] Failed ${tx.id} after ${tx.retryCount} retries`);
      } else {
        // Schedule retry
        tx.status = 'pending';
        tx.executeAt = Date.now() + this.config.retryDelayMs * tx.retryCount;
        console.warn(`[Scheduler] Retrying ${tx.id} in ${this.config.retryDelayMs * tx.retryCount}ms`);
      }
    }

    await this.save();
  }

  /**
   * Cancel a scheduled transaction
   */
  async cancel(id: string): Promise<boolean> {
    await this.load();

    const tx = this.transactions.find(t => t.id === id);
    if (!tx) return false;

    if (tx.status === 'pending') {
      tx.status = 'cancelled';
      await this.save();
      console.log(`[Scheduler] Cancelled ${id}`);
      return true;
    }

    return false;
  }

  /**
   * Get pending transactions
   */
  async getPending(): Promise<ScheduledTransaction[]> {
    await this.load();
    return this.transactions.filter(tx => tx.status === 'pending');
  }

  /**
   * Get all transactions
   */
  async getAll(): Promise<ScheduledTransaction[]> {
    await this.load();
    return [...this.transactions];
  }

  /**
   * Get transaction by ID
   */
  async getById(id: string): Promise<ScheduledTransaction | null> {
    await this.load();
    return this.transactions.find(tx => tx.id === id) || null;
  }

  /**
   * Clear completed/failed/cancelled transactions
   */
  async clearHistory(): Promise<number> {
    await this.load();
    const before = this.transactions.length;
    this.transactions = this.transactions.filter(tx => tx.status === 'pending');
    await this.save();
    return before - this.transactions.length;
  }

  /**
   * Get scheduler statistics
   */
  async getStats(): Promise<{
    pending: number;
    executing: number;
    completed: number;
    failed: number;
    cancelled: number;
    avgDelayMs: number;
  }> {
    await this.load();
    
    const stats = {
      pending: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      avgDelayMs: 0,
    };

    let totalDelay = 0;
    let completedCount = 0;

    for (const tx of this.transactions) {
      switch (tx.status) {
        case 'pending': stats.pending++; break;
        case 'ready': stats.pending++; break;
        case 'executing': stats.executing++; break;
        case 'completed': 
          stats.completed++;
          if (tx.completedAt) {
            totalDelay += tx.completedAt - tx.scheduledAt;
            completedCount++;
          }
          break;
        case 'failed': stats.failed++; break;
        case 'cancelled': stats.cancelled++; break;
      }
    }

    stats.avgDelayMs = completedCount > 0 ? Math.round(totalDelay / completedCount) : 0;
    return stats;
  }
}

/**
 * Convenience function: Add random delay before action
 */
export async function withRandomDelay<T>(
  action: () => Promise<T>,
  preset: keyof typeof DELAY_PRESETS = 'normal'
): Promise<T> {
  const { min, max } = DELAY_PRESETS[preset];
  const delay = generateRandomDelay(min, max);
  
  console.log(`[Timing] Adding ${Math.round(delay / 1000)}s random delay`);
  await new Promise(resolve => setTimeout(resolve, delay));
  
  return action();
}

/**
 * Create scheduler instance
 */
export function createTransactionScheduler(
  password: string,
  config?: Partial<SchedulingConfig>
): TransactionScheduler {
  return new TransactionScheduler(password, config);
}
