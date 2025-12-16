# Balance Bug Fix Summary

## Changes Made

### 1. **Duplicate Note Prevention** 
**File:** `app/src/hooks/useShieldedNotes.ts`

Added duplicate detection in the `addNote` function:
- Checks if a note with the same nullifier already exists
- Logs a warning if a duplicate is detected
- Prevents the duplicate from being added to the store
- This prevents a single deposit from being counted twice

**Impact:** Fixes scenario where the same note could be added to the state multiple times, causing inflated balance.

### 2. **Enhanced Deposit Logging**
**File:** `app/src/App.tsx` - performShieldedDeposit function

Added detailed logging at each stage of the deposit process:
- Initial deposit start with amount in atoms and display format
- Proof preparation with note commitment and nullifier
- Proof generation with size tracking
- Deposit submission with signature and leaf index
- Final note addition to store with verification

**Impact:** Makes it possible to trace where amounts are lost or duplicated during deposit flow.

### 3. **Comprehensive Debug Functions**
**File:** `app/src/App.tsx` - __noctura_debug object

Enhanced the debug functions exposed to the browser console:

```javascript
__noctura_debug.getShieldedNotes()
// Now shows detailed breakdown of each note:
// - Amount in both atoms and display format
// - Token type (NOC/SOL)
// - Ownership verification
// - Spent status
// - Leaf index and creation timestamp
// - Summary statistics by token type

__noctura_debug.getBalance()
// Now shows detailed balance comparison:
// - Raw UI display value
// - Calculated value from stored notes
// - Both in atoms and display format
// - Note count breakdown (total, owned, unspent)
// - Highlighted any mismatches

__noctura_debug.clearAllNotes()
// Same as before - clears all stored notes

await __noctura_debug.resyncShieldedNotes()
// Same as before - syncs with on-chain state
```

**Impact:** Makes it easy to identify the root cause of balance discrepancies.

## Investigation Plan

### For Users Seeing 43 NOC Issue:

1. **Run diagnostic** in browser console:
   ```javascript
   __noctura_debug.getBalance()
   ```

2. **Check if notes exist**:
   ```javascript
   __noctura_debug.getShieldedNotes()
   ```

3. **If balance is wrong**:
   - Notes should total ~200 NOC (from two 100 NOC deposits)
   - If less, check if any notes are marked as spent
   - If mismatched from calculation, clear and re-deposit:
   ```javascript
   __noctura_debug.clearAllNotes()
   ```

### If Problem Persists:

The 43 NOC is likely coming from:

1. **Corrupted historical notes** in localStorage from previous test runs
   - Solution: Clear notes and re-deposit fresh

2. **Fee being applied incorrectly** (but code review shows this is correct)
   - Check logs: should see "Collecting 0.25 NOC privacy fee" for each deposit
   - Fee deducted from transparent balance only, not shielded notes

3. **Note duplication** (now prevented by new code)
   - Old runs may have duplicate notes
   - New deposits will prevent duplicates going forward

## Testing Recommendations

1. **Fresh wallet test**:
   - Create new wallet
   - Deposit 100 NOC
   - Check: `__noctura_debug.getBalance()` should show ~100 NOC (minus 0.25 fee)
   - Repeat with second 100 NOC deposit
   - Check: should now show ~200 NOC (minus 0.5 fee total)

2. **Page reload test**:
   - Deposit 50 NOC
   - Reload page
   - Check: balance should persist and be correct
   - Verify no duplicate notes created

3. **Fee verification**:
   - Check transparent balance before and after deposit
   - Should decrease by deposit amount + 0.25 NOC
   - Shielded balance should increase by deposit amount (fee separate)

## Technical Details

**Fee Model:**
- Privacy fee: 0.25 NOC per shielded transaction (constant)
- Deducted from: Transparent (user's) balance
- NOT deducted from: Shielded note amounts
- Purpose: Pay for privacy infrastructure (relayers, proof verification)

**Deposit Flow:**
1. User deposits X NOC
2. Note created with X NOC (full amount)
3. Proof generated
4. submitShieldedDeposit called:
   - collectPrivacyFee deducts 0.25 from transparent balance
   - Note submitted on-chain
5. Note added to local store
6. Shielded balance increases by X (fee separate)

**Balance Calculation:**
- Transparent = user's wallet balance
- Shielded = sum of unspent notes owned by user
- Both amounts tracked separately

## Future Improvements

1. Add balance validation on every state change
2. Implement reconciliation with on-chain state at startup
3. Add transaction history logging
4. Implement note export/import for debugging
5. Add test suite for deposit flows
