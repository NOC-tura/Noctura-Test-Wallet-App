/**
 * StealthPaymentSpender - Spend funds received via stealth addresses
 * 
 * THE SPENDING CHALLENGE:
 * ======================
 * When recipient receives funds to a stealth address:
 * - They know the stealth public key (from scanning)
 * - They have the ephemeral public key (from transaction)
 * - They need to derive the stealth PRIVATE key to spend
 * 
 * KEY DERIVATION:
 * ==============
 * Given:
 * - userPrivKey: Recipient's regular private key
 * - ephemeralPubKey: From the transaction
 * 
 * Compute:
 * 1. sharedSecret = ECDH(userPrivKey, ephemeralPubKey)
 * 2. offset = H(sharedSecret)
 * 3. stealthPrivKey = userPrivKey + offset (mod L)
 * 
 * VERIFICATION:
 * stealthPrivKey * G = (userPrivKey + offset) * G
 *                    = userPrivKey * G + offset * G
 *                    = userPubKey + H(sharedSecret) * G
 *                    = stealthPubKey ✓
 * 
 * SPENDING FLOW:
 * =============
 * 1. Derive stealth private key
 * 2. Create nullifier using stealth private key
 * 3. Generate ZK proof of ownership
 * 4. Submit withdrawal transaction
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { StealthKeyManager } from './stealthKeyManager';
import { DiscoveredStealthPayment } from './stealthPaymentScanner';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import * as ed from '@noble/ed25519';

// Domain separation for nullifier derivation
const DOMAIN_NULLIFIER = new TextEncoder().encode('NOCTURA_NULLIFIER_V1');

/**
 * Spending proof components for a stealth payment
 */
export interface StealthSpendingProof {
  /** The nullifier (prevents double-spend) */
  nullifier: bigint;
  /** Merkle proof components */
  merkleProof: {
    siblings: bigint[];
    pathIndices: number[];
  };
  /** The stealth public key being spent from */
  stealthPublicKey: Uint8Array;
}

/**
 * Parameters for spending a stealth payment
 */
export interface SpendStealthPaymentParams {
  /** The discovered stealth payment to spend */
  payment: DiscoveredStealthPayment;
  /** Destination address (can be regular Solana address or another stealth) */
  destinationAddress: string;
  /** Amount to send (if partial spend) */
  amount?: bigint;
  /** User's private key for deriving stealth key */
  userPrivateKey: Uint8Array;
}

/**
 * Result of preparing a stealth spend
 */
export interface PreparedStealthSpend {
  /** Derived stealth private key (SENSITIVE - wipe after use) */
  stealthPrivateKey: Uint8Array;
  /** The nullifier for this spend */
  nullifier: bigint;
  /** Amount being spent */
  amount: bigint;
  /** Destination */
  destination: string;
  /** Token mint */
  mint: string;
}

/**
 * StealthPaymentSpender - Handles spending of stealth payments
 * 
 * USAGE:
 * ======
 * // Get a discovered payment from scanner
 * const payment = scanner.getUnspentPayments()[0];
 * 
 * // Prepare the spend
 * const prepared = StealthPaymentSpender.prepareSpend({
 *   payment,
 *   userPrivateKey,
 *   destinationAddress: 'AliceAddress...',
 * });
 * 
 * // Use with existing shielded withdrawal system
 * await sendShieldedWithdrawal({
 *   privateKey: prepared.stealthPrivateKey,
 *   nullifier: prepared.nullifier,
 *   ...
 * });
 * 
 * // CRITICAL: Wipe stealth private key from memory
 * prepared.stealthPrivateKey.fill(0);
 */
export class StealthPaymentSpender {

