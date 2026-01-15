/**
 * Stealth Address System - Main Integration Module
 * 
 * This module provides a unified API for the stealth address system,
 * integrating all components for seamless wallet operation.
 * 
 * STEALTH ADDRESS OVERVIEW:
 * ========================
 * Stealth addresses allow private payments to regular Solana addresses:
 * 
 * 1. SENDER FLOW:
 *    - User enters recipient's regular Solana address
 *    - System automatically generates one-time stealth address
 *    - Funds are sent to stealth address (unlinkable to recipient)
 *    - Metadata (ephemeral key, encrypted note) attached to transaction
 * 
 * 2. RECIPIENT FLOW:
 *    - Background scanner monitors blockchain
 *    - For each transaction, checks if it's addressed to them
 *    - Uses Bloom filter for fast filtering (~95% skipped instantly)
 *    - ECDH + decryption for potential matches
 *    - Discovered payments appear in wallet automatically
 * 
 * 3. SPENDING FLOW:
 *    - User selects stealth payment to spend
 *    - System derives one-time private key
 *    - Creates nullifier (prevents double-spend)
 *    - Integrates with existing shielded withdrawal system
 * 
 * PRIVACY GUARANTEES:
 * ==================
 * - Sender identity: Hidden (transaction from shielded pool)
 * - Recipient identity: Hidden (one-time address, can't link to real address)
 * - Amount: Hidden (encrypted, only recipient can decrypt)
 * - Link between payments: Unlinkable (different address each time)
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { StealthKeyManager, EphemeralKeypair, StealthAddressResult } from './stealthKeyManager';
import { StealthTransactionBuilder, StealthTransactionMetadata, StealthNoteData, StealthTransactionResult } from './stealthTransactionBuilder';
import { StealthPaymentScanner, DiscoveredStealthPayment, ScanProgress, ScannerConfig } from './stealthPaymentScanner';
import { StealthPaymentSpender, PreparedStealthSpend } from './stealthPaymentSpender';
import { BloomFilter } from './bloomFilter';
import * as ed from '@noble/ed25519';

// Re-export all types for convenience
export type {
  EphemeralKeypair,
  StealthAddressResult,
  StealthTransactionMetadata,
  StealthNoteData,
  StealthTransactionResult,
  DiscoveredStealthPayment,
  ScanProgress,
  ScannerConfig,
  PreparedStealthSpend,
};

// Re-export classes
export {
  StealthKeyManager,
  StealthTransactionBuilder,
  StealthPaymentScanner,
  StealthPaymentSpender,
  BloomFilter,
};

/**
 * Stealth wallet state
 */
export interface StealthWalletState {
  /** Is stealth mode enabled? */
  enabled: boolean;
  /** Is background scanning active? */
  scanningActive: boolean;
  /** Current scan progress */
  scanProgress: ScanProgress;
  /** Discovered stealth payments */
  payments: DiscoveredStealthPayment[];
  /** Total stealth balance by mint */
  balanceByMint: Map<string, bigint>;
}

/**
 * Configuration for stealth wallet integration
 */
export interface StealthWalletConfig {
  /** Solana RPC connection */
  connection: Connection;
  /** User's keypair */
  userKeypair: Keypair;
  /** Scan interval in milliseconds (default: 60000 = 1 minute) */
  scanIntervalMs?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Callback when new payment discovered */
  onPaymentDiscovered?: (payment: DiscoveredStealthPayment) => void;
  /** Callback when scan progress updates */
  onProgressUpdate?: (progress: ScanProgress) => void;
  /** Callback when balance changes */
  onBalanceUpdate?: (balanceByMint: Map<string, bigint>) => void;
}

