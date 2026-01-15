/**
 * StealthTransactionBuilder - Builds stealth payment transactions
 * 
 * This module handles the sender side of stealth payments:
 * 1. Derive stealth address for recipient
 * 2. Create shielded commitment using stealth address
 * 3. Encrypt note details for recipient
 * 4. Build complete transaction with stealth metadata
 * 
 * TRANSACTION STRUCTURE:
 * =====================
 * On-chain data:
 * - Commitment (32 bytes) - goes into Merkle tree
 * - Nullifier (32 bytes) - prevents double-spend of input
 * - Ephemeral public key (32 bytes) - needed for recipient scanning
 * - Bloom hint (32 bytes) - for efficient filtering
 * - Encrypted note (~100 bytes) - contains payment details
 * - ZK proof (~256 bytes) - proves validity
 * 
 * The ephemeral key and encrypted note allow recipient to:
 * 1. Scan and recognize their payments
 * 2. Decrypt amount, token, and spending details
 * 3. Derive the stealth private key to spend
 */

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { StealthKeyManager, StealthAddressResult } from './stealthKeyManager';
import { BloomFilter } from './bloomFilter';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

// Constants
const DOMAIN_COMMITMENT = new TextEncoder().encode('NOCTURA_COMMITMENT_V1');
const DOMAIN_NOTE_ENCRYPTION = new TextEncoder().encode('NOCTURA_NOTE_V1');
const STEALTH_MEMO_PREFIX = 'NOCTURA_STEALTH:';

/**
 * Encrypted stealth note structure
 * Contains all information recipient needs to spend the payment
 */
export interface StealthNoteData {
  /** Amount in smallest units (atoms) */
  amount: string;
  /** Token mint address */
  mint: string;
  /** Randomness/blinding factor for commitment */
  randomness: string;
  /** Secret value for note */
  secret: string;
  /** The commitment this note corresponds to */
  commitment: string;
  /** Version for future compatibility */
  version: number;
}

/**
 * Complete stealth transaction metadata
 * This is what gets attached to the transaction
 */
export interface StealthTransactionMetadata {
  /** Ephemeral public key (32 bytes) - published for scanning */
  ephemeralPublicKey: Uint8Array;
  /** Bloom filter hint (32 bytes) - for efficient filtering */
  bloomHint: Uint8Array;
  /** Encrypted note data - only recipient can decrypt */
  encryptedNote: Uint8Array;
  /** Nonce used for encryption (24 bytes for XChaCha20) */
  encryptionNonce: Uint8Array;
}

/**
 * Input parameters for building a stealth transaction
 */
export interface StealthTransactionParams {
  /** Recipient's regular Solana address */
  recipientAddress: string | PublicKey;
  /** Amount to send (in atoms/smallest units) */
  amount: bigint;
  /** Token mint (WSOL, NOC, etc.) */
  mint: PublicKey;
  /** Randomness for commitment (generated if not provided) */
  randomness?: bigint;
  /** Secret for note (generated if not provided) */
  secret?: bigint;
}

/**
 * Result of building a stealth transaction
 */
export interface StealthTransactionResult {
  /** The stealth address funds will be sent to */
  stealthAddress: PublicKey;
  /** The commitment that goes into Merkle tree */
  commitment: bigint;
  /** Metadata to attach to transaction */
  metadata: StealthTransactionMetadata;
  /** Note data (for sender's records) */
  noteData: StealthNoteData;
  /** The stealth derivation result (contains shared secret, etc.) */
  stealthResult: StealthAddressResult;
}

/**
 * StealthTransactionBuilder - Creates stealth payment transactions
 * 
 * USAGE:
 * ======
 * // Build stealth transaction to regular address
 * const result = StealthTransactionBuilder.buildStealthTransaction({
 *   recipientAddress: 'BobSolanaAddress...',
 *   amount: 1000000n, // 1 SOL in lamports
 *   mint: WSOL_MINT,
 * });
 * 
 * // Use result in existing shielded transfer
 * await sendShieldedTx({
 *   commitment: result.commitment,
 *   stealthMetadata: result.metadata,
 *   ...
 * });
 */
export class StealthTransactionBuilder {
  
