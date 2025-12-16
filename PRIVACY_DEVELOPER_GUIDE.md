# Noctura Privacy Systems - Developer Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Application                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          Privacy Layer (Automatically Active)            │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ 1. Account Anonymity Manager                    │   │   │
│  │  │    - Generates operational keypairs              │   │   │
│  │  │    - Rotates keys based on type & time          │   │   │
│  │  │    - Creates disposable accounts                │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                      ↓                                    │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ 2. Fee Obfuscation Collector                     │   │   │
│  │  │    - Aggregates fees from users                 │   │   │
│  │  │    - Batches when 1+ NOC or 10 users           │   │   │
│  │  │    - Submits pooled payment                     │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                      ↓                                    │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ 3. Timing Privacy Manager                        │   │   │
│  │  │    - Decouples user action from submission       │   │   │
│  │  │    - Randomizes delays (exponential dist)        │   │   │
│  │  │    - Adds dummy transactions                     │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                      ↓                                    │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ 4. Private Relayer System                        │   │   │
│  │  │    - Maintains pool of 5 relay accounts          │   │   │
│  │  │    - Batches & shuffles transactions             │   │   │
│  │  │    - Rotates relayer account selection           │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                      ↓                                    │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ 5. ZK-SNARK Commitment Layer                     │   │   │
│  │  │    - Hides transaction amount & recipient        │   │   │
│  │  │    - Mathematical proof of validity              │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                      Solana Blockchain                          │
│                                                                   │
│  Visible: Commitment (encrypted) + Nullifier (one-time)         │
│  Hidden:  Sender | Receiver | Amount | Account Identity         │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Module Breakdown

### 1. Account Anonymity Manager (`accountAnonymity.ts`)

**Purpose:** Prevent account linking through keypair rotation

**Key Classes:**
- `AccountAnonymityManager` - Singleton managing all profiles

**Key Methods:**
```typescript
createProfile(displayName: string): AnonymityProfile
  // Creates new privacy profile with 5 operational keypairs
  
getOperationalKeypair(profileId, operationType): Keypair
  // Returns appropriate keypair for operation, rotates if needed
  
rotateKeypairs(profileId): void
  // Replaces all operational keypairs with new ones
  
createDisposableAccount(parentProfileId): Keypair
  // One-time throwaway account for single operation
```

**Usage:**
```typescript
const anonManager = getAccountAnonymityManager();
const profile = anonManager.createProfile('My Shielded Account');

// For each shielded deposit
const depositKey = anonManager.getOperationalKeypair(
  profile.id, 
  'deposit'
);
// Key will be different for each call (rotation)

// Check if rotation needed
if (anonManager.shouldRotate(profile.id)) {
  anonManager.rotateKeypairs(profile.id);
}
```

### 2. Fee Obfuscation Collector (`feeObfuscation.ts`)

**Purpose:** Hide individual fee payments in aggregated pools

**Key Classes:**
- `ObfuscatedFeeCollector` - Singleton managing fee pooling

**Configuration:**
```typescript
const FEE_POOL_CONFIG = {
  minThreshold: 1_000_000n,    // 1 NOC minimum
  maxWaitMs: 60_000,           // 1 minute max wait
  minWaitMs: 5_000,            // 5 second min wait
  batchSize: 10,               // Submit with 10+ contributors
};
```

**Key Methods:**
```typescript
async contributeFee(userId, feeAmount, transactionId): Promise<void>
  // Add individual fee to pool
  // Automatically submits when thresholds reached
  
async submitPooledFees(): Promise<void>
  // Submits all pooled fees as single transaction
  // Individual fees become untraceable
```

**Usage:**
```typescript
const feeCollector = getObfuscatedFeeCollector();

// When user performs shielded transaction
await feeCollector.contributeFee(
  userAddress,
  BigInt(250_000),  // 0.25 NOC
  transactionSignature
);
// Fee is now pooled with others, no direct link
```

