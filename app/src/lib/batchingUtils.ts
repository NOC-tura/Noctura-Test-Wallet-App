import { ShieldedNoteRecord } from '../types/shield';

/**
 * Batching utilities for shielded transfers.
 * Allows bundling multiple note spends into a single transaction for improved throughput.
 */

export interface BatchSpendConfig {
  maxNotesPerBatch: number; // 1-4 notes recommended
  delayBetweenBatchesMs: number; // Randomized delay for privacy
}

export const DEFAULT_BATCH_CONFIG: BatchSpendConfig = {
  maxNotesPerBatch: 2, // Start conservative; can increase to 4 with optimized circuits
  delayBetweenBatchesMs: 1000,
};

/**
 * Group notes into batches for transfer.
 * Currently a simple linear batching; could add randomization or privacy-preserving joins.
 */
export function batchNotes(
  notes: ShieldedNoteRecord[],
  config: BatchSpendConfig = DEFAULT_BATCH_CONFIG
): ShieldedNoteRecord[][] {
  const batches: ShieldedNoteRecord[][] = [];
  for (let i = 0; i < notes.length; i += config.maxNotesPerBatch) {
    batches.push(notes.slice(i, i + config.maxNotesPerBatch));
  }
  return batches;
}

/**
 * Calculate randomized delay for submitting batches (privacy feature).
 * Prevents linkage between withdrawal initiation and blockchain confirmation.
 */
export function getRandomBatchDelay(baseDelayMs: number, jitterPercent: number = 25): number {
  const jitter = (Math.random() - 0.5) * (baseDelayMs * jitterPercent / 100);
  return Math.max(0, baseDelayMs + jitter);
}

/**
 * Check if a batch of notes is valid for spending.
 * - All notes must have same token type
 * - All notes must have unique nullifiers
 * - All notes must not be spent
 */
export function validateBatch(batch: ShieldedNoteRecord[]): { valid: boolean; error?: string } {
  if (batch.length === 0) {
    return { valid: false, error: 'Batch must contain at least one note' };
  }

  if (batch.length > 4) {
    return { valid: false, error: 'Batch cannot exceed 4 notes (circuit limitation)' };
  }

  const firstType = batch[0].tokenType;
  if (!batch.every((n) => n.tokenType === firstType)) {
    return { valid: false, error: 'All notes in batch must have same token type' };
  }

  const nullifiers = new Set(batch.map((n) => n.nullifier));
  if (nullifiers.size !== batch.length) {
    return { valid: false, error: 'Batch contains duplicate nullifiers' };
  }

  if (batch.some((n) => n.spent)) {
    return { valid: false, error: 'Batch contains already-spent notes' };
  }

  return { valid: true };
}

/**
 * Calculate total amount in a batch.
 */
export function getBatchTotal(batch: ShieldedNoteRecord[]): bigint {
  return batch.reduce((sum, note) => sum + BigInt(note.amount), 0n);
}

/**
 * Helper to determine if a batch should use randomized timing for privacy.
 * Returns true if user opts into enhanced privacy (longer delays between batches).
 */
export function shouldRandomizeTimming(privacyMode: boolean): boolean {
  return privacyMode;
}
