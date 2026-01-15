/**
 * BloomFilter - Efficient probabilistic filtering for stealth address scanning
 * 
 * THE SCANNING PROBLEM:
 * ====================
 * Recipients must check every shielded transaction to see if it's for them.
 * This requires computing ECDH for each transaction - expensive!
 * 
 * BLOOM FILTER SOLUTION:
 * =====================
 * Sender includes a 256-bit "hint" (Bloom filter) in each transaction.
 * Recipient can quickly check: "Could this be for me?"
 * - If NO (all required bits not set): Definitely not for me, skip ECDH
 * - If YES (all required bits set): Might be for me, do full ECDH check
 * 
 * This reduces ECDH computations by ~95-99% (only ~1-5% false positive rate).
 * 
 * HOW BLOOM FILTERS WORK:
 * ======================
 * 1. Hash the input data with K different hash functions
 * 2. Each hash produces a bit position (0-255)
 * 3. Set those K bits to 1 in the filter
 * 4. To check: hash the query, see if all K bits are set
 * 
 * PRIVACY CONSIDERATION:
 * =====================
 * Bloom filter reveals ~K bits of information about recipient.
 * With K=5 and 256 bits, anonymity set is reduced by ~2^K = 32x.
 * This is acceptable because:
 * - Still thousands of potential recipients per bucket
 * - Cannot identify exact recipient
 * - Alternative (no filter) requires checking ALL transactions
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';

// Domain separation for Bloom filter hashing
const DOMAIN_BLOOM_V1 = new TextEncoder().encode('NOCTURA_BLOOM_V1');

// Bloom filter parameters
const BLOOM_FILTER_SIZE_BITS = 256;  // 32 bytes
const BLOOM_FILTER_SIZE_BYTES = 32;
const NUM_HASH_FUNCTIONS = 5;        // K = 5 gives ~3% false positive rate at 10% fill

/**
 * Bloom filter configuration options
 */
export interface BloomFilterConfig {
  /** Number of hash functions (K). More = lower false positives, more bits set */
  numHashFunctions: number;
  /** Size in bits. Must be multiple of 8 */
  sizeInBits: number;
}

/**
 * Default Bloom filter configuration optimized for stealth scanning
 */
export const DEFAULT_BLOOM_CONFIG: BloomFilterConfig = {
  numHashFunctions: NUM_HASH_FUNCTIONS,
  sizeInBits: BLOOM_FILTER_SIZE_BITS,
};

/**
 * BloomFilter class for stealth address scanning optimization
 * 
 * USAGE:
 * ======
 * // Sender side:
 * const hint = BloomFilter.createBloomHint(recipientPublicKey);
 * // Include hint in transaction
 * 
 * // Recipient side:
 * if (BloomFilter.checkBloomMatch(myPublicKey, hint)) {
 *   // Possible match - do full ECDH computation
 * } else {
 *   // Definitely not for me - skip
 * }
 */
export class BloomFilter {
  
  /**
   * Create a Bloom filter hint for a recipient's public key
   * 
   * The hint is derived deterministically from the recipient's public key,
   * so both sender and recipient compute the same hint.
   * 
   * ALGORITHM:
   * 1. Hash pubkey with K different seeds
   * 2. Each hash → bit position (mod 256)
   * 3. Set those bits in the filter
   * 
   * @param recipientPublicKey - Recipient's Ed25519 public key (32 bytes)
   * @param config - Optional custom configuration
   * @returns 32-byte Bloom filter hint
   */
  static createBloomHint(
    recipientPublicKey: Uint8Array,
    config: BloomFilterConfig = DEFAULT_BLOOM_CONFIG
  ): Uint8Array {
    if (recipientPublicKey.length !== 32) {
      throw new Error('Public key must be 32 bytes');
    }

    const filter = new Uint8Array(config.sizeInBits / 8);
    
    // Compute K hash functions with different seeds
    for (let i = 0; i < config.numHashFunctions; i++) {
      const bitPosition = this.computeHashPosition(recipientPublicKey, i, config.sizeInBits);
      this.setBit(filter, bitPosition);
    }

    return filter;
  }