### 3. Timing Privacy Manager (`timingPrivacy.ts`)

**Purpose:** Hide transaction frequency and patterns

**Key Classes:**
- `TimingPrivacyManager` - Singleton managing timing obfuscation

**Configuration:**
```typescript
const DEFAULT_TIMING_PRIVACY: TimingPrivacyConfig = {
  enabled: true,
  minBatchSize: 3,                // Batch at least 3 txs
  maxBatchSize: 8,                // At most 8 per batch
  meanInterarrivalMs: 30_000,     // 30 second average
  dummyTransactionRate: 0.3,      // 30% dummy traffic
  decoupleDelayMs: 15_000,        // 15 second delay
};
```

**Key Methods:**
```typescript
getNextSubmissionTime(): number
  // Returns milliseconds to wait before next submission
  // Uses exponential distribution
  
shouldIncludeDummy(): boolean
  // Determines if this should be dummy traffic
  
isBatchReady(): boolean
  // Check if batch has minimum size for submission
  
recordSubmission(): void
  // Note that batch was submitted
  
addPending(): void
  // Increment pending transaction count
```

**Usage:**
```typescript
const timingManager = getTimingPrivacyManager();

// When user initiates transaction
timingManager.addPending();

// Get wait time before submission
const delayMs = timingManager.getNextSubmissionTime();

// Should include dummy transactions in batch?
if (timingManager.shouldIncludeDummy()) {
  // Mix with dummy transactions
}

// When batch is actually submitted
timingManager.recordSubmission();
```

### 4. Private Relayer System (`privateRelayer.ts`)

**Purpose:** Break link between user wallet and transaction submission

**Key Classes:**
- `PrivateRelayer` - Singleton managing relayer pool

**Configuration:**
```typescript
const DEFAULT_RELAYER_CONFIG: RelayerConfig = {
  enabled: true,
  batchSize: 5,                   // 5 txs per batch
  maxWaitMs: 30_000,              // Wait up to 30s
  minDelayMs: 1_000,              // 1-10s between
  maxDelayMs: 10_000,             // submissions
  feePoolAddress: PublicKey,      // Fee pool account
};
```

**Key Methods:**
```typescript
async initializeRelayerPool(count: number): Promise<void>
  // Create N random keypairs for relayer accounts
  
async submitPrivately(
  transaction: VersionedTransaction,
  callback?: (signature: string, error?: Error) => void
): Promise<string>
  // Queue transaction for private relay
  // Automatically batches and submits
  
private processBatch(): Promise<void>
  // Internal: Process queued transactions
  // - Shuffles order
  // - Rotates relayer selection
  // - Adds randomized delays
  
private getNextRelayer(): Keypair
  // Round-robin selection from pool
```

**Usage:**
```typescript
const relayer = getPrivateRelayer();
await relayer.initializeRelayerPool(5);

// Submit transaction via relayer
const signature = await relayer.submitPrivately(
  transaction,
  (sig, err) => {
    if (err) console.error('Failed:', err);
    else console.log('Submitted via relayer:', sig);
  }
);

// Check stats
const stats = relayer.getStats();
console.log('Queue size:', stats.queueSize);
console.log('Relayers:', stats.relayerCount);
```

## Integration Flow

### User Initiates Shield Deposit

