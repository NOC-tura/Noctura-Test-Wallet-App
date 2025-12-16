# Shielded Balance Debugging Guide

## Problem
Shielded balance shows 43 NOC instead of the expected ~200 NOC (from two 100 NOC deposits minus 0.5 NOC in fees).

## Root Cause Analysis

The issue is likely caused by one of:

1. **Corrupted notes in localStorage** - Old notes from previous test runs with wrong amounts
2. **Duplicate note detection** - Fixed in `useShieldedNotes.ts` to prevent adding the same note twice
3. **Fee deduction logic** - Fee is properly deducted from transparent balance only, not from shielded notes

## Enhanced Logging Added

### 1. **Detailed Deposit Logging** (App.tsx, performShieldedDeposit)
- Logs full deposit flow with amounts at each stage
- Tracks noteAmount, displayAmount, and signature

### 2. **Duplicate Prevention** (useShieldedNotes.ts, addNote)
- Checks for existing notes by nullifier
- Warns if duplicate detected
- Logs each note addition with metadata

### 3. **Enhanced Debug Functions** (App.tsx, __noctura_debug)
Available in browser console:

```javascript
// 1. Get all shielded notes with details
__noctura_debug.getShieldedNotes()
// Shows: nullifier, amount (in atoms and display format), tokenType, owner, spent status

// 2. Check calculated balance
__noctura_debug.getBalance()
// Shows: calculated balance from notes, compared to UI balance display

// 3. Clear all notes (fresh start)
__noctura_debug.clearAllNotes()

// 4. Resync on-chain state
await __noctura_debug.resyncShieldedNotes()
```

## Debugging Steps

### Step 1: Inspect Current Notes
```javascript
__noctura_debug.getShieldedNotes()
```
**Check for:**
- Are there 2 notes (one for each 100 NOC deposit)?
- Are amounts correct (100,000,000 atoms = 100 NOC)?
- Are any notes marked as spent?
- Any duplicates with same nullifier?

### Step 2: Check Balance Calculation
```javascript
const bal = __noctura_debug.getBalance()
console.log('Calculated NOC:', bal.calculated.nocAtoms)
console.log('Displayed NOC:', bal.displayable.noc)
console.log('UI Shows:', bal.raw.shieldedNoc)
```
**Check for:**
- Does calculated match the note amounts?
- Does calculated match what UI displays?
- Are notes being filtered correctly by owner?

### Step 3: Fresh Start if Needed
If balance is still wrong after inspection:

```javascript
__noctura_debug.clearAllNotes()
// Then manually re-deposit using the wallet UI
// Check notes again: __noctura_debug.getShieldedNotes()
```

## Fee Flow (Correct)
1. User initiates deposit of 100 NOC
2. `performShieldedDeposit` called with 100,000,000 atoms
3. Note created with 100,000,000 atoms ✓
4. Proof generated
5. `submitShieldedDeposit` called:
   - **Collects 0.25 NOC privacy fee** → deducted from TRANSPARENT balance
   - **Note still has 100,000,000 atoms** → NOT reduced by fee
6. Note added to store with full amount
7. Shielded balance = sum of all unspent note amounts

## Key Code Changes

### useShieldedNotes.ts
- Added duplicate detection in `addNote`
- Logs each addition with full metadata
- Prevents same note from being added twice

### App.tsx - performShieldedDeposit
- Enhanced logging at each step
- Tracks displayAmount for debugging
- Logs noteAmount before and after adding to store

### App.tsx - __noctura_debug
- `getShieldedNotes()`: Returns all notes with analysis
- `getBalance()`: Calculates balance from stored notes, compares to UI
- `clearAllNotes()`: Resets store for fresh start
- `resyncShieldedNotes()`: Syncs with on-chain state

## Expected Behavior

After two 100 NOC deposits:
- Transparent balance: 10,000 - 200 (deposits) - 0.5 (fees) = **~9,799.5 NOC** ✓
- Shielded balance: sum of all unspent notes = **200 or 199.5 NOC** (should match deposits minus fee if fee is deducted from notes)

## If Still Broken

Check browser console logs for:
1. "DUPLICATE NOTE DETECTED" warnings → indicates same note added multiple times
2. "ADDING NOTE TO STORE" logs → verify amounts being saved
3. "Collecting 0.25 NOC privacy fee" → verify fee is being collected
4. Look for transaction errors → verify submitShieldedDeposit completes successfully

## Contact Points

- `performShieldedDeposit` (App.tsx, ~line 1000): Deposit execution
- `submitShieldedDeposit` (shieldProgram.ts, ~line 170): On-chain submission & fee collection
- `collectPrivacyFee` (shieldProgram.ts, ~line 90): Fee deduction logic
- `snapshotNote` (shield.ts, ~line 80): Note storage
- `useShieldedNotes` (useShieldedNotes.ts): State management