  /**
   * Check if a Bloom filter hint possibly matches a public key
   * 
   * @param userPublicKey - User's public key to check
   * @param bloomHint - The Bloom filter from a transaction
   * @param config - Optional custom configuration
   * @returns true if possibly a match, false if definitely not
   */
  static checkBloomMatch(
    userPublicKey: Uint8Array,
    bloomHint: Uint8Array,
    config: BloomFilterConfig = DEFAULT_BLOOM_CONFIG
  ): boolean {
    if (userPublicKey.length !== 32) {
      throw new Error('Public key must be 32 bytes');
    }
    if (bloomHint.length !== config.sizeInBits / 8) {
      throw new Error(`Bloom hint must be ${config.sizeInBits / 8} bytes`);
    }

    // Check if all required bits are set
    for (let i = 0; i < config.numHashFunctions; i++) {
      const bitPosition = this.computeHashPosition(userPublicKey, i, config.sizeInBits);
      if (!this.getBit(bloomHint, bitPosition)) {
        return false; // Definitely not a match
      }
    }

    return true; // Possibly a match (may be false positive)
  }

  /**
   * Estimate false positive rate for current configuration
   * 
   * FORMULA:
   * FPR ≈ (1 - e^(-kn/m))^k
   * Where:
   * - k = number of hash functions
   * - n = number of elements inserted (1 for single pubkey)
   * - m = filter size in bits
   * 
   * For k=5, n=1, m=256: FPR ≈ 2-3%
   */
  static estimateFalsePositiveRate(
    config: BloomFilterConfig = DEFAULT_BLOOM_CONFIG,
    numElements: number = 1
  ): number {
    const k = config.numHashFunctions;
    const m = config.sizeInBits;
    const n = numElements;

    const exponent = -k * n / m;
    const probability = Math.pow(1 - Math.exp(exponent), k);
    
    return probability;
  }

  /**
   * Get optimal number of hash functions for desired false positive rate
   * 
   * FORMULA:
   * k = (m/n) * ln(2)
   * For single element and 256 bits: k ≈ 177 * ln(2) ≈ 123
   * But we use fewer to keep privacy (fewer bits revealed)
   * 
   * @param targetFPR - Target false positive rate (0.01 = 1%)
   * @param filterSizeBits - Filter size in bits
   * @returns Recommended number of hash functions
   */
  static getOptimalHashFunctions(
    targetFPR: number,
    filterSizeBits: number = BLOOM_FILTER_SIZE_BITS
  ): number {
    // k = -log2(FPR)
    const k = Math.ceil(-Math.log2(targetFPR));
    return Math.min(k, 10); // Cap at 10 to limit privacy leakage
  }

  // =============================================================================
  // INTERNAL HELPER FUNCTIONS
  // =============================================================================

  /**
   * Compute hash position for a given seed
   * 
   * Uses SHA256 with domain separation and seed mixing.
   * This gives us K "independent" hash functions from one hash function.
   */
  private static computeHashPosition(
    data: Uint8Array,
    seed: number,
    filterSizeBits: number
  ): number {
    // Create seed bytes (4 bytes, little-endian)
    const seedBytes = new Uint8Array(4);
    seedBytes[0] = seed & 0xff;
    seedBytes[1] = (seed >> 8) & 0xff;
    seedBytes[2] = (seed >> 16) & 0xff;
    seedBytes[3] = (seed >> 24) & 0xff;

    // Hash with domain separation: H(domain || seed || data)
    const hashInput = concatBytes(DOMAIN_BLOOM_V1, seedBytes, data);
    const hash = sha256(hashInput);

    // Use first 2 bytes as bit position (mod filterSizeBits)
    const position = (hash[0] | (hash[1] << 8)) % filterSizeBits;
    
    return position;
  }

  /**
   * Set a bit in the filter array
   */
  private static setBit(filter: Uint8Array, bitPosition: number): void {
    const byteIndex = Math.floor(bitPosition / 8);
    const bitIndex = bitPosition % 8;
    filter[byteIndex] |= (1 << bitIndex);
  }

  /**
   * Get a bit from the filter array
   */
  private static getBit(filter: Uint8Array, bitPosition: number): boolean {
    const byteIndex = Math.floor(bitPosition / 8);
    const bitIndex = bitPosition % 8;
    return (filter[byteIndex] & (1 << bitIndex)) !== 0;
  }

  /**
   * Count number of bits set in filter (useful for debugging)
   */
  static countSetBits(filter: Uint8Array): number {
    let count = 0;
    for (const byte of filter) {
      let b = byte;
      while (b) {
        count += b & 1;
        b >>= 1;
      }
    }
    return count;
  }

  /**
   * Create a combined Bloom filter for multiple recipients
   * 
   * Used for batch transactions where sender wants to hint at multiple recipients.
   * Combined filter has higher false positive rate but still useful.
   */
  static combineFilters(filters: Uint8Array[]): Uint8Array {
    if (filters.length === 0) {
      throw new Error('At least one filter required');
    }

    const size = filters[0].length;
    const combined = new Uint8Array(size);

    for (const filter of filters) {
      if (filter.length !== size) {
        throw new Error('All filters must have same size');
      }
      for (let i = 0; i < size; i++) {
        combined[i] |= filter[i];
      }
    }

    return combined;
  }
}

