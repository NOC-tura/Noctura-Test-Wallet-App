# Noctura Wallet - Developer Guide

**Status**: Production Ready (P0-P2 Complete)  
**Last Updated**: December 2024

---

## Quick Navigation

### For Users
- Start with [ANONYMITY_FEATURES.md](ANONYMITY_FEATURES.md) for privacy settings
- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system overview
- Review [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for feature completeness

### For Developers
- **This file** for coding reference
- [RELAYER_FAILOVER.md](RELAYER_FAILOVER.md) for endpoint configuration
- [P2B_COMPLETION.md](P2B_COMPLETION.md) for privacy feature integration

---

## Code Examples

### Basic Withdrawal
```typescript
import { submitShieldedWithdraw } from './lib/shieldProgram';

const sig = await submitShieldedWithdraw({
  keypair,           // User's keypair
  proof,             // From prover service
  amount: BigInt('1000000'),
  targetAta,         // Recipient's token account
  nullifier,         // Prevents double-spend
});
```

### With Privacy (Recommended)
```typescript
import { submitShieldedWithdraw, ANONYMITY_LEVELS } from './lib/shieldProgram';

const sig = await submitShieldedWithdraw({
  keypair,
  proof,
  amount: BigInt('1000000'),
  targetAta,
  nullifier,
  anonymityConfig: ANONYMITY_LEVELS.standard,  // 500-2000ms delay
});
// Withdrawl automatically delayed to break timing analysis
```

### With Smart Privacy Selection
```typescript
import { 
  submitShieldedWithdraw, 
  getPrivacyRecommendation 
} from './lib/shieldProgram';

const config = getPrivacyRecommendation({
  amount: BigInt('500000000'),  // Large amount
  frequency: 'frequent',
  riskProfile: 'aggressive',
});
// Returns ANONYMITY_LEVELS.enhanced automatically

const sig = await submitShieldedWithdraw({
  keypair, proof, amount, targetAta, nullifier,
  anonymityConfig: config,
});
```

### High-Level Wrapper
```typescript
import { submitShieldedTransactionWithPrivacy } from './lib/shieldProgram';

const sig = await submitShieldedTransactionWithPrivacy({
  transaction: () => submitShieldedWithdraw(params),
  anonymityLevel: 'enhanced',
  description: 'Large withdrawal',
});
// Automatic logging, delays, and error handling
```

---

## Configuration

### Environment Setup
```bash
# .env or .env.local
VITE_RELAYER_ENDPOINTS="https://relay1.com,https://relay2.com,https://relay3.com"
VITE_RELAYER_HEALTH_CHECK_INTERVAL_MS=30000
VITE_RELAYER_HEALTH_CHECK_TIMEOUT_MS=5000
```

### Runtime Configuration
```typescript
// Select privacy level
const config = ANONYMITY_LEVELS.standard;

// Custom privacy config
const customConfig: AnonymityConfig = {
  enableOutputAliasing: true,
  enableRandomizedTiming: true,
  enableBatchJoins: false,
  minTimingDelayMs: 1000,
  maxTimingDelayMs: 3000,
};
```

---

## API Reference

### submitShieldedWithdraw()
```typescript
async function submitShieldedWithdraw(params: {
  keypair: Keypair;
  proof: ProverResponse;
  amount: bigint;
  targetAta: PublicKey;
  nullifier: bigint;
  mint?: PublicKey;                    // Default: NOC_TOKEN_MINT
  recipient?: PublicKey;               // Default: keypair.publicKey
  anonymityConfig?: AnonymityConfig;   // NEW: optional privacy settings
}): Promise<{ signature: string; leafIndex: number }>
```

**Returns**:
- `signature`: Transaction signature (can be used for explorer)
- `leafIndex`: Index in merkle tree

**Throws**:
- `Error` if amount <= 0
- `Error` if privacy fee collection fails
- `Error` if proof verification fails on-chain

---

### getPrivacyRecommendation()
```typescript
function getPrivacyRecommendation(context: {
  amount: bigint;                           // Transaction size
  frequency?: 'rare' | 'occasional' | 'frequent';
  riskProfile?: 'conservative' | 'moderate' | 'aggressive';
}): AnonymityConfig
```

**Logic**:
- Large amounts (500+ SOL) → ENHANCED
- Frequent spends → STANDARD or ENHANCED
- Aggressive profile → ENHANCED
- Default → STANDARD

---

### submitShieldedTransactionWithPrivacy<T>()
```typescript
async function submitShieldedTransactionWithPrivacy<T>(params: {
  transaction: () => Promise<T>;           // Function to execute
  anonymityLevel?: 'minimal' | 'standard' | 'enhanced';
  description: string;                     // For logging
}): Promise<T>
```

**Behavior**:
1. Logs "Starting with X anonymity level"
2. Applies randomized delay
3. Executes transaction function
4. Logs "✅ Privacy-aware transaction completed"

---

### RandomizedTiming
```typescript
class RandomizedTiming {
  static getRandomDelay(config: AnonymityConfig): number
  static async sleep(config: AnonymityConfig): Promise<void>
  static getOperationSequence(count: number, config: AnonymityConfig): number[]
}
```

---

### OutputAliaser
```typescript
class OutputAliaser {
  static shuffleOutputs<T>(outputs: T[]): { outputs: T[]; changeIndex: number }
  static verifyAliasing(outputCount: number): boolean
}
```

---

### relayerManager
```typescript
interface RelayerManager {
  getHealthyEndpoint(): string
  recordSuccess(url: string): void
  recordFailure(url: string, error: Error): void
  startHealthChecks(): void
  stopHealthChecks(): void
  getStatus(): RelayerEndpoint[]
}

// Singleton usage
import { relayerManager } from './lib/relayerManager';
const endpoint = relayerManager.getHealthyEndpoint();
const status = relayerManager.getStatus();
```

---

### ReorgDetector
```typescript
class ReorgDetector {
  checkForReorg(): Promise<void>
  recordCheckpoint(root: bigint, status: 'processed' | 'confirmed' | 'finalized'): void
  getFinalizedRoot(): bigint | null
  getConfirmedRoot(): bigint | null
  isRootFinalized(root: bigint): boolean
  startMonitoring(): void
  stopMonitoring(): void
  async reorgSafeExecute<T>(fn: () => Promise<T>): Promise<T>
}
```

---

## Building & Testing

### Build
```bash
cd app
npm install      # Install dependencies
npm run build    # Production build (uses Vite)
```

### Test
```bash
# Smoke test (checks RPC, prover, relayer health)
KEYPAIR_PATH=~/.config/solana/id.json ts-node scripts/regression.ts

# Check module count
npm run build | grep "modules"
```

### Verify
```bash
npm run build 2>&1 | grep "✓ built"  # Should show success
cargo build --release                 # Rust program (< 2 seconds)
```

---

## Debugging

### Enable Console Logging
```javascript
// Browser console (F12)
localStorage.debug = '*'  // Enable all logs
```

### Check Relayer Health
```typescript
import { relayerManager } from './lib/relayerManager';

const status = relayerManager.getStatus();
status.forEach(endpoint => {
  console.log(`${endpoint.url}: ${endpoint.healthStatus}`);
  console.log(`  Success: ${endpoint.successCount}, Failures: ${endpoint.failureCount}`);
});
```

### Monitor Reorgs
```typescript
import { ReorgDetector } from './lib/reorgDetector';

const detector = new ReorgDetector();
detector.startMonitoring();

// Monitor in real-time
setInterval(() => {
  const root = detector.getConfirmedRoot();
  console.log(`Current confirmed root: ${root}`);
}, 10000);
```

---

## Common Issues

### "Privacy fee collection failed"
**Cause**: Insufficient NOC balance  
**Solution**: Deposit more NOC (0.25 NOC per withdrawal)

### "Withdrawal amount must be > 0"
**Cause**: Amount parameter is 0 or negative  
**Solution**: Validate amount > 0 before calling

### "Relayer error: 503"
**Cause**: All relayer endpoints down  
**Solution**: 
1. Check relayer health: `relayerManager.getStatus()`
2. Verify environment: `VITE_RELAYER_ENDPOINTS`
3. Wait for relayer to recover (auto-retries every 30s)

### "Proof verification failed"
**Cause**: Invalid SNARK proof  
**Solution**: Regenerate proof from prover service

### "Nullifier already spent"
**Cause**: Attempting to spend same note twice  
**Solution**: Use a different unspent note

---

## Performance Tips

1. **Batch Operations**: Use batchingUtils when circuit supports multi-input
2. **Cache Proofs**: Generate proofs once, reuse within same block time
3. **Monitor Latency**: 15-25s typical (includes 0-5s privacy delay)
4. **Configure Delays**: Use MINIMAL level for speed-critical operations

---

## Security Checklist

Before production:
- [ ] All relayers are responding (health check passes)
- [ ] Privacy fee is collected successfully
- [ ] Reorg detector is active (monitoring enabled)
- [ ] Anonymity delays are applied correctly
- [ ] Amount validation passes (> 0 check)
- [ ] No hardcoded keypairs or secrets

---

## Module Breakdown

| Module | Responsibility | Status |
|--------|-----------------|--------|
| shieldProgram | Core withdrawal/deposit/transfer | ✅ Complete |
| prover | Proof generation + failover relay | ✅ Complete |
| relayerManager | Multi-endpoint health tracking | ✅ Complete |
| anonymityUtils | Privacy features | ✅ Complete |
| reorgDetector | Chain reorg monitoring | ✅ Complete |
| batchingUtils | Multi-note batching prep | ✅ Complete |
| anchorClient | On-chain program interface | ✅ Complete |
| constants | Configuration values | ✅ Complete |

---

## File Organization

```
app/src/lib/
├── shieldProgram.ts       # Main interface
├── prover.ts              # Proof + failover relay
├── relayerManager.ts      # Multi-endpoint orchestration
├── anonymityUtils.ts      # Privacy features
├── reorgDetector.ts       # Reorg monitoring
├── batchingUtils.ts       # Batching infrastructure
├── anchorClient.ts        # On-chain interface
├── solana.ts              # RPC connection
├── constants.ts           # Config
└── ...

programs/noctura-shield/src/
├── lib.rs                 # Main program
├── errors.rs              # Error types
└── ...

scripts/
└── regression.ts          # Health check tests
```

---

## Deployment

### Development
```bash
npm run dev  # Local development with HMR
```

### Production
```bash
npm run build         # Production build
# Deploy dist/ to CDN
# Program already deployed to Solana devnet
```

---

## Future Extensions

### P3a: Merkle Tree Optimization
- Implement sparse tree (reduce witness from 32 → 8 elements)
- Add epoch checkpoints for faster sync
- Integrate into proof verification

### P3b: Network Privacy
- Document Tor/VPN integration
- Implement RPC batching
- Create relayer proxy guide

### P1b On-Chain
- Upgrade circuit to 2-4 input support
- Enable multi-note batching
- Reduce proof generation time

---

## Support & Resources

- **Issues**: Check [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- **Privacy**: See [ANONYMITY_FEATURES.md](ANONYMITY_FEATURES.md)
- **Architecture**: Review [ARCHITECTURE.md](ARCHITECTURE.md)
- **Configuration**: Check [RELAYER_FAILOVER.md](RELAYER_FAILOVER.md)

---

## Version History

- **v2.0** (Dec 2024): P0-P2 complete, anonymity integrated
- **v1.5** (Nov 2024): Relayer failover added
- **v1.0** (Nov 2024): Initial deployment