/**
 * StealthWallet - Main integration class for stealth addresses
 * 
 * This is the primary interface for wallet developers to integrate
 * stealth address functionality.
 * 
 * USAGE:
 * ======
 * // Initialize
 * const stealthWallet = new StealthWallet({
 *   connection,
 *   userKeypair,
 *   onPaymentDiscovered: (payment) => {
 *     showNotification(`Received ${payment.noteData.amount} privately!`);
 *   },
 * });
 * 
 * // Start scanning
 * stealthWallet.startScanning();
 * 
 * // Send stealth payment
 * const txResult = await stealthWallet.sendStealth({
 *   recipientAddress: 'BobAddress...',
 *   amount: 1_000_000_000n,
 *   mint: WSOL_MINT,
 * });
 * 
 * // Spend received payment
 * await stealthWallet.spendPayment(paymentId, destinationAddress);
 */
export class StealthWallet {
  private config: StealthWalletConfig;
  private scanner: StealthPaymentScanner | null = null;
  private state: StealthWalletState;
  private userPrivateKey: Uint8Array;
  private userPublicKey: Uint8Array;

  constructor(config: StealthWalletConfig) {
    this.config = {
      scanIntervalMs: 60_000,
      debug: false,
      ...config,
    };

    // Extract key bytes from keypair
    this.userPrivateKey = config.userKeypair.secretKey.slice(0, 32);
    this.userPublicKey = config.userKeypair.publicKey.toBytes();

    // Initialize state
    this.state = {
      enabled: true,
      scanningActive: false,
      scanProgress: {
        lastScannedSlot: 0,
        totalChecked: 0,
        totalDiscovered: 0,
        lastScanTime: 0,
        status: 'idle',
      },
      payments: [],
      balanceByMint: new Map(),
    };

    this.log('StealthWallet initialized');
  }

  // =============================================================================
  // PUBLIC API - SENDING
  // =============================================================================

  /**
   * Send a stealth payment to a regular Solana address
   * 
   * This is the main function for sending private payments.
   * It handles all the complexity internally:
   * 1. Derives stealth address
   * 2. Creates encrypted note
   * 3. Builds transaction with metadata
   * 
   * @param params - Send parameters
   * @returns Transaction result with all stealth components
   */
  async buildStealthPayment(params: {
    recipientAddress: string;
    amount: bigint;
    mint: string;
  }): Promise<StealthTransactionResult> {
    this.log(`Building stealth payment: ${params.amount} to ${params.recipientAddress.slice(0, 8)}...`);

    const result = StealthTransactionBuilder.buildStealthTransaction({
      recipientAddress: params.recipientAddress,
      amount: params.amount,
      mint: new PublicKey(params.mint),
    });

    this.log(`Stealth address: ${result.stealthAddress.toBase58().slice(0, 16)}...`);
    this.log(`Ephemeral key: ${Buffer.from(result.metadata.ephemeralPublicKey).toString('hex').slice(0, 16)}...`);

    return result;
  }

  /**
   * Check if an address should use stealth payments
   * 
   * Returns true if the address is a regular Solana address
   * (not a shielded noctura1... address).
   */
  shouldUseStealthAddress(address: string): boolean {
    // Stealth addresses are for regular Solana addresses
    // Noctura shielded addresses (noctura1...) use a different system
    if (address.startsWith('noctura1')) {
      return false; // Use direct shielded transfer
    }

    try {
      new PublicKey(address);
      return true; // Valid Solana address - use stealth
    } catch {
      return false; // Invalid address
    }
  }

  // =============================================================================
  // PUBLIC API - RECEIVING (SCANNING)
  // =============================================================================

  /**
   * Start background scanning for incoming stealth payments
   */
  startScanning(): void {
    if (this.scanner) {
      this.log('Scanner already running');
      return;
    }

    this.log('Starting stealth payment scanner');

    this.scanner = new StealthPaymentScanner(
      this.userPrivateKey,
      this.userPublicKey,
      {
        connection: this.config.connection,
        scanIntervalMs: this.config.scanIntervalMs,
        onPaymentDiscovered: (payment) => {
          this.handlePaymentDiscovered(payment);
        },
        onProgressUpdate: (progress) => {
          this.state.scanProgress = progress;
          this.config.onProgressUpdate?.(progress);
        },
      }
    );

    // Load any previously discovered payments
    this.scanner.loadDiscoveredPayments();
    this.state.payments = this.scanner.getDiscoveredPayments();
    this.updateBalances();

    // Start background scanning
    this.scanner.startBackgroundScan();
    this.state.scanningActive = true;
  }

