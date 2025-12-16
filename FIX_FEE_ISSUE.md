# Fix for WSOL Fee Issue (0.00025 WSOL Instead of 0.25 NOC)

## Problem Analysis

Your transaction shows:
```
Transfer 1: 0.1 WSOL → Vault (correct)
Transfer 2: 0.00025 WSOL → Fee Collector (WRONG - should be 0.25 NOC)
```

The issue is that **the on-chain program still has percentage-based fees enabled**. Even though we set the fee initialization parameters to 0, the program was previously deployed with non-zero fees (25 bps = 0.25%).

The 0.00025 WSOL fee represents:
- 0.1 WSOL × 0.25% = 0.00025 WSOL

## What's Happening

The app is actually collecting **TWO fees**:
1. ✅ **Client-side NOC fee**: 0.25 NOC (correct) - collected before the deposit
2. ❌ **On-chain WSOL fee**: 0.00025 WSOL (wrong) - collected by the on-chain program

This is because:
- The on-chain program was previously initialized with `shield_fee_bps = 25` (0.25%)
- The current code tries to initialize with `shield_fee_bps = 0`, but this only applies to NEW program instances
- Our deployed program still has the old fees from initial deployment

## Solution: Reset On-Chain Fees to 0

You need to call the admin function `setShieldFees()` to update the fees to 0:

### Step 1: Open Browser Console
1. Open the app at http://localhost:5173/
2. Press `F12` or right-click → "Inspect" to open Developer Tools
3. Go to the "Console" tab

### Step 2: Call setShieldFees()
Paste this command in the console:

```javascript
await window.debugApi.setShieldFees()
```

You should see output like:
```
[SetShieldFees] === SETTING SHIELD FEES TO 0 ===
[SetShieldFees] Calling setShieldFees with admin keypair...
[SetShieldFees] ✅ Shield fees updated successfully!
[SetShieldFees] Signature: <transaction_signature>
```

### Step 3: Verify the Fees Were Set
After the transaction confirms, check that fees are now 0:

```javascript
await window.debugApi.checkFeeCollector()
```

You should see something like:
```
[CheckFeeCollector] Shield Fee (bps): 0
[CheckFeeCollector] Priority Fee (bps): 0
```

## Expected Behavior After Fix

Once fees are set to 0, future deposits will show:

### Correct Transaction (After Fix)
```
Transfer 1: 0.1 WSOL → Vault (amount being shielded)
Transfer 2: 0.25 NOC → Fee Collector (privacy fee)
```

There will be **NO third transfer** for on-chain percentage fees.

## Why This Happened

1. The program was initially deployed with percentage-based fees (0.25%)
2. We implemented code to initialize with 0 bps, but the program was already deployed
3. The existing deployed program still has the old fee values
4. We need to update those values via the `set_fee()` instruction

## Technical Details

The Rust program on-chain (line 110-113 in lib.rs) calculates:
```rust
let fee_bps = ctx.accounts.global_state.shield_fee_bps;
let fee_amount = amount.saturating_mul(fee_bps as u64) / 10_000;

// If fee_amount > 0, transfer to fee collector
```

By calling `setShieldFees(0, 0)`, we set both `shield_fee_bps` and `priority_fee_bps` to 0, which makes `fee_amount = 0`, and the on-chain fee transfer is skipped.

## Summary

✅ **Action Required**: Run `await window.debugApi.setShieldFees()` in browser console
✅ **Verify**: Run `await window.debugApi.checkFeeCollector()` to confirm
✅ **Result**: Future deposits will only show client-side 0.25 NOC fee, no on-chain WSOL fee