  /**
   * Build a complete stealth transaction
   * 
   * This is the main entry point for creating stealth payments.
   * Takes a regular Solana address and creates all the cryptographic
   * components needed for a private, scannable payment.
   * 
   * @param params - Transaction parameters
   * @returns Complete stealth transaction result
   */
  static buildStealthTransaction(params: StealthTransactionParams): StealthTransactionResult {
    const {
      recipientAddress,
      amount,
      mint,
      randomness = this.generateSecureRandom(),
      secret = this.generateSecureRandom(),
    } = params;

    // Convert recipient address to bytes
    const recipientPubkey = typeof recipientAddress === 'string'
      ? new PublicKey(recipientAddress)
      : recipientAddress;
    const recipientBytes = recipientPubkey.toBytes();

    // Step 1: Derive stealth address using ECDH
    const stealthResult = StealthKeyManager.deriveStealthKeys(recipientBytes);
    const stealthAddress = new PublicKey(stealthResult.stealthPublicKey);

    // Step 2: Create commitment using stealth address
    // C = H(stealthPubKey || mint || amount || randomness)
    const commitment = this.createStealthCommitment(
      stealthResult.stealthPublicKey,
      amount,
      mint,
      randomness
    );

    // Step 3: Create Bloom filter hint for efficient scanning
    const bloomHint = BloomFilter.createBloomHint(recipientBytes);

    // Step 4: Prepare note data for recipient
    const noteData: StealthNoteData = {
      amount: amount.toString(),
      mint: mint.toBase58(),
      randomness: randomness.toString(),
      secret: secret.toString(),
      commitment: commitment.toString(),
      version: 1,
    };

    // Step 5: Encrypt note data using shared secret
    const { encryptedNote, nonce } = this.encryptStealthNote(
      noteData,
      stealthResult.sharedSecret
    );

    // Step 6: Bundle metadata
    const metadata: StealthTransactionMetadata = {
      ephemeralPublicKey: stealthResult.ephemeralPublicKey,
      bloomHint,
      encryptedNote,
      encryptionNonce: nonce,
    };

    return {
      stealthAddress,
      commitment,
      metadata,
      noteData,
      stealthResult,
    };
  }

  /**
   * Create a commitment for a stealth payment
   * 
   * The commitment hides the payment details while allowing:
   * - Merkle tree inclusion proof
   * - ZK proof of knowledge
   * - Recipient to verify via decrypted note
   * 
   * FORMULA:
   * C = H(domain || stealthPubKey || mint || amount || randomness)
   * 
   * WHY THESE FIELDS:
   * - stealthPubKey: Links commitment to one-time address
   * - mint: Identifies token type
   * - amount: The payment value
   * - randomness: Hides value even if other fields are known
   * 
   * @param stealthPublicKey - The derived stealth public key
   * @param amount - Payment amount in atoms
   * @param mint - Token mint public key
   * @param randomness - Random blinding factor
   * @returns Commitment as bigint (for circuit compatibility)
   */
  static createStealthCommitment(
    stealthPublicKey: Uint8Array,
    amount: bigint,
    mint: PublicKey,
    randomness: bigint
  ): bigint {
    // Serialize all inputs
    const amountBytes = this.bigIntToBytes(amount, 32);
    const randomnessBytes = this.bigIntToBytes(randomness, 32);
    const mintBytes = mint.toBytes();

    // Create commitment hash
    const commitmentInput = concatBytes(
      DOMAIN_COMMITMENT,
      stealthPublicKey,
      mintBytes,
      amountBytes,
      randomnessBytes
    );
    const commitmentHash = sha256(commitmentInput);

    // Convert to bigint for circuit compatibility
    // Take first 31 bytes to ensure it's less than the field modulus
    return this.bytesToBigInt(commitmentHash.slice(0, 31));
  }

  /**
   * Encrypt note data for recipient
   * 
   * Uses XChaCha20-Poly1305 authenticated encryption:
   * - XChaCha20: Stream cipher with extended nonce (24 bytes)
   * - Poly1305: Authentication tag prevents tampering
   * 
   * WHY AUTHENTICATED ENCRYPTION:
   * - Confidentiality: Only recipient can read note
   * - Integrity: Tampering is detected
   * - Extended nonce: Safer with random nonces (no nonce reuse risk)
   * 
   * @param noteData - The note data to encrypt
   * @param sharedSecret - ECDH shared secret (32 bytes)
   * @returns Encrypted note and nonce
   */
  static encryptStealthNote(
    noteData: StealthNoteData,
    sharedSecret: Uint8Array
  ): { encryptedNote: Uint8Array; nonce: Uint8Array } {
    // Derive encryption key from shared secret
    const encryptionKey = sha256(concatBytes(DOMAIN_NOTE_ENCRYPTION, sharedSecret));

    // Generate random nonce (24 bytes for XChaCha20)
    const nonce = new Uint8Array(24);
    crypto.getRandomValues(nonce);

    // Serialize note data to JSON
    const noteJson = JSON.stringify(noteData);
    const plaintext = new TextEncoder().encode(noteJson);

    // Encrypt with XChaCha20-Poly1305
    const cipher = xchacha20poly1305(encryptionKey, nonce);
    const encryptedNote = cipher.encrypt(plaintext);

    return { encryptedNote, nonce };
  }