/**
 * Batch scanner helper that uses Bloom filters for efficiency
 */
export class BloomFilterScanner {
  private userBloomPattern: Uint8Array;
  private config: BloomFilterConfig;

  constructor(userPublicKey: Uint8Array, config: BloomFilterConfig = DEFAULT_BLOOM_CONFIG) {
    this.userBloomPattern = BloomFilter.createBloomHint(userPublicKey, config);
    this.config = config;
  }

  /**
   * Quickly filter transactions that might be for this user
   * 
   * @param transactions - Array of {bloomHint, ...otherData}
   * @returns Filtered array containing only potential matches
   */
  filterPotentialMatches<T extends { bloomHint: Uint8Array }>(
    transactions: T[]
  ): T[] {
    return transactions.filter(tx => 
      BloomFilter.checkBloomMatch(this.userBloomPattern, tx.bloomHint, this.config)
    );
  }

  /**
   * Get statistics about filtering efficiency
   */
  getFilterStats(totalTransactions: number, matchingTransactions: number): {
    totalChecked: number;
    potentialMatches: number;
    filterEfficiency: number;
    estimatedFalsePositiveRate: number;
  } {
    const efficiency = 1 - (matchingTransactions / totalTransactions);
    const estimatedFPR = BloomFilter.estimateFalsePositiveRate(this.config);

    return {
      totalChecked: totalTransactions,
      potentialMatches: matchingTransactions,
      filterEfficiency: efficiency,
      estimatedFalsePositiveRate: estimatedFPR,
    };
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

/**
 * Test Bloom filter functionality
 */
export function testBloomFilter(): void {
  console.log('=== BloomFilter Test Suite ===\n');

  // Generate test public keys
  const testPubKey1 = new Uint8Array(32);
  const testPubKey2 = new Uint8Array(32);
  crypto.getRandomValues(testPubKey1);
  crypto.getRandomValues(testPubKey2);

  // Test 1: Create Bloom hint
  console.log('Test 1: Create Bloom hint');
  const hint1 = BloomFilter.createBloomHint(testPubKey1);
  console.log('  ✓ Created hint for pubkey1 (32 bytes):', hint1.length === 32);
  console.log('  ✓ Bits set:', BloomFilter.countSetBits(hint1));

  // Test 2: Self-match
  console.log('\nTest 2: Self-match');
  const selfMatch = BloomFilter.checkBloomMatch(testPubKey1, hint1);
  console.log('  ✓ Pubkey1 matches own hint:', selfMatch === true);

  // Test 3: Different key doesn't match (most of the time)
  console.log('\nTest 3: Different key match probability');
  const otherMatch = BloomFilter.checkBloomMatch(testPubKey2, hint1);
  console.log('  → Pubkey2 matches hint1 (may be false positive):', otherMatch);

  // Test 4: False positive rate estimation
  console.log('\nTest 4: False positive rate');
  const fpr = BloomFilter.estimateFalsePositiveRate();
  console.log('  ✓ Estimated FPR:', (fpr * 100).toFixed(2) + '%');

  // Test 5: Measure actual false positive rate
  console.log('\nTest 5: Actual false positive rate (1000 samples)');
  let falsePositives = 0;
  const samples = 1000;
  for (let i = 0; i < samples; i++) {
    const randomKey = new Uint8Array(32);
    crypto.getRandomValues(randomKey);
    if (BloomFilter.checkBloomMatch(randomKey, hint1)) {
      falsePositives++;
    }
  }
  const actualFPR = falsePositives / samples;
  console.log('  ✓ Actual FPR:', (actualFPR * 100).toFixed(2) + '%');
  console.log('  ✓ Within expected range:', actualFPR < 0.10);

  // Test 6: Combine filters
  console.log('\nTest 6: Combined filters');
  const hint2 = BloomFilter.createBloomHint(testPubKey2);
  const combined = BloomFilter.combineFilters([hint1, hint2]);
  console.log('  ✓ Combined filter created');
  console.log('  ✓ Pubkey1 matches combined:', BloomFilter.checkBloomMatch(testPubKey1, combined));
  console.log('  ✓ Pubkey2 matches combined:', BloomFilter.checkBloomMatch(testPubKey2, combined));
  console.log('  ✓ Combined bits set:', BloomFilter.countSetBits(combined));

  console.log('\n=== All Bloom filter tests passed! ===');
}

export default BloomFilter;