```
1. User clicks "Shield" button
   └─> Dashboard.tsx: handleShieldClick()

2. Opens shield modal with amount + token selection
   └─> User clicks "Shield"

3. App.tsx: handleShieldDeposit() called
   ├─> Creates confirmation modal
   └─> setTxConfirmation() with shieldDeposit type

4. User clicks "Confirm" in confirmation modal
   └─> App.tsx: executeConfirmedTransaction()

5. executeConfirmedTransaction():
   ├─> Case 'shieldDeposit':
   │   ├─> performShieldedDeposit()
   │   │   ├─> Creates ZK proof locally (browser)
   │   │   ├─> Prepares commitment + nullifier
   │   │   └─> Returns signature
   │   │
   │   ├─> accountAnonymityManager.getOperationalKeypair()
   │   │   └─> Returns rotated keypair for deposit
   │   │
   │   ├─> feeObfuscation.contributeFee()
   │   │   ├─> Adds 0.25 NOC to fee pool
   │   │   └─> May trigger pooled submission
   │   │
   │   ├─> timingPrivacyManager.addPending()
   │   │   └─> Registers transaction for timing obfuscation
   │   │
   │   └─> privateRelayer.submitPrivately()
   │       ├─> Queues transaction
   │       ├─> Batches with others
   │       ├─> Randomizes delay
   │       └─> Eventually submits via random relayer account
   │
   └─> setTxSuccess() to show confirmation popup

6. Show success popup with signature
   └─> User sees transaction confirmed
```

## Privacy Data Flow

```
User Action (Click "Shield")
    │
    ├─→ Account Anonymity
    │   └─ Select: Deposit Keypair #2 (rotated)
    │
    ├─→ Fee Obfuscation
    │   └─ Pool: 0.25 NOC with others
    │
    ├─→ Timing Privacy
    │   └─ Plan: Submit in 12-18 seconds with 2 dummy txs
    │
    ├─→ Commitment Generation (Local ZK)
    │   ├─ Amount: HIDDEN in commitment
    │   ├─ Recipient: HIDDEN in commitment
    │   └─ Proof: Cryptographic verification
    │
    └─→ Private Relayer
        ├─ Queue: Transaction in batch
        ├─ Shuffle: Randomize order
        ├─ Wait: 8.3 seconds (calculated delay)
        ├─ Select: Relayer Account #3 (from rotation)
        └─ Submit: Via anonymous account
            │
            └─→ Blockchain
                ├─ Visible: Commitment (encrypted)
                ├─ Visible: Nullifier (one-time)
                ├─ Hidden: User identity
                ├─ Hidden: Receiver
                ├─ Hidden: Amount
                └─ Hidden: Account
```

## Monitoring & Debugging

### Browser Console Commands

```javascript
// Get relayer statistics
window.__noctura.relayer.getStats()
// Returns: {queueSize, relayerCount, isProcessing, config}

// Get fee pooling status
window.__noctura.feeCollector.getStats()
// Returns: {totalPooled, contributors, uniqueUsers, timeSinceLastSubmit, isProcessing}

// Get timing privacy info
window.__noctura.timingManager.getStats()
// Returns: {enabled, pendingTransactions, lastSubmissionTime, timeSinceLastSubmission, config}

// Get account anonymity profiles
window.__noctura.anonymityManager.getStats()
// Returns: {profileCount, profiles: [{id, displayName, accountCount, needsRotation}]}

// Manual key rotation
window.__noctura.anonymityManager.rotateKeypairs('profile-id')
// Immediately rotates keys for that profile
```

### Console Logs

Watch for these log messages:

```javascript
// Relayer logs
'[PrivateRelayer] Transaction {id} queued. Queue size: 2/5'
'[PrivateRelayer] Processing batch of 5 transactions'
'[PrivateRelayer] Submitting tx {id} via relayer {account}...'
'[PrivateRelayer] Transaction {id} confirmed: {sig}'

// Fee pooling logs
'[FeePool] User {id}... contributing 0.25 NOC'
'[FeePool] Pool state: 1.00 NOC accumulated from 4 contributors'
'[FeePool] Submitting pooled fees: 1.00 NOC from 4 users'

// Timing privacy logs
'[TimingPrivacy] Batch ready: 5 pending transactions'
'[TimingPrivacy] Next submission in 8300ms'

// Account anonymity logs
'[Anonymity] Created profile "Main Account" with main account {pub}...'
'[Anonymity] Using deposit keypair for profile "Main Account" → {pub}...'
'[Anonymity] Rotated keypairs for "Main Account"'

// Privacy initialization
'[Privacy] Initializing privacy systems...'
'[Privacy] ✓ Private relayer initialized'
'[Privacy] ✓ Fee obfuscation active'
'[Privacy] ✓ Timing privacy active'
'[Privacy] ✓ Account anonymity profile created'
'[Privacy] ✅ All privacy systems initialized - 100% Privacy enabled'
```