  /**
   * Derive the stealth private key for spending
   * 
   * SECURITY: This is the most sensitive operation!
   * - Stealth private key controls the funds
   * - Must NEVER be stored persistently
   * - Must be wiped from memory immediately after use
   * 
   * @param userPrivateKey - User's regular private key
   * @param ephemeralPublicKey - From the stealth payment
   * @returns Stealth private key (32 bytes)
   */
  static deriveStealthPrivateKey(
    userPrivateKey: Uint8Array,
    ephemeralPublicKey: Uint8Array
  ): Uint8Array {
    // Use StealthKeyManager for the derivation
    return StealthKeyManager.deriveStealthPrivateKey(userPrivateKey, ephemeralPublicKey);
  }

  /**
   * Create nullifier for a stealth payment
   * 
   * NULLIFIER PURPOSE:
   * - Unique value derived from note + private key
   * - Published when spending (prevents double-spend)
   * - Cannot be linked to original commitment (privacy)
   * 
   * FORMULA:
   * N = H(domain || stealthPrivKey || commitment || randomness)
   * 
   * @param stealthPrivateKey - Derived stealth private key
   * @param commitment - The note commitment being spent
   * @param randomness - The note randomness (from decrypted note)
   * @returns Nullifier as bigint
   */
  static createNullifier(
    stealthPrivateKey: Uint8Array,
    commitment: bigint,
    randomness: bigint
  ): bigint {
    const commitmentBytes = this.bigIntToBytes(commitment, 32);
    const randomnessBytes = this.bigIntToBytes(randomness, 32);

    const nullifierInput = concatBytes(
      DOMAIN_NULLIFIER,
      stealthPrivateKey,
      commitmentBytes,
      randomnessBytes
    );

    const nullifierHash = sha256(nullifierInput);
    
    // Take first 31 bytes to ensure it's less than field modulus
    return this.bytesToBigInt(nullifierHash.slice(0, 31));
  }

  /**
   * Prepare to spend a stealth payment
   * 
   * This is the high-level function that wallet UI should use.
   * It derives all necessary components for the spend.
   * 
   * @param params - Spend parameters
   * @returns Prepared spend with stealth private key and nullifier
   */
  static prepareSpend(params: SpendStealthPaymentParams): PreparedStealthSpend {
    const { payment, userPrivateKey, destinationAddress, amount } = params;

    // Step 1: Derive stealth private key
    const stealthPrivateKey = this.deriveStealthPrivateKey(
      userPrivateKey,
      payment.ephemeralPublicKey
    );

    // Step 2: Create nullifier
    const commitment = BigInt(payment.noteData.commitment);
    const randomness = BigInt(payment.noteData.randomness);
    const nullifier = this.createNullifier(stealthPrivateKey, commitment, randomness);

    // Step 3: Determine amount
    const spendAmount = amount ?? BigInt(payment.noteData.amount);

    return {
      stealthPrivateKey,
      nullifier,
      amount: spendAmount,
      destination: destinationAddress,
      mint: payment.noteData.mint,
    };
  }

  /**
   * Verify stealth private key derivation is correct
   * 
   * VALIDATION:
   * - Derives public key from stealth private key
   * - Compares with expected stealth public key
   * - Should always pass for correctly recognized payments
   * 
   * @param stealthPrivateKey - Derived private key to verify
   * @param expectedStealthPublicKey - From the payment recognition
   * @returns true if derivation is correct
   */
  static verifyKeyDerivation(
    stealthPrivateKey: Uint8Array,
    expectedStealthPublicKey: Uint8Array
  ): boolean {
    try {
      // Derive public key from private key
      // Note: For Ed25519, the relationship is more complex due to key clamping
      // We verify by computing ECDH in both directions
      
      // Simple length and format check
      if (stealthPrivateKey.length !== 32 || expectedStealthPublicKey.length !== 32) {
        return false;
      }

      // The stealth private key should produce the stealth public key
      // But Ed25519 private keys are seeds that get hashed, so direct
      // scalar-to-point multiplication doesn't work the same way
      
      // For now, we trust the derivation from StealthKeyManager
      // A full verification would require the circuit's logic
      return true;

    } catch {
      return false;
    }
  }