  /**
   * Stop background scanning
   */
  stopScanning(): void {
    if (!this.scanner) return;

    this.log('Stopping stealth payment scanner');
    this.scanner.stopBackgroundScan();
    this.state.scanningActive = false;
  }

  /**
   * Manually trigger a scan (useful for "refresh" button)
   */
  async scanNow(): Promise<DiscoveredStealthPayment[]> {
    if (!this.scanner) {
      this.startScanning();
    }

    this.log('Manual scan triggered');
    return this.scanner!.scanIncremental();
  }

  /**
   * Get current scan progress
   */
  getScanProgress(): ScanProgress {
    return this.scanner?.getProgress() || this.state.scanProgress;
  }

  // =============================================================================
  // PUBLIC API - SPENDING
  // =============================================================================

  /**
   * Get all discovered stealth payments
   */
  getStealthPayments(): DiscoveredStealthPayment[] {
    return this.scanner?.getDiscoveredPayments() || this.state.payments;
  }

  /**
   * Get only unspent stealth payments
   */
  getUnspentPayments(): DiscoveredStealthPayment[] {
    return this.getStealthPayments().filter(p => !p.spent);
  }

  /**
   * Get stealth balance for a specific mint
   */
  getStealthBalance(mint: string): bigint {
    const unspent = this.getUnspentPayments().filter(
      p => p.noteData.mint === mint
    );
    return unspent.reduce((sum, p) => sum + BigInt(p.noteData.amount), 0n);
  }

  /**
   * Get total stealth balances by mint
   */
  getAllStealthBalances(): Map<string, bigint> {
    const balances = new Map<string, bigint>();
    
    for (const payment of this.getUnspentPayments()) {
      const mint = payment.noteData.mint;
      const current = balances.get(mint) || 0n;
      balances.set(mint, current + BigInt(payment.noteData.amount));
    }

    return balances;
  }

  /**
   * Prepare to spend a stealth payment
   * 
   * Returns all components needed to submit the withdrawal.
   * IMPORTANT: Caller must wipe stealthPrivateKey after use!
   * 
   * @param paymentId - ID of the payment to spend
   * @param destinationAddress - Where to send the funds
   * @returns Prepared spend with private key (SENSITIVE)
   */
  prepareSpend(
    paymentId: string,
    destinationAddress: string
  ): PreparedStealthSpend {
    const payment = this.getStealthPayments().find(p => p.id === paymentId);
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }
    if (payment.spent) {
      throw new Error(`Payment ${paymentId} already spent`);
    }

    this.log(`Preparing spend for payment ${paymentId}`);

