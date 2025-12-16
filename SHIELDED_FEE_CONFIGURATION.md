# Shielded Mode - Privacy Fee Configuration

## Overview

The Noctura wallet now supports **complete privacy control** for shielded transactions:

- **Only ONE fixed fee**: 0.25 NOC per ANY shielded transaction
- **No percentage-based fees**: No additional charges in SOL or other tokens
- **Transparent mode**: Unaffected (works as before)

## Fee Structure

### Shielded Transactions (Private)
- **Privacy Fee**: 0.25 NOC (fixed)
- **On-chain fee**: 0 (disabled)
- **Total cost**: Exactly 0.25 NOC for ANY transaction (deposit, transfer, or withdrawal)

### Transparent Transactions (Public)
- **Network fee**: Solana rent/compute fees (if applicable)
- **No privacy fee**: Not charged for transparent operations

## Implementation Details

### Changes Made

1. **Updated `shieldProgram.ts`**:
   - Initialize with 0% shield fee (`shieldFeeBps: 0`)
   - Initialize with 0% priority fee (`priorityFeeBps: 0`)
   - Added `setShieldFees()` function to update fees on running program

2. **Added to App.tsx**:
   - `debug.setShieldFees()` function in the debug/admin panel
   - Easy one-click update of fees for admins

## How to Set Fees

### For Program Admins Only

If you're the program deployer/admin, call this in the browser console:

```javascript
// Access the debug panel in the app
window.debugApi.setShieldFees()
  .then(result => console.log('✅ Fees updated:', result))
  .catch(err => console.error('❌ Failed:', err))
```

Or if the program was freshly deployed:
- The program initializes with 0% fees automatically
- No additional action needed!

### For Non-Admins

The on-chain program owner must run `setShieldFees()` once to disable percentage-based fees.

## Technical Details

### What's Happening

When you make a **shielded transaction**:

1. **Client-side**: 0.25 NOC transferred to fee collector (mandatory)
2. **On-chain**: Program checks balance proof without charging additional fees

### Verification

To verify the fees are correct, check the blockchain transaction:
- Should see ONE fee transfer of 0.25 NOC (250,000 atoms / 6 decimals)
- Should see deposit/transfer amount in SOL or NOC
- Should NOT see any percentage-based fee in the deposited token

Example transaction:
```
Transfer 1: 0.1 SOL → Vault (deposit)
Transfer 2: 0.25 NOC → Fee Collector (privacy fee)
No additional transfers!
```

## Tokens Supported

- **SOL**: Native Solana token (9 decimals)
- **NOC**: Noctura token (6 decimals)
- **Fee**: Always in NOC

No wrapped tokens (WSOL) are used for SOL transactions.

## If You See Multiple Fees

If you see unexpected transfers:

1. **Old program state**: The program was initialized with percentage fees (25 bps)
   - **Solution**: Have the admin call `window.debugApi.setShieldFees()`

2. **Before the fix**: Some transactions charged in the wrong token
   - **Solution**: Those funds may be in an unexpected token account
   - **Check**: Your NOC and SOL balances in token explorer

## Summary

✅ **Transparent Mode**: Works as-is, uses native SOL
✅ **Shielded Mode**: 0.25 NOC fixed fee only
✅ **No hidden charges**: All fees are predictable
✅ **Privacy preserved**: Only the recipient knows the amount