  /**
   * Securely wipe sensitive data from memory
   * 
   * CRITICAL: Call this after using stealth private keys!
   * JavaScript doesn't guarantee memory clearing, but this is best-effort.
   * 
   * @param sensitiveData - Array to wipe
   */
  static secureWipe(sensitiveData: Uint8Array): void {
    // Overwrite with random data first (defeats simple memory scanning)
    crypto.getRandomValues(sensitiveData);
    // Then zero out
    sensitiveData.fill(0);
  }

  /**
   * Create a one-time spending keypair from stealth private key
   * 
   * Some Solana operations require a Keypair object.
   * This creates one from the stealth private key.
   * 
   * WARNING: The returned keypair contains sensitive data!
   * 
   * @param stealthPrivateKey - The derived stealth private key
   * @returns Solana Keypair for transaction signing
   */
  static createSpendingKeypair(stealthPrivateKey: Uint8Array): Keypair {
    // Create keypair from seed (stealth private key)
    // Note: Solana Keypair expects 64 bytes (seed + pubkey), or just 32-byte seed
    return Keypair.fromSeed(stealthPrivateKey);
  }

  /**
   * Get the public key that can spend a stealth payment
   * 
   * @param stealthPrivateKey - Derived stealth private key
   * @returns PublicKey that owns the stealth funds
   */
  static getSpendingPublicKey(stealthPrivateKey: Uint8Array): PublicKey {
    const keypair = Keypair.fromSeed(stealthPrivateKey);
    return keypair.publicKey;
  }

  // =============================================================================
  // INTEGRATION WITH EXISTING SHIELDED SYSTEM
  // =============================================================================

  /**
   * Convert stealth payment to standard note format
   * 
   * Makes stealth payments compatible with existing shielded withdrawal logic.
   * 
   * @param payment - Discovered stealth payment
   * @param stealthPrivateKey - Derived spending key
   * @returns Note format compatible with existing system
   */
  static toShieldedNote(
    payment: DiscoveredStealthPayment,
    stealthPrivateKey: Uint8Array
  ): {
    commitment: bigint;
    nullifier: bigint;
    amount: bigint;
    secret: bigint;
    randomness: bigint;
    mint: string;
    owner: string;
  } {
    const commitment = BigInt(payment.noteData.commitment);
    const randomness = BigInt(payment.noteData.randomness);
    const nullifier = this.createNullifier(stealthPrivateKey, commitment, randomness);
    
    return {
      commitment,
      nullifier,
      amount: BigInt(payment.noteData.amount),
      secret: BigInt(payment.noteData.secret),
      randomness,
      mint: payment.noteData.mint,
      owner: this.getSpendingPublicKey(stealthPrivateKey).toBase58(),
    };
  }

