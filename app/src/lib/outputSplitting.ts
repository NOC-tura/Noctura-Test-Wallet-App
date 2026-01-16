/**
 * Output Splitting and Dummy Outputs
 * 
 * Privacy Enhancement Features per Privacy Guide:
 * 
 * 1. OUTPUT SPLITTING:
 *    - Split change into multiple notes for privacy
 *    - Prevents amount correlation attacks
 *    - Configurable split patterns
 * 
 * 2. DUMMY OUTPUTS:
 *    - Always produce fixed number of outputs
 *    - Makes all transactions look identical
 *    - Prevents output count analysis
 * 
 * 3. AMOUNT OBFUSCATION:
 *    - Add noise to amounts
 *    - Use standardized denominations
 */

import { randomBytes } from '@noble/hashes/utils';

/**
 * Configuration for output splitting
 */
export interface OutputSplitConfig {
  enabled: boolean;
  minOutputs: number;           // Minimum outputs per transaction
  maxOutputs: number;           // Maximum outputs per transaction
  targetOutputs: number;        // Target fixed number (for consistency)
  minAmountPerOutput: bigint;   // Minimum lamports per output
  splitThreshold: bigint;       // Only split if amount exceeds this
  useDummyOutputs: boolean;     // Fill to target with zero-value dummies
}

/**
 * Default configuration - optimized for privacy
 */
export const DEFAULT_SPLIT_CONFIG: OutputSplitConfig = {
  enabled: true,
  minOutputs: 2,
  maxOutputs: 4,
  targetOutputs: 4,        // Always 4 outputs for uniformity
  minAmountPerOutput: 1000n, // 0.000001 SOL minimum
  splitThreshold: 100000n,   // Split if > 0.0001 SOL
  useDummyOutputs: true,
};

/**
 * Output note structure
 */
export interface OutputNote {
  recipientPublicKey: Uint8Array;
  amount: bigint;
  assetMint: string;
  randomness: bigint;
  memo?: string;
  isDummy: boolean;           // True if this is a dummy output
}

/**
 * Split strategy types
 */
export type SplitStrategy = 
  | 'equal'           // Split into equal parts
  | 'random'          // Random distribution
  | 'decreasing'      // Decreasing amounts (largest first)
  | 'standardized'    // Use standard denominations
  | 'privacy-optimal'; // Best for privacy (mix of strategies)

/**
 * Generate secure random bigint in range
 */
function randomBigintInRange(min: bigint, max: bigint): bigint {
  const range = max - min;
  const bytesNeeded = Math.ceil(range.toString(2).length / 8) + 1;
  const randomValue = bytesToBigint(randomBytes(bytesNeeded));
  return min + (randomValue % (range + 1n));
}

/**
 * Convert bytes to bigint
 */
function bytesToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Generate random 256-bit value for note randomness
 */
export function generateNoteRandomness(): bigint {
  return bytesToBigint(randomBytes(32));
}

/**
 * Split an amount into multiple outputs
 */
export function splitAmount(
  totalAmount: bigint,
  numOutputs: number,
  strategy: SplitStrategy = 'privacy-optimal',
  minPerOutput: bigint = DEFAULT_SPLIT_CONFIG.minAmountPerOutput
): bigint[] {
  if (totalAmount <= 0n) {
    return [0n];
  }

  if (numOutputs <= 0) {
    return [totalAmount];
  }

  // Ensure we can meet minimum requirements
  const requiredMin = minPerOutput * BigInt(numOutputs);
  if (totalAmount < requiredMin) {
    // Can't split, return as single output
    return [totalAmount];
  }

  switch (strategy) {
    case 'equal':
      return splitEqual(totalAmount, numOutputs);
    case 'random':
      return splitRandom(totalAmount, numOutputs, minPerOutput);
    case 'decreasing':
      return splitDecreasing(totalAmount, numOutputs, minPerOutput);
    case 'standardized':
      return splitStandardized(totalAmount, numOutputs);
    case 'privacy-optimal':
    default:
      return splitPrivacyOptimal(totalAmount, numOutputs, minPerOutput);
  }
}

/**
 * Equal split
 */
function splitEqual(total: bigint, numOutputs: number): bigint[] {
  const baseAmount = total / BigInt(numOutputs);
  const remainder = total % BigInt(numOutputs);
  
  const outputs: bigint[] = [];
  for (let i = 0; i < numOutputs; i++) {
    // Add remainder to first outputs
    outputs.push(baseAmount + (BigInt(i) < remainder ? 1n : 0n));
  }
  
  return outputs;
}