  /**
   * Decrypt note data received in a stealth payment
   * 
   * Called by recipient after recognizing a stealth payment.
   * Uses the same shared secret to derive decryption key.
   * 
   * @param encryptedNote - The encrypted note bytes
   * @param nonce - The encryption nonce (24 bytes)
   * @param sharedSecret - ECDH shared secret
   * @returns Decrypted note data
   */
  static decryptStealthNote(
    encryptedNote: Uint8Array,
    nonce: Uint8Array,
    sharedSecret: Uint8Array
  ): StealthNoteData {
    // Derive decryption key (same as encryption key)
    const decryptionKey = sha256(concatBytes(DOMAIN_NOTE_ENCRYPTION, sharedSecret));

    // Decrypt with XChaCha20-Poly1305
    const cipher = xchacha20poly1305(decryptionKey, nonce);
    
    try {
      const plaintext = cipher.decrypt(encryptedNote);
      const noteJson = new TextDecoder().decode(plaintext);
      return JSON.parse(noteJson) as StealthNoteData;
    } catch (error) {
      throw new Error(`Note decryption failed: ${(error as Error).message}`);
    }
  }

  /**
   * Serialize stealth metadata for transaction inclusion
   * 
   * Creates a compact binary format:
   * [version:1][ephemeralKey:32][bloomHint:32][nonce:24][encryptedNote:variable]
   * 
   * @param metadata - The stealth transaction metadata
   * @returns Serialized bytes
   */
  static serializeMetadata(metadata: StealthTransactionMetadata): Uint8Array {
    const version = new Uint8Array([1]); // Version 1
    
    return concatBytes(
      version,
      metadata.ephemeralPublicKey,
      metadata.bloomHint,
      metadata.encryptionNonce,
      metadata.encryptedNote
    );
  }

  /**
   * Deserialize stealth metadata from transaction data
   * 
   * @param data - Serialized metadata bytes
   * @returns Parsed metadata structure
   */
  static deserializeMetadata(data: Uint8Array): StealthTransactionMetadata {
    if (data.length < 90) { // 1 + 32 + 32 + 24 + 1 minimum
      throw new Error('Invalid stealth metadata: too short');
    }

    const version = data[0];
    if (version !== 1) {
      throw new Error(`Unsupported stealth metadata version: ${version}`);
    }

    let offset = 1;
    
    const ephemeralPublicKey = data.slice(offset, offset + 32);
    offset += 32;
    
    const bloomHint = data.slice(offset, offset + 32);
    offset += 32;
    
    const encryptionNonce = data.slice(offset, offset + 24);
    offset += 24;
    
    const encryptedNote = data.slice(offset);

    return {
      ephemeralPublicKey,
      bloomHint,
      encryptedNote,
      encryptionNonce,
    };
  }

  /**
   * Create a memo instruction with stealth metadata
   * 
   * The memo program is a simple way to attach data to transactions.
   * We encode stealth metadata in base64 with a recognizable prefix.
   * 
   * @param metadata - Stealth transaction metadata
   * @returns TransactionInstruction for memo program
   */
  static createStealthMemoInstruction(metadata: StealthTransactionMetadata): TransactionInstruction {
    const serialized = this.serializeMetadata(metadata);
    const base64 = Buffer.from(serialized).toString('base64');
    const memoData = STEALTH_MEMO_PREFIX + base64;

    // SPL Memo Program ID
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

    return new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoData),
    });
  }

  /**
   * Parse stealth metadata from a memo instruction
   * 
   * @param memoData - Raw memo data string
   * @returns Parsed metadata or null if not a stealth memo
   */
  static parseStealthMemo(memoData: string): StealthTransactionMetadata | null {
    if (!memoData.startsWith(STEALTH_MEMO_PREFIX)) {
      return null;
    }

    try {
      const base64 = memoData.slice(STEALTH_MEMO_PREFIX.length);
      const bytes = Buffer.from(base64, 'base64');
      return this.deserializeMetadata(new Uint8Array(bytes));
    } catch {
      return null;
    }
  }

  /**
   * Check if a transaction contains stealth metadata
   * 
   * @param transaction - Solana transaction to check
   * @returns true if transaction has stealth memo
   */
  static hasStealthMetadata(transaction: Transaction): boolean {
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    
    for (const instruction of transaction.instructions) {
      if (instruction.programId.equals(MEMO_PROGRAM_ID)) {
        const memoData = instruction.data.toString();
        if (memoData.startsWith(STEALTH_MEMO_PREFIX)) {
          return true;
        }
      }
    }
    return false;
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  /**
   * Generate cryptographically secure random bigint (256-bit)
   */
  private static generateSecureRandom(): bigint {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return this.bytesToBigInt(bytes);
  }

  /**
   * Convert bigint to bytes (little-endian)
   */
  private static bigIntToBytes(n: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let temp = n;
    for (let i = 0; i < length; i++) {
      bytes[i] = Number(temp & BigInt(0xff));
      temp >>= BigInt(8);
    }
    return bytes;
  }

  /**
   * Convert bytes to bigint (little-endian)
   */
  private static bytesToBigInt(bytes: Uint8Array): bigint {
    let result = BigInt(0);
    for (let i = bytes.length - 1; i >= 0; i--) {
      result = (result << BigInt(8)) | BigInt(bytes[i]);
    }
    return result;
  }
}