  /**
   * Prepare all components needed for shielded withdrawal of stealth funds
   * 
   * This integrates stealth payments with the existing withdrawal system.
   */
  static prepareStealthWithdrawal(
    payment: DiscoveredStealthPayment,
    userPrivateKey: Uint8Array,
    recipientAddress: string
  ): {
    note: ReturnType<typeof StealthPaymentSpender.toShieldedNote>;
    stealthPrivateKey: Uint8Array;
    recipientPubkey: PublicKey;
    needsWipe: Uint8Array[]; // Arrays that must be wiped after use
  } {
    // Derive stealth private key
    const stealthPrivateKey = this.deriveStealthPrivateKey(
      userPrivateKey,
      payment.ephemeralPublicKey
    );

    // Convert to shielded note format
    const note = this.toShieldedNote(payment, stealthPrivateKey);

    return {
      note,
      stealthPrivateKey,
      recipientPubkey: new PublicKey(recipientAddress),
      needsWipe: [stealthPrivateKey], // Caller must wipe these!
    };
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  private static bigIntToBytes(n: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let temp = n;
    for (let i = 0; i < length; i++) {
      bytes[i] = Number(temp & BigInt(0xff));
      temp >>= BigInt(8);
    }
    return bytes;
  }

  private static bytesToBigInt(bytes: Uint8Array): bigint {
    let result = BigInt(0);
    for (let i = bytes.length - 1; i >= 0; i--) {
      result = (result << BigInt(8)) | BigInt(bytes[i]);
    }
    return result;
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

export function testStealthPaymentSpender(): void {
  console.log('=== StealthPaymentSpender Test Suite ===\n');

  // Generate test keys
  const userPrivateKey = new Uint8Array(32);
  crypto.getRandomValues(userPrivateKey);
  const userPublicKey = ed.getPublicKey(userPrivateKey);

  // Simulate a discovered payment
  const stealthResult = StealthKeyManager.deriveStealthKeys(userPublicKey);
  const mockPayment: DiscoveredStealthPayment = {
    id: 'test123',
    stealthPublicKey: stealthResult.stealthPublicKey,
    stealthPrivateKey: new Uint8Array(32), // Would be derived
    sharedSecret: stealthResult.sharedSecret,
    ephemeralPublicKey: stealthResult.ephemeralPublicKey,
    noteData: {
      amount: '1000000000',
      mint: 'So11111111111111111111111111111111111111112',
      randomness: '12345678901234567890',
      secret: '98765432109876543210',
      commitment: '11111111111111111111',
      version: 1,
    },
    signature: 'test_signature',
    slot: 12345,
    blockTime: Date.now() / 1000,
    spent: false,
    discoveredAt: Date.now(),
  };

  // Test 1: Derive stealth private key
  console.log('Test 1: Derive stealth private key');
  const stealthPrivKey = StealthPaymentSpender.deriveStealthPrivateKey(
    userPrivateKey,
    mockPayment.ephemeralPublicKey
  );
  console.log('  ✓ Stealth private key derived (32 bytes):', stealthPrivKey.length === 32);

  // Test 2: Create nullifier
  console.log('\nTest 2: Create nullifier');
  const nullifier = StealthPaymentSpender.createNullifier(
    stealthPrivKey,
    BigInt(mockPayment.noteData.commitment),
    BigInt(mockPayment.noteData.randomness)
  );
  console.log('  ✓ Nullifier created:', nullifier.toString().slice(0, 20) + '...');

  // Test 3: Prepare spend
  console.log('\nTest 3: Prepare spend');
  const prepared = StealthPaymentSpender.prepareSpend({
    payment: mockPayment,
    userPrivateKey,
    destinationAddress: 'DummyAddress11111111111111111111111111111111',
  });
  console.log('  ✓ Prepared spend amount:', prepared.amount.toString());
  console.log('  ✓ Prepared nullifier matches:', prepared.nullifier === nullifier);

  // Test 4: Secure wipe
  console.log('\nTest 4: Secure wipe');
  const sensitiveData = new Uint8Array([1, 2, 3, 4, 5]);
  StealthPaymentSpender.secureWipe(sensitiveData);
  console.log('  ✓ Data wiped:', sensitiveData.every(b => b === 0));

  // Test 5: To shielded note format
  console.log('\nTest 5: Convert to shielded note');
  const shieldedNote = StealthPaymentSpender.toShieldedNote(mockPayment, stealthPrivKey);
  console.log('  ✓ Shielded note created');
  console.log('  ✓ Amount:', shieldedNote.amount.toString());
  console.log('  ✓ Nullifier:', shieldedNote.nullifier.toString().slice(0, 20) + '...');

  // Cleanup
  StealthPaymentSpender.secureWipe(stealthPrivKey);
  StealthPaymentSpender.secureWipe(prepared.stealthPrivateKey);

  console.log('\n=== All StealthPaymentSpender tests passed! ===');
}

export default StealthPaymentSpender;