/**
 * Random split
 */
function splitRandom(
  total: bigint,
  numOutputs: number,
  minPerOutput: bigint
): bigint[] {
  // Reserve minimum for each output
  let remaining = total - (minPerOutput * BigInt(numOutputs));
  const outputs: bigint[] = new Array(numOutputs).fill(minPerOutput);
  
  // Randomly distribute the rest
  for (let i = 0; i < numOutputs - 1; i++) {
    if (remaining <= 0n) break;
    
    const maxAdd = remaining / BigInt(numOutputs - i);
    const toAdd = randomBigintInRange(0n, maxAdd);
    outputs[i] += toAdd;
    remaining -= toAdd;
  }
  
  // Last output gets whatever is left
  outputs[numOutputs - 1] += remaining;
  
  // Shuffle to randomize order
  return shuffleArray(outputs);
}

/**
 * Decreasing split (largest first)
 */
function splitDecreasing(
  total: bigint,
  numOutputs: number,
  minPerOutput: bigint
): bigint[] {
  const outputs: bigint[] = [];
  let remaining = total;
  
  for (let i = 0; i < numOutputs; i++) {
    const isLast = i === numOutputs - 1;
    if (isLast) {
      outputs.push(remaining);
    } else {
      // Each output is roughly half of remaining (with some randomness)
      const targetRatio = 0.4 + Math.random() * 0.2; // 40-60%
      let amount = BigInt(Math.floor(Number(remaining) * targetRatio));
      
      // Ensure minimum
      if (amount < minPerOutput) amount = minPerOutput;
      
      // Ensure we leave enough for remaining outputs
      const minRemaining = minPerOutput * BigInt(numOutputs - i - 1);
      if (remaining - amount < minRemaining) {
        amount = remaining - minRemaining;
      }
      
      outputs.push(amount);
      remaining -= amount;
    }
  }
  
  return outputs;
}

/**
 * Standardized denominations (like cash)
 */
function splitStandardized(total: bigint, numOutputs: number): bigint[] {
  // Standard denominations in lamports
  const denominations = [
    1000000000n,  // 1 SOL
    500000000n,   // 0.5 SOL
    100000000n,   // 0.1 SOL
    50000000n,    // 0.05 SOL
    10000000n,    // 0.01 SOL
    5000000n,     // 0.005 SOL
    1000000n,     // 0.001 SOL
    100000n,      // 0.0001 SOL
    10000n,       // 0.00001 SOL
    1000n,        // 0.000001 SOL
  ];
  
  const outputs: bigint[] = [];
  let remaining = total;
  
  for (const denom of denominations) {
    while (remaining >= denom && outputs.length < numOutputs - 1) {
      outputs.push(denom);
      remaining -= denom;
    }
    if (outputs.length >= numOutputs - 1) break;
  }
  
  // Last output gets remainder
  if (remaining > 0n || outputs.length < numOutputs) {
    outputs.push(remaining);
  }
  
  return shuffleArray(outputs.slice(0, numOutputs));
}

/**
 * Privacy-optimal split (combines strategies)
 */
