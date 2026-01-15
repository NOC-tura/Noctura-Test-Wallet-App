# Stealth Address Implementation - Complete

## Overview

The Noctura wallet now includes a comprehensive stealth address system that enables **true private payments** on Solana. Users can send private transactions using only the recipient's regular Solana address - no pre-shared shielded addresses needed.

## New Files Created

### Core Cryptographic Modules

| File | Purpose | Lines |
|------|---------|-------|
| [stealthKeyManager.ts](app/src/lib/stealthKeyManager.ts) | ECDH on Ed25519, stealth address derivation | 681 |
| [bloomFilter.ts](app/src/lib/bloomFilter.ts) | Efficient probabilistic filtering for scanning | 290 |
| [stealthTransactionBuilder.ts](app/src/lib/stealthTransactionBuilder.ts) | Build stealth payment transactions | 445 |
| [stealthPaymentScanner.ts](app/src/lib/stealthPaymentScanner.ts) | Background blockchain scanning | 520 |
| [stealthPaymentSpender.ts](app/src/lib/stealthPaymentSpender.ts) | Spend received stealth payments | 340 |

### Integration Modules

| File | Purpose |
|------|---------|
| [stealthAddressSystem.ts](app/src/lib/stealthAddressSystem.ts) | Unified API and StealthWallet class |
| [useStealthWallet.ts](app/src/lib/useStealthWallet.ts) | React hook for easy integration |

## How It Works

### Cryptographic Protocol

```
SENDER (Alice) → RECIPIENT (Bob)

1. Alice enters Bob's regular Solana address
2. System generates ephemeral keypair: (r, R = r*G)
3. Computes shared secret via ECDH: S = r * Bob_pubkey  
4. Derives stealth address: P' = Bob_pubkey + H(S)*G
5. Encrypts note details with H(S)
6. Sends funds to P' with R attached as memo

RECIPIENT SCANNING:
1. For each transaction, extract R (ephemeral pubkey)
2. Bloom filter quick check (skips ~95% of transactions)
3. Compute: S' = bob_privkey * R
4. Check if P' = Bob_pubkey + H(S')*G matches commitment
5. If match: decrypt note, record payment

SPENDING:
1. Derive: stealth_privkey = bob_privkey + H(S')
2. Create nullifier from stealth_privkey
3. Submit withdrawal via relayer
```

### Privacy Guarantees

- **Sender Identity**: Hidden (transaction from shielded pool)
- **Recipient Identity**: Hidden (one-time stealth address)
- **Amount**: Encrypted (only recipient can decrypt)
- **Payment Linkability**: None (each payment uses different address)

## Integration Guide

### Basic Usage

```typescript
import { useStealthWallet } from './lib/useStealthWallet';

function WalletComponent() {
  const { keypair } = useWallet();
  const stealth = useStealthWallet(keypair, {
    debug: true,
    autoStart: true,
    onPaymentDiscovered: (payment) => {
      toast.success(`Received ${payment.noteData.amount} privately!`);
    },
  });

  // Check if recipient can receive stealth payments
  const handleSend = async (recipientAddress: string, amount: bigint) => {
    if (stealth.shouldUseStealthAddress(recipientAddress)) {
      // Use stealth address for regular Solana addresses
      const result = await stealth.buildStealthPayment({
        recipientAddress,
        amount,
        mint: NOC_TOKEN_MINT,
      });
      // Submit via relayer with stealth metadata
    } else {
      // Use direct shielded transfer for noctura1... addresses
    }
  };

  return (
    <div>
      <h3>Stealth Balance: {stealth.getStealthBalance(NOC_TOKEN_MINT)}</h3>
      <p>Scanning: {stealth.isScanning ? 'Active' : 'Stopped'}</p>
      <p>Discovered: {stealth.stealthPayments.length} payments</p>
    </div>
  );
}
```

### Manual Scanning

