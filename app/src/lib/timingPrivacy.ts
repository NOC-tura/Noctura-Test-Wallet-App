/**
 * Timing Privacy System
 * 
 * Hides when shielded transactions occur by:
 * 1. Padding blocks with dummy transactions
 * 2. Randomizing submission times
 * 3. Decoupling user action from blockchain submission
 * 4. Using dummy traffic to obscure real transactions
 */

export interface TimingPrivacyConfig {
  enabled: boolean;
  minBatchSize: number; // Minimum transactions to batch together
  maxBatchSize: number; // Maximum transactions per batch
  meanInterarrivalMs: number; // Average time between batches (exponential distribution)
  dummyTransactionRate: number; // % of transactions that are dummy (0-1)
  decoupleDelayMs: number; // Delay between user action and submission (0 = disabled)
}

export const DEFAULT_TIMING_PRIVACY: TimingPrivacyConfig = {
  enabled: true,
  minBatchSize: 3,
  maxBatchSize: 8,
  meanInterarrivalMs: 30_000, // 30 seconds on average
  dummyTransactionRate: 0.3, // 30% dummy traffic
  decoupleDelayMs: 15_000, // 15 second decoupling
};

class TimingPrivacyManager {
  private config: TimingPrivacyConfig;
  private lastSubmissionTime = 0;
  private pendingCount = 0;

  constructor(config: Partial<TimingPrivacyConfig> = {}) {
    this.config = { ...DEFAULT_TIMING_PRIVACY, ...config };
  }

  /**
   * Calculate next batch submission time using exponential distribution
   * This creates natural-looking gaps between transactions
   */
  getNextSubmissionTime(): number {
    if (!this.config.enabled) return 0;

    // Exponential distribution: more likely to submit soon, but sometimes much later
    const lambda = 1 / this.config.meanInterarrivalMs;
    const uniform = Math.random();
    const exponentialDelay = -Math.log(uniform) / lambda;

    const now = Date.now();
    const timeSinceLastSubmission = now - this.lastSubmissionTime;

    // Add decoupling delay to break link between user action and submission
    const totalDelay = Math.max(
      this.config.decoupleDelayMs,
      Math.round(exponentialDelay - timeSinceLastSubmission),
    );

    return Math.max(0, totalDelay);
  }

  /**
   * Should this transaction be submitted as dummy traffic?
   * Dummy transactions hide real transaction rate
   */
  shouldIncludeDummy(): boolean {
    if (!this.config.enabled) return false;
    return Math.random() < this.config.dummyTransactionRate;
  }

  /**
   * Record that a batch was submitted
   */
  recordSubmission(): void {
    this.lastSubmissionTime = Date.now();
    this.pendingCount = 0;
  }

  /**
   * Increment pending transaction count
   */
  addPending(): void {
    this.pendingCount += 1;
  }

  /**
   * Check if batch is ready to submit (size-based)
   */
  isBatchReady(): boolean {
    return this.pendingCount >= this.config.minBatchSize;
  }

  /**
   * Get timing privacy stats
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      pendingTransactions: this.pendingCount,
      lastSubmissionTime: this.lastSubmissionTime,
      timeSinceLastSubmission: Date.now() - this.lastSubmissionTime,
      config: this.config,
    };
  }

  /**
   * Create dummy transaction metadata (not actually submitted)
   * Used for padding and traffic analysis resistance
   */
  createDummyTransactionMetadata() {
    return {
      id: Math.random().toString(36).slice(2),
      type: 'dummy',
      timestamp: Date.now(),
      // Would include dummy proof, commitment, nullifier in real implementation
      commitment: '0x' + Array(64).fill('0').join(''),
      nullifier: '0x' + Array(64).fill('0').join(''),
    };
  }
}

// Singleton
let timingManagerInstance: TimingPrivacyManager | null = null;

export function getTimingPrivacyManager(config?: Partial<TimingPrivacyConfig>): TimingPrivacyManager {
  if (!timingManagerInstance) {
    timingManagerInstance = new TimingPrivacyManager(config);
  }
  return timingManagerInstance;
}

/**
 * Create a batch with mixed real and dummy transactions
 * This prevents traffic analysis from determining real transaction rate
 */
export function mixWithDummyTransactions(realTransactions: any[], manager: TimingPrivacyManager) {
  const batch = [...realTransactions];

  // Add dummy transactions based on configured rate
  const dummyCount = Math.floor(
    realTransactions.length * (manager['config'].dummyTransactionRate / (1 - manager['config'].dummyTransactionRate)),
  );

  for (let i = 0; i < dummyCount; i++) {
    batch.push(manager.createDummyTransactionMetadata());
  }

  // Shuffle to hide which are real
  return batch.sort(() => Math.random() - 0.5);
}

/**
 * Simulate real-world noise in submission times
 * Makes pattern analysis harder
 */
export function addTimingNoise(baseDelayMs: number, noiseLevel: number = 0.2): number {
  const noise = (Math.random() - 0.5) * 2 * baseDelayMs * noiseLevel;
  return Math.max(0, baseDelayMs + noise);
}