function splitPrivacyOptimal(
  total: bigint,
  numOutputs: number,
  minPerOutput: bigint
): bigint[] {
  // Choose strategy based on amount size and randomness
  const strategies: SplitStrategy[] = ['random', 'decreasing', 'standardized'];
  const chosenStrategy = strategies[Math.floor(Math.random() * strategies.length)];
  
  // Add slight noise to make outputs less predictable
  const outputs = splitAmount(total, numOutputs, chosenStrategy, minPerOutput);
  
  // Add micro-noise (±0.1% of each output)
  return outputs.map(amount => {
    if (amount < 10000n) return amount; // Don't add noise to tiny amounts
    
    const noiseRange = amount / 1000n; // 0.1% range
    const noise = randomBigintInRange(-noiseRange, noiseRange);
    const result = amount + noise;
    
    return result > 0n ? result : amount;
  });
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const randBytes = randomBytes(4);
    const j = Number(bytesToBigint(randBytes) % BigInt(i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate dummy outputs to fill to target count
 */
export function generateDummyOutputs(
  currentOutputCount: number,
  targetOutputCount: number,
  selfPublicKey: Uint8Array,
  assetMint: string
): OutputNote[] {
  const dummyCount = Math.max(0, targetOutputCount - currentOutputCount);
  const dummies: OutputNote[] = [];
  
  for (let i = 0; i < dummyCount; i++) {
    dummies.push({
      recipientPublicKey: selfPublicKey, // Send to self
      amount: 0n,                         // Zero value
      assetMint,
      randomness: generateNoteRandomness(),
      memo: undefined,
      isDummy: true,
    });
  }
  
  return dummies;
}

/**
 * Prepare transaction outputs with privacy enhancements
 */
export function preparePrivacyOutputs(
  recipientPublicKey: Uint8Array,
  sendAmount: bigint,
  changeAmount: bigint,
  selfPublicKey: Uint8Array,
  assetMint: string,
  config: Partial<OutputSplitConfig> = {}
): OutputNote[] {
  const cfg = { ...DEFAULT_SPLIT_CONFIG, ...config };
  
  const outputs: OutputNote[] = [];
  
  // Add recipient output(s)
  if (cfg.enabled && sendAmount > cfg.splitThreshold) {
    // Split send amount
    const sendSplits = splitAmount(sendAmount, 2, 'privacy-optimal', cfg.minAmountPerOutput);
    for (const amount of sendSplits) {
      outputs.push({
        recipientPublicKey,
        amount,
        assetMint,
        randomness: generateNoteRandomness(),
        isDummy: false,
      });
    }
  } else {
    outputs.push({
      recipientPublicKey,
      amount: sendAmount,
      assetMint,
      randomness: generateNoteRandomness(),
      isDummy: false,
    });
  }
  
  // Add change output(s)
  if (changeAmount > 0n) {
    if (cfg.enabled && changeAmount > cfg.splitThreshold) {
      // Split change for privacy
      const remainingSlots = cfg.targetOutputs - outputs.length - (cfg.useDummyOutputs ? 1 : 0);
      const changeSplits = splitAmount(
        changeAmount, 
        Math.max(1, remainingSlots),
        'privacy-optimal',
        cfg.minAmountPerOutput
      );
      
      for (const amount of changeSplits) {
        outputs.push({
          recipientPublicKey: selfPublicKey,
          amount,
          assetMint,
          randomness: generateNoteRandomness(),
          isDummy: false,
        });
      }
    } else {
      outputs.push({
        recipientPublicKey: selfPublicKey,
        amount: changeAmount,
        assetMint,
        randomness: generateNoteRandomness(),
        isDummy: false,
      });
    }
  }
  
  // Add dummy outputs if enabled
  if (cfg.useDummyOutputs) {
    const dummies = generateDummyOutputs(
      outputs.length,
      cfg.targetOutputs,
      selfPublicKey,
      assetMint
    );
    outputs.push(...dummies);
  }
  
  // Shuffle all outputs for additional privacy
  return shuffleArray(outputs);
}

/**
 * Analyze outputs for privacy metrics
 */
export function analyzeOutputPrivacy(outputs: OutputNote[]): {
  totalOutputs: number;
  realOutputs: number;
  dummyOutputs: number;
  uniqueRecipients: number;
  amountVariance: number;
  privacyScore: number; // 0-100
} {
  const realOutputs = outputs.filter(o => !o.isDummy);
  const uniqueRecipients = new Set(
    outputs.map(o => Buffer.from(o.recipientPublicKey).toString('hex'))
  ).size;
  
  // Calculate amount variance (lower = more uniform = more private)
  const amounts = realOutputs.map(o => Number(o.amount));
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
  const normalizedVariance = Math.min(1, variance / (avgAmount * avgAmount + 1));
  
  // Privacy score calculation
  let score = 50; // Base score
  
  // More outputs = better (up to target)
  score += Math.min(20, outputs.length * 5);
  
  // Dummy outputs = better
  score += (outputs.length - realOutputs.length) * 5;
  
  // Lower variance = better
  score += Math.round((1 - normalizedVariance) * 15);
  
  // Multiple recipients = slightly better (less correlation)
  if (uniqueRecipients > 1) score += 5;
  
  return {
    totalOutputs: outputs.length,
    realOutputs: realOutputs.length,
    dummyOutputs: outputs.length - realOutputs.length,
    uniqueRecipients,
    amountVariance: normalizedVariance,
    privacyScore: Math.min(100, Math.max(0, score)),
  };
}