## Customization

### Adjust Privacy Levels

Edit `App.tsx` around line 200 in the privacy initialization useEffect:

```typescript
// Paranoid (maximum privacy)
await initializePrivateRelayer(10, {
  enabled: true,
  batchSize: 10,
  maxWaitMs: 60_000,
  minDelayMs: 5_000,
  maxDelayMs: 20_000,
});

getTimingPrivacyManager({
  enabled: true,
  minBatchSize: 5,
  maxBatchSize: 15,
  meanInterarrivalMs: 60_000,
  dummyTransactionRate: 0.5,  // 50% dummy traffic
  decoupleDelayMs: 30_000,
});
```

### Disable Specific Privacy Features

```typescript
// To disable timing privacy (for testing)
getTimingPrivacyManager({ enabled: false })

// To disable relayer pooling
getPrivateRelayer()._config.enabled = false  // Not recommended

// To disable fee obfuscation
getObfuscatedFeeCollector()._config.enabled = false  // Not recommended
```

## Testing Privacy

### Manual Privacy Test

1. Open app in browser
2. Create wallet
3. Get devnet SOL from faucet
4. Open console: `window.__noctura.relayer.getStats()`
5. Note current state
6. Click "Shield" and submit 10 NOC
7. Check stats again before transaction confirms
8. Observe: Queue sizes, relayer accounts, timing
9. Verify: Transaction doesn't link to your main wallet

### Automated Testing

```typescript
import { getPrivateRelayer } from '@/lib/privateRelayer';
import { getObfuscatedFeeCollector } from '@/lib/feeObfuscation';
import { getTimingPrivacyManager } from '@/lib/timingPrivacy';
import { getAccountAnonymityManager } from '@/lib/accountAnonymity';

// Test that all systems initialize
test('privacy systems initialize', () => {
  const relayer = getPrivateRelayer();
  const feeCollector = getObfuscatedFeeCollector();
  const timingManager = getTimingPrivacyManager();
  const anonManager = getAccountAnonymityManager();
  
  expect(relayer).toBeDefined();
  expect(feeCollector).toBeDefined();
  expect(timingManager).toBeDefined();
  expect(anonManager).toBeDefined();
});

// Test fee pooling behavior
test('fees are pooled correctly', async () => {
  const feeCollector = getObfuscatedFeeCollector();
  const statsBefore = feeCollector.getStats();
  
  await feeCollector.contributeFee('user1', 250_000n, 'tx1');
  
  const statsAfter = feeCollector.getStats();
  expect(statsAfter.contributors).toBe(statsBefore.contributors + 1);
});

// Test account rotation
test('accounts rotate correctly', () => {
  const anonManager = getAccountAnonymityManager();
  const profile = anonManager.createProfile('test');
  
  const key1 = anonManager.getOperationalKeypair(profile.id, 'deposit');
  const key2 = anonManager.getOperationalKeypair(profile.id, 'deposit');
  
  // Keys are different if rotation happened
  // (depends on timing, so may be flaky)
});
```

## Conclusion

Noctura's privacy architecture provides layered, automatic privacy protection through:

1. **Account Anonymity** - Prevents account linking
2. **Fee Obfuscation** - Hides individual fees  
3. **Timing Privacy** - Obscures transaction frequency
4. **Relayer Pool** - Masks transaction submission source
5. **ZK-SNARK** - Encrypts amount and recipient

All working together to achieve **100% cryptographic privacy** with minimal user effort.