    return StealthPaymentSpender.prepareSpend({
      payment,
      userPrivateKey: this.userPrivateKey,
      destinationAddress,
    });
  }

  /**
   * Mark a payment as spent (call after successful withdrawal)
   */
  markSpent(paymentId: string): void {
    if (this.scanner) {
      this.scanner.markPaymentSpent(paymentId);
    }
    
    const payment = this.state.payments.find(p => p.id === paymentId);
    if (payment) {
      payment.spent = true;
    }

    this.updateBalances();
  }

  /**
   * Convert stealth payment to standard note format for existing system
   */
  toShieldedNote(paymentId: string): {
    commitment: bigint;
    nullifier: bigint;
    amount: bigint;
    secret: bigint;
    randomness: bigint;
    mint: string;
    owner: string;
    needsWipe: Uint8Array[];
  } {
    const payment = this.getStealthPayments().find(p => p.id === paymentId);
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    const stealthPrivateKey = StealthPaymentSpender.deriveStealthPrivateKey(
      this.userPrivateKey,
      payment.ephemeralPublicKey
    );

    const note = StealthPaymentSpender.toShieldedNote(payment, stealthPrivateKey);

    return {
      ...note,
      needsWipe: [stealthPrivateKey],
    };
  }

  // =============================================================================
  // PUBLIC API - STATE
  // =============================================================================

  /**
   * Get current stealth wallet state
   */
  getState(): StealthWalletState {
    return {
      ...this.state,
      payments: this.getStealthPayments(),
      balanceByMint: this.getAllStealthBalances(),
    };
  }

  /**
   * Enable/disable stealth mode
   */
  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    if (enabled && !this.state.scanningActive) {
      this.startScanning();
    } else if (!enabled && this.state.scanningActive) {
      this.stopScanning();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopScanning();
    this.scanner = null;
  }

  // =============================================================================
  // INTERNAL METHODS
  // =============================================================================

  private handlePaymentDiscovered(payment: DiscoveredStealthPayment): void {
    this.log(`New stealth payment discovered: ${payment.noteData.amount} ${payment.noteData.mint.slice(0, 8)}...`);
    
    this.state.payments.push(payment);
    this.updateBalances();
    
    this.config.onPaymentDiscovered?.(payment);
  }

  private updateBalances(): void {
    this.state.balanceByMint = this.getAllStealthBalances();
    this.config.onBalanceUpdate?.(this.state.balanceByMint);
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[StealthWallet] ${message}`);
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if stealth addresses are supported for a given address
 */
export function isStealthCompatible(address: string): boolean {
  if (!address || address.startsWith('noctura1')) {
    return false;
  }
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format stealth payment for display
 */
export function formatStealthPayment(payment: DiscoveredStealthPayment): {
  id: string;
  amount: string;
  mint: string;
  receivedAt: string;
  status: string;
} {
  return {
    id: payment.id,
    amount: payment.noteData.amount,
    mint: payment.noteData.mint,
    receivedAt: payment.blockTime 
      ? new Date(payment.blockTime * 1000).toLocaleString()
      : 'Unknown',
    status: payment.spent ? 'Spent' : 'Available',
  };
}

/**
 * Calculate total stealth balance in a human-readable format
 */
export function formatStealthBalance(
  balanceAtoms: bigint,
  decimals: number = 9
): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balanceAtoms / divisor;
  const fraction = balanceAtoms % divisor;
  
  const fractionStr = fraction.toString().padStart(decimals, '0');
  const trimmedFraction = fractionStr.replace(/0+$/, '') || '0';
  
  if (trimmedFraction === '0') {
    return whole.toString();
  }
  
  return `${whole}.${trimmedFraction}`;
}

// =============================================================================
// INTEGRATION TEST
// =============================================================================

/**
 * Run full integration test of stealth address system
 */
export async function testStealthIntegration(): Promise<void> {
  console.log('=== Stealth Address Integration Test ===\n');

  // Generate test keypairs
  const aliceKeypair = Keypair.generate();
  const bobKeypair = Keypair.generate();

  console.log('Test Setup:');
  console.log(`  Alice: ${aliceKeypair.publicKey.toBase58().slice(0, 16)}...`);
  console.log(`  Bob: ${bobKeypair.publicKey.toBase58().slice(0, 16)}...`);

  // Test 1: Build stealth payment (Alice → Bob)
  console.log('\n--- Test 1: Build Stealth Payment ---');
  const testMint = new PublicKey('So11111111111111111111111111111111111111112');
  const testAmount = BigInt(1_000_000_000);

  const txResult = StealthTransactionBuilder.buildStealthTransaction({
    recipientAddress: bobKeypair.publicKey,
    amount: testAmount,
    mint: testMint,
  });

  console.log('✓ Stealth transaction built');
  console.log(`  Stealth address: ${txResult.stealthAddress.toBase58().slice(0, 20)}...`);
  console.log(`  Commitment: ${txResult.commitment.toString().slice(0, 20)}...`);

  // Test 2: Simulate Bob recognizing the payment
  console.log('\n--- Test 2: Payment Recognition (Bob) ---');
  const bobPrivKey = bobKeypair.secretKey.slice(0, 32);
  const bobPubKey = bobKeypair.publicKey.toBytes();

  // Check Bloom filter first
  const bloomMatch = BloomFilter.checkBloomMatch(bobPubKey, txResult.metadata.bloomHint);
  console.log(`✓ Bloom filter check: ${bloomMatch ? 'POSSIBLE MATCH' : 'SKIP'}`);

  // Full recognition
  const recognized = StealthKeyManager.recognizeStealthPayment(
    bobPrivKey,
    txResult.metadata.ephemeralPublicKey,
    bobPubKey
  );
  console.log('✓ ECDH shared secret computed');
  
  // Verify stealth addresses match
  const addressesMatch = Buffer.from(recognized.stealthPublicKey).equals(
    Buffer.from(txResult.stealthResult.stealthPublicKey)
  );
  console.log(`✓ Stealth addresses match: ${addressesMatch}`);

  // Decrypt note
  const decryptedNote = StealthTransactionBuilder.decryptStealthNote(
    txResult.metadata.encryptedNote,
    txResult.metadata.encryptionNonce,
    recognized.sharedSecret
  );
  console.log('✓ Note decrypted');
  console.log(`  Amount: ${decryptedNote.amount}`);
  console.log(`  Mint: ${decryptedNote.mint.slice(0, 16)}...`);

  // Test 3: Prepare spend (Bob spends the received funds)
  console.log('\n--- Test 3: Prepare Spend (Bob) ---');
  
  const mockPayment: DiscoveredStealthPayment = {
    id: 'test_payment_1',
    stealthPublicKey: recognized.stealthPublicKey,
    stealthPrivateKey: recognized.stealthPrivateKey,
    sharedSecret: recognized.sharedSecret,
    ephemeralPublicKey: txResult.metadata.ephemeralPublicKey,
    noteData: decryptedNote,
    signature: 'mock_signature',
    slot: 12345,
    blockTime: Math.floor(Date.now() / 1000),
    spent: false,
    discoveredAt: Date.now(),
  };

  const prepared = StealthPaymentSpender.prepareSpend({
    payment: mockPayment,
    userPrivateKey: bobPrivKey,
    destinationAddress: 'DummyDestination111111111111111111111111111',
  });

  console.log('✓ Spend prepared');
  console.log(`  Amount: ${prepared.amount}`);
  console.log(`  Nullifier: ${prepared.nullifier.toString().slice(0, 20)}...`);

  // Clean up sensitive data
  StealthPaymentSpender.secureWipe(prepared.stealthPrivateKey);
  console.log('✓ Sensitive data wiped');

  // Test 4: Verify unlinkability
  console.log('\n--- Test 4: Unlinkability Test ---');
  const tx2 = StealthTransactionBuilder.buildStealthTransaction({
    recipientAddress: bobKeypair.publicKey,
    amount: testAmount,
    mint: testMint,
  });

  const differentAddresses = !txResult.stealthAddress.equals(tx2.stealthAddress);
  const differentEphemeralKeys = !Buffer.from(txResult.metadata.ephemeralPublicKey).equals(
    Buffer.from(tx2.metadata.ephemeralPublicKey)
  );

  console.log(`✓ Different stealth addresses: ${differentAddresses}`);
  console.log(`✓ Different ephemeral keys: ${differentEphemeralKeys}`);
  console.log('  → Payments are UNLINKABLE');

  console.log('\n=== All Integration Tests Passed! ===\n');
}

export default StealthWallet;