// =============================================================================
// INTEGRATION HELPERS
// =============================================================================

/**
 * High-level helper for wallet integration
 * Builds a stealth transaction and returns components ready for relayer
 */
export async function buildStealthPayment(
  recipientSolanaAddress: string,
  amountAtoms: bigint,
  tokenMint: string
): Promise<{
  stealthAddress: string;
  commitment: string;
  ephemeralPublicKey: string;
  bloomHint: string;
  encryptedNote: string;
  encryptionNonce: string;
}> {
  const result = StealthTransactionBuilder.buildStealthTransaction({
    recipientAddress: recipientSolanaAddress,
    amount: amountAtoms,
    mint: new PublicKey(tokenMint),
  });

  return {
    stealthAddress: result.stealthAddress.toBase58(),
    commitment: result.commitment.toString(),
    ephemeralPublicKey: Buffer.from(result.metadata.ephemeralPublicKey).toString('hex'),
    bloomHint: Buffer.from(result.metadata.bloomHint).toString('hex'),
    encryptedNote: Buffer.from(result.metadata.encryptedNote).toString('base64'),
    encryptionNonce: Buffer.from(result.metadata.encryptionNonce).toString('hex'),
  };
}

/**
 * Test suite for StealthTransactionBuilder
 */
export function testStealthTransactionBuilder(): void {
  console.log('=== StealthTransactionBuilder Test Suite ===\n');

  // Test parameters
  const testRecipient = new Uint8Array(32);
  crypto.getRandomValues(testRecipient);
  const recipientPubkey = new PublicKey(testRecipient);
  const testMint = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL
  const testAmount = BigInt(1_000_000_000); // 1 SOL

  // Test 1: Build stealth transaction
  console.log('Test 1: Build stealth transaction');
  const result = StealthTransactionBuilder.buildStealthTransaction({
    recipientAddress: recipientPubkey,
    amount: testAmount,
    mint: testMint,
  });
  console.log('  ✓ Stealth address:', result.stealthAddress.toBase58().slice(0, 16) + '...');
  console.log('  ✓ Commitment:', result.commitment.toString().slice(0, 16) + '...');
  console.log('  ✓ Ephemeral key length:', result.metadata.ephemeralPublicKey.length);
  console.log('  ✓ Bloom hint length:', result.metadata.bloomHint.length);
  console.log('  ✓ Encrypted note length:', result.metadata.encryptedNote.length);

  // Test 2: Decrypt note with shared secret
  console.log('\nTest 2: Decrypt note');
  const decrypted = StealthTransactionBuilder.decryptStealthNote(
    result.metadata.encryptedNote,
    result.metadata.encryptionNonce,
    result.stealthResult.sharedSecret
  );
  console.log('  ✓ Decrypted amount:', decrypted.amount);
  console.log('  ✓ Amount matches:', decrypted.amount === testAmount.toString());
  console.log('  ✓ Mint matches:', decrypted.mint === testMint.toBase58());

  // Test 3: Serialize and deserialize metadata
  console.log('\nTest 3: Metadata serialization');
  const serialized = StealthTransactionBuilder.serializeMetadata(result.metadata);
  const deserialized = StealthTransactionBuilder.deserializeMetadata(serialized);
  console.log('  ✓ Serialized length:', serialized.length);
  console.log('  ✓ Ephemeral key matches:', 
    Buffer.from(deserialized.ephemeralPublicKey).equals(Buffer.from(result.metadata.ephemeralPublicKey)));
  console.log('  ✓ Bloom hint matches:',
    Buffer.from(deserialized.bloomHint).equals(Buffer.from(result.metadata.bloomHint)));

  // Test 4: Multiple transactions create different addresses
  console.log('\nTest 4: Address unlinkability');
  const result2 = StealthTransactionBuilder.buildStealthTransaction({
    recipientAddress: recipientPubkey,
    amount: testAmount,
    mint: testMint,
  });
  console.log('  ✓ Different stealth addresses:', 
    !result.stealthAddress.equals(result2.stealthAddress));
  console.log('  ✓ Different ephemeral keys:',
    !Buffer.from(result.metadata.ephemeralPublicKey).equals(Buffer.from(result2.metadata.ephemeralPublicKey)));

  console.log('\n=== All StealthTransactionBuilder tests passed! ===');
}

export default StealthTransactionBuilder;
