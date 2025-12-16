# Fix for Fee Collector Address & Missing Deposit Transfer

## Issues Found

1. **Wrong Fee Collector Address** 
   - Current: User's wallet address (set during initialization)
   - Should be: `55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax`
   - Impact: Privacy fees going to wrong address

2. **Missing Deposit Transfer in Transaction**
   - Only showing: 0.25 NOC fee transfer
   - Should also show: 100 NOC transfer to vault
   - Root cause: Fixed with variable name correction in code

## Solutions Implemented

### 1. Added `setFeeCollector()` Function
- **File**: `app/src/lib/shieldProgram.ts`
- **New RPC**: `program.methods.setFeeCollector(newAddress)`
- **Who Can Call**: Program admin (whoever initialized it)
- **Action**: Updates the fee collector address in GlobalState

### 2. Added Debug API Function
- **File**: `app/src/App.tsx`
- **New Function**: `window.debugApi.setFeeCollector(address)`
- **Usage**: Update fee collector without code changes

### 3. Fixed Variable Reference Bug
- **File**: `app/src/lib/shieldProgram.ts`, line 430
- **Issue**: Reference to undefined `mint` variable
- **Fix**: Changed to `vaultMint` 
- **Impact**: This was preventing the deposit transaction from executing

## How to Fix the Fee Collector Address

### Step 1: Open Browser Console
- Navigate to http://localhost:5174/
- Press F12 → Console tab

### Step 2: Update Fee Collector Address
```javascript
await window.debugApi.setFeeCollector('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax')
```

Expected output:
```
[SetFeeCollector] === SETTING FEE COLLECTOR ===
[SetFeeCollector] ✅ Fee collector updated successfully!
[SetFeeCollector] Signature: <transaction_hash>
[SetFeeCollector] New fee collector: 55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax
```

### Step 3: Verify Update
```javascript
await window.debugApi.checkFeeCollector()
```

Should show:
```
[CheckFeeCollector] Fee collector: 55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax
```

## Expected Transaction After Fix

### Before Fix (Wrong)
```
Transfer 1: 0.25 NOC → User's Wallet (fee - WRONG ADDRESS)
[Missing: 100 NOC → Vault transfer]
```

### After Fix (Correct)
```
Transfer 1: 100 NOC → Vault (the deposit)
Transfer 2: 0.25 NOC → 55qTjy2A...  (fee - CORRECT ADDRESS)
```

## Build Status
✅ **SUCCESS** - 828 modules, fixed variable reference
✅ **Dev Server** - Running at http://localhost:5174/

## Next Steps

1. **Update Fee Collector** (from browser console):
   ```javascript
   await window.debugApi.setFeeCollector('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax')
   ```

2. **Verify It Updated**:
   ```javascript
   await window.debugApi.checkFeeCollector()
   ```

3. **Test Shielded NOC Deposit Again**:
   - Deposit 100 NOC
   - Verify transaction now shows TWO transfers:
     - 100 NOC → Vault
     - 0.25 NOC → `55qTjy2A...` (fee collector)

4. **Check Balance**:
   - Transparent balance should decrease by 100.25 NOC
   - Shielded balance should increase by 100 NOC

## Technical Details

### SetFeeCollector Instruction (Rust)
```rust
pub fn set_fee_collector(
    ctx: Context<SetFeeCollector>, 
    new_fee_collector: Pubkey
) -> Result<()> {
    let global = &mut ctx.accounts.global_state;
    require!(ctx.accounts.admin.key() == global.admin, ShieldError::Unauthorized);
    global.fee_collector = new_fee_collector;
    Ok(())
}
```

### SetFeeCollector Context
```rust
#[derive(Accounts)]
pub struct SetFeeCollector<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump, has_one = admin)]
    pub global_state: Account<'info, GlobalState>,
}
```

### Why Deposit Was Missing

The bug was in `submitShieldedDeposit()` function:
```typescript
// WRONG - variable 'mint' doesn't exist after our changes
console.log('[submitShieldedDeposit] Building transaction with accounts:', {
  mint: mint.toBase58(),  // ❌ undefined variable
  ...
});

// FIXED - use the correct variable name
console.log('[submitShieldedDeposit] Building transaction with accounts:', {
  mint: vaultMint.toBase58(),  // ✅ correct variable
  ...
});
```

This caused the entire transaction building to fail silently, only the fee transfer succeeded.

## Files Modified

1. **programs/noctura-shield/src/lib.rs**
   - Added `set_fee_collector()` instruction
   - Added `SetFeeCollector` context struct

2. **app/src/lib/shieldProgram.ts**
   - Added `setFeeCollector()` function
   - Fixed variable reference in `submitShieldedDeposit()` (line 430)

3. **app/src/App.tsx**
   - Added `setFeeCollector()` to debug API

## Verification Checklist

- [ ] Dev server running at http://localhost:5174/
- [ ] Call `setFeeCollector('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax')`
- [ ] Verify with `checkFeeCollector()` - should show correct address
- [ ] Test deposit: should now show 2 transfers
  - [ ] 100 NOC to vault
  - [ ] 0.25 NOC to fee collector
- [ ] Verify balance updates correctly
- [ ] Verify shielded balance displays correctly
