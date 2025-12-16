# Shielded Fee Fix - Summary

## Problem
The shielded transactions had **multiple conflicting fees**:
1. **0.25 NOC** privacy fee (client-side, correct)
2. **0.25% on-chain fee** in deposited token (wrong)
   - For 0.1 SOL: additional 0.00025 SOL charged
   - Should be 0.25 NOC only

This violated the design: **"Only SOL and NOC for transactions, only 0.25 NOC fixed fee for shielded ops"**

## Root Cause
The on-chain program was initialized with:
```rust
shieldFeeBps: 25    // 0.25% of deposit amount
priorityFeeBps: 100 // 1% for priority lane
```

These fees are hardcoded at program initialization and can't be changed without redeploying.

## Solution
1. **Added `setShieldFees()` function** to `shieldProgram.ts`
   - Calls on-chain program's `set_fee` instruction
   - Sets both shield_fee_bps and priority_fee_bps to 0
   - Only callable by program admin

2. **Updated initialization code**
   - Changed comments to reflect 0% on-chain fees
   - Fresh deployments will have correct fees from start

3. **Added admin UI in App.tsx**
   - `debug.setShieldFees()` function
   - Easy one-click fee update for admins

## Files Changed

### `/Users/banel/Noctura-Wallet/app/src/lib/shieldProgram.ts`
- Line 18-20: Updated privacy fee comments (0.25 NOC only)
- Line 101-103: Changed initialization from 25 bps → 0 bps
- Line 127-150: Added new `setShieldFees()` function

### `/Users/banel/Noctura-Wallet/app/src/App.tsx`
- Line 627-665: Added `debug.setShieldFees()` admin function

### New Files
- `/scripts/setShieldFees.ts`: TypeScript helper script
- `/SHIELDED_FEE_CONFIGURATION.md`: Complete guide
- `/TEST_SHIELDED_FEES.sh`: Testing guide

## How to Apply

### For Fresh Programs
When deploying new program:
```bash
npm run build
# Program initializes with 0% on-chain fees automatically
```

### For Existing Programs
If program is already deployed with old fees:

1. **Open app in browser**
2. **Open browser console (F12)**
3. **Run:**
   ```javascript
   window.debugApi.setShieldFees()
     .then(r => console.log('✅', r))
     .catch(e => console.error('❌', e))
   ```
4. **Wait for confirmation**

**Requirements:** You must be the program admin (deployer)

## Verification

After applying the fix, verify a shielded deposit shows:

❌ Old (Wrong):
```
Transfer 1: 0.1 SOL → Vault
Transfer 2: 0.25 NOC → Fee collector
Transfer 3: 0.00025 SOL → Fee collector (percentage fee - REMOVE THIS)
```

✅ New (Correct):
```
Transfer 1: 0.1 SOL → Vault
Transfer 2: 0.25 NOC → Fee collector
(No Transfer 3)
```

## Cost Reduction

Before fix:
- 0.1 SOL deposit cost user: 0.10025 SOL + 0.25 NOC

After fix:
- 0.1 SOL deposit cost user: 0.1 SOL + 0.25 NOC
- **Saves: 0.00025 SOL (25 lamports) per transaction**

Plus: No confusion about percentage fees vs fixed fees.

## Design Compliance

Now fully complies with design spec:
- ✅ Addresses hidden (stealth addresses)
- ✅ Amounts hidden (ZK proofs)
- ✅ Linking broken (nullifiers)
- ✅ Recipient discovery (view keys)
- ✅ **Only SOL and NOC tokens**
- ✅ **Fixed 0.25 NOC fee per shielded transaction**
- ✅ **No percentage-based fees**