```typescript
// Trigger manual scan (e.g., from refresh button)
const newPayments = await stealth.scanNow();
console.log(`Found ${newPayments.length} new payments`);
```

### Spending Stealth Payments

```typescript
// Get unspent stealth payments
const unspent = stealth.getUnspentPayments();

// Prepare to spend
const prepared = stealth.prepareSpend(paymentId, destinationAddress);

// Convert to shielded note format for existing withdrawal flow
const note = stealth.toShieldedNote(paymentId);

// Mark as spent after successful withdrawal
stealth.markSpent(paymentId);

// IMPORTANT: Wipe sensitive data
note.needsWipe.forEach(arr => StealthPaymentSpender.secureWipe(arr));
```

## Technical Details

### Bloom Filter Optimization

- **Size**: 256 bits (32 bytes) per transaction
- **Hash Functions**: 5 independent SHA-256 based
- **False Positive Rate**: ~2-3%
- **Purpose**: Skip ~95% of transactions instantly without ECDH

### Encryption

- **Algorithm**: XChaCha20-Poly1305
- **Key Derivation**: SHA-256 with domain separation
- **Nonce**: 24 bytes random per note

### Domain Separation

```typescript
NOCTURA_STEALTH_V1   // Stealth address derivation
NOCTURA_SS_V1        // Shared secret generation
NOCTURA_SCALAR_V1    // Scalar derivation for point addition
NOCTURA_BLOOM_V1     // Bloom filter hint creation
NOCTURA_COMMITMENT_V1 // Payment commitment creation
NOCTURA_NOTE_V1      // Note encryption
```

## Testing

Each module includes a test function:

```typescript
// Test key manager
await StealthKeyManager.runTests();

// Test bloom filter
BloomFilter.runTests();

// Test transaction builder
StealthTransactionBuilder.runTests();

// Test full integration
await testStealthIntegration();
```

## Next Steps for Full Integration

1. **App.tsx Integration**: Connect `useStealthWallet` hook to existing transfer flow
2. **UI Components**: Add stealth balance display, scanning indicator
3. **Relayer Update**: Extend relayer to handle stealth memo instructions
4. **Settings**: Add user preferences for scan frequency, auto-scanning toggle

## Dependencies Added

```json
{
  "@noble/ed25519": "^2.x",
  "@noble/curves": "^1.x", 
  "@noble/ciphers": "^1.x",
  "@noble/hashes": "^1.x"
}
```

## Security Considerations

1. **Private Key Handling**: Stealth private keys are derived on-demand and should be wiped immediately after use
2. **Scanning Privacy**: Background scanning should use rate limiting to avoid detection
3. **Memory Safety**: Use `StealthPaymentSpender.secureWipe()` for sensitive data
4. **Key Validation**: Always validate public keys are on curve before ECDH

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        StealthWallet                            │
│  (Main integration class - manages all stealth operations)      │
└────────────────────────────┬────────────────────────────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
     ▼                       ▼                       ▼
┌─────────────────┐  ┌───────────────────┐  ┌─────────────────┐
│StealthKeyManager│  │StealthTransaction │  │StealthPayment   │
│                 │  │    Builder        │  │   Scanner       │
│ - ECDH          │  │ - Build tx        │  │ - Scan chain    │
│ - Derive keys   │  │ - Encrypt note    │  │ - Discover      │
│ - Recognize     │  │ - Create memo     │  │ - Persist       │
└─────────────────┘  └───────────────────┘  └─────────────────┘
         │                   │                       │
         └───────────────────┴───────────────────────┘
                             │
                             ▼
                   ┌─────────────────────┐
                   │StealthPaymentSpender│
                   │ - Derive priv key   │
                   │ - Create nullifier  │
                   │ - Prepare withdraw  │
                   └─────────────────────┘
```

## Build Verification

```bash
cd /Users/banel/Noctura-Wallet/app
npm run build  # ✓ Success
```

All stealth address modules compile and build successfully with the existing wallet codebase.
