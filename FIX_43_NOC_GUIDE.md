# Step-by-Step Guide: Fixing the 43 NOC Balance Issue

## Quick Start (5 minutes)

### Step 1: Inspect Your Notes
Open browser DevTools (F12 or Cmd+Option+I) and run:

```javascript
__noctura_debug.getShieldedNotes()
```

This will print a table showing:
- How many notes you have
- Amount in each note
- Which notes are yours (isOwned)
- Which are spent/unspent

**Expected after two 100 NOC deposits:** 2 notes of 100 NOC each

---

### Step 2: Check Balance Calculation
```javascript
__noctura_debug.getBalance()
```

This shows:
- `raw.shieldedNoc` - What the UI displays
- `calculated.nocAtoms` - Sum of your unspent notes
- `displayable.noc` - Calculated amount in NOC units
- `notes` - Count of total/owned/unspent notes

**Look for:** Do calculated and raw match?

---

### Step 3: Decision Tree

**If calculated balance matches what UI shows:**
→ Notes are being tracked correctly
→ The 43 NOC might be from old test data
→ Go to "Fresh Start" below

**If calculated is different from UI:**
→ Notes are corrupted or duplicated
→ Go to "Clean Reset" below

---

## Fresh Start (if notes are correct but old data exists)

### Option A: Keep existing notes
Just start fresh transactions and monitor:

```javascript
// Take a snapshot
const notes = __noctura_debug.getShieldedNotes()
console.save(notes, 'shielded_notes_backup.json')

// Deposit 10 NOC test amount
// Then check balance
__noctura_debug.getBalance()
```

### Option B: Clear everything and start over
```javascript
__noctura_debug.clearAllNotes()
// Wallet will forget all notes
// Transparent balance unaffected
// Do a fresh 10 NOC deposit to test
```

---

## Deep Diagnosis (if still broken)

### Check for Duplicates
```javascript
const analysis = __noctura_debug.getShieldedNotes()
const nullifiers = analysis.notes.map(n => n.nullifier)
const duplicates = nullifiers.filter((v, i, a) => a.indexOf(v) !== i)
if (duplicates.length > 0) {
  console.warn('FOUND DUPLICATES:', duplicates)
} else {
  console.log('✓ No duplicate notes')
}
```

**If duplicates found:** Clear and re-deposit:
```javascript
__noctura_debug.clearAllNotes()
```

### Check localStorage directly
```javascript
const stored = JSON.parse(localStorage.getItem('shielded-notes-storage'))
console.log('Notes in storage:', stored.state.notes.length)
console.log('Full storage:', stored)
```

### Check browser console logs
During deposits, you should see:
```
[performShieldedDeposit] DEPOSIT START: ...
[performShieldedDeposit] Deposit prepared: ...
[performShieldedDeposit] Proof generated successfully
[performShieldedDeposit] Calling submitShieldedDeposit...
[performShieldedDeposit] ADDING NOTE TO STORE: ...
[useShieldedNotes] Adding note to store: ...
```

**Missing any of these?** Deposit might be failing silently.

---

## Investigation: Where Does 43 Come From?

### Theory 1: It's from a specific deposit
```javascript
const analysis = __noctura_debug.getShieldedNotes()
const hasFortyThree = analysis.notes.find(n => n.displayAmountNoc === '43')
if (hasFortyThree) {
  console.log('Found a 43 NOC note:', hasFortyThree)
}
```

### Theory 2: It's a sum of partial notes
```javascript
const analysis = __noctura_debug.getShieldedNotes()
const unspentOwned = analysis.notes.filter(n => !n.spent && n.isOwned)
const sum = unspentOwned.reduce((acc, n) => acc + BigInt(n.amount), 0n)
console.log('Sum of unspent owned:', (Number(sum) / 1_000_000).toFixed(2), 'NOC')
```

### Theory 3: It's from an old test wallet
```javascript
const analysis = __noctura_debug.getShieldedNotes()
const notMine = analysis.notes.filter(n => !n.isOwned)
if (notMine.length > 0) {
  console.log('Found notes not owned by you:', notMine.length)
}
```

---

## Verification After Fix

### After clearing and re-depositing:

```javascript
// Deposit 50 NOC

// Wait for transaction to complete (look for success toast)

// Then check:
const balance = __noctura_debug.getBalance()
console.log('Expected ~49.75 NOC, got:', balance.displayable.noc)

// Check transparency:
const notes = __noctura_debug.getShieldedNotes()
console.table(notes.notes)
```

**Expected:** One note of 50 NOC, unspent, owned by you

---

## If Still Failing

### Generate debug report:
```javascript
const report = {
  timestamp: new Date().toISOString(),
  notes: __noctura_debug.getShieldedNotes(),
  balance: __noctura_debug.getBalance(),
  localStorage: JSON.parse(localStorage.getItem('shielded-notes-storage')),
  userAgent: navigator.userAgent,
}
console.save(report, 'noctura_debug_report.json')
```

Then:
1. Check `noctura_debug_report.json` for any obvious issues
2. Look at browser DevTools console for error messages
3. Share the report with the development team

---

## What Was Changed

**In this update:**
1. Added duplicate note detection - prevents same note from being added twice
2. Enhanced logging - can now trace every step of deposit
3. Better debug functions - can pinpoint where balance goes wrong

**The fee model is correct:**
- 0.25 NOC fee deducted from transparent balance (user's wallet)
- Shielded notes keep full amount deposited
- Fee is for privacy infrastructure, not part of shielded balance

---

## Questions?

Common issues and solutions:

**Q: Balance still shows 43 after clearing?**
A: Reload the page after clearing (`__noctura_debug.clearAllNotes()`), then re-deposit.

**Q: Deposit seems to hang?**
A: Check that prover service is running on port 8787. Look for "Noctura prover listening on 8787" in terminal.

**Q: Notes appear but balance doesn't increase?**
A: Check that note's `isOwned` is true and `spent` is false. If not, run `resyncShieldedNotes()`.

**Q: Previous deposits disappeared?**
A: They're still in localStorage. Don't clear unless you intentionally want to reset.
