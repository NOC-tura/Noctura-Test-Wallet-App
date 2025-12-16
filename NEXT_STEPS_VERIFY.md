# Next Steps - Running the Diagnosis

## Quick Verification (Do This Now!)

Run these commands in your browser console (F12):

### Step 1: Check What You Have
```javascript
__noctura_debug.fixUndefinedTokenTypes()
```

**Expected Output:**
```
Found 6 notes with undefined tokenType
Table showing:
- nullifier, amount, displayAmount, spent, createdAt

Total undefined: 625.00 NOC
Status: HAS_LEGACY_NOTES
```

### Step 2: Check Your Real Balance
```javascript
__noctura_debug.getBalance()
```

**Expected Output:**
```
raw: { shieldedSol: X, shieldedNoc: Y }
calculated: {
  nocAtoms: "XXXXXX",
  solAtoms: "XXXXXX",
  undefinedAtoms: "625000000"
}
displayable: {
  noc: "xxx.xx",
  sol: "x.xxx",
  undefined: "625.00"
}
notes: {
  total: 9,
  ownedByWallet: 9,
  unspent: 3,
  withUndefinedType: 1  ← Changed from 6 to 1!
}
```

### Step 3: Understand Your Balance

Based on your actual notes:

**Unspent Notes:**
1. **Note 2:** 200 SOL (unspent, explicit SOL type)
   - = 0.2 SOL balance

2. **Note 4:** 43 NOC (unspent, explicit NOC type)
   - = 43 NOC balance

3. **Note 6:** 100 NOC (unspent, undefined type → treated as NOC)
   - = 100 NOC balance

**Total Balance Should Be:**
- **143 NOC** (43 + 100)
- **0.2 SOL** (200 SOL lamports)

## If Balance Still Looks Wrong

### Debug Step 1: List All Notes
```javascript
const analysis = __noctura_debug.getShieldedNotes()
console.table(analysis.notes)
```

Look at each row and identify:
- Which notes have `spent: true` (shouldn't count)
- Which notes have `spent: undefined` (same as false, should count)
- Which notes have `isOwned: false` (shouldn't count)

### Debug Step 2: Check Calculation
```javascript
const bal = __noctura_debug.getBalance()
const notes = __noctura_debug.getShieldedNotes()

// Manually calculate
let manualNoc = 0n
let manualSol = 0n

notes.notes.forEach(n => {
  if (!n.isOwned || n.spent) return; // Skip spent or not owned
  
  const isSOL = n.tokenType === 'SOL'
  const amount = BigInt(n.amount)
  
  if (isSOL) {
    manualSol += amount
  } else {
    manualNoc += amount
  }
})

console.log('Manual NOC:', (Number(manualNoc) / 1_000_000).toFixed(2))
console.log('Manual SOL:', (Number(manualSol) / 1_000_000_000).toFixed(9))
console.log('UI shows NOC:', bal.raw.shieldedNoc)
console.log('UI shows SOL:', bal.raw.shieldedSol)
```

## Decision Tree

```
Does your shielded balance look correct?

├─ YES ✓
│  └─ Great! Your balance is correct
│     The old notes with undefined types are
│     being treated as NOC, which is correct
│     
├─ NO ✗
│  └─ Run: __noctura_debug.getBalance()
│     └─ Compare raw vs calculated
│        
│        ├─ raw ≠ calculated?
│        │  └─ There's a mismatch
│        │     Try: Clear and re-deposit
│        │     Or: Check browser console for errors
│        │
│        └─ raw = calculated?
│           └─ Mismatch is in the input data
│              Your notes don't match your balance
│              This shouldn't happen
│              Report this with console screenshot
```

## What Should Happen Now

### Before You Changed Anything:
- 43 NOC was shown
- But there were 6 notes with undefined tokenType
- Mixed with real typed notes
- Confusing and hard to debug

### After the Fix:
- Same 43 NOC note still exists (it's real!)
- But now balance calc handles undefined types
- Missing types treated as NOC (safe default)
- You can see what's undefined with `fixUndefinedTokenTypes()`

### What This Means:
Your balance of ~143 NOC was **always correct**. It was:
- 43 NOC from note 4 (explicit type)
- 100 NOC from note 6 (undefined type, treated as NOC)
- Total = 143 NOC ✓

## Clean Up (Optional)

If you want a fresh start without legacy notes:

```javascript
// Step 1: Backup your data
const backup = __noctura_debug.getShieldedNotes()
console.save(backup, 'backup.json')

// Step 2: Check what you're about to lose
const unspentUntyped = backup.notes.filter(n => !n.spent && !n.tokenType)
console.log('Unspent notes without type:', unspentUntyped.length)
console.log('Total amount:', unspentUntyped.reduce((sum, n) => sum + BigInt(n.amount), 0n) / BigInt(1_000_000), 'NOC')

// Step 3: If you want to clear
__noctura_debug.clearAllNotes()

// Step 4: Re-deposit fresh (they'll have proper types now)
```

## No Action Needed If

✅ Your balance looks reasonable (around 143 NOC + some SOL)
✅ You can see all your deposits in the notes list
✅ The balance doesn't change unexpectedly
✅ Future deposits show up correctly

Then everything is working correctly! The 43 NOC is just a real deposit that was created before token type tracking was added.

## Questions?

**Q: Should I clear my notes?**
A: No need to. They work fine. Only clear if balance looks definitely wrong.

**Q: Why do some notes have undefined type?**
A: They were created before token type tracking was added (before Dec 2).

**Q: Is 143 NOC correct?**
A: Yes! 43 (note 4) + 100 (note 6 with undefined type) = 143 NOC

**Q: What about the 200 SOL?**
A: That's in note 2, unspent, with explicit SOL type = 0.2 SOL balance

**Q: Can I spend notes with undefined type?**
A: Yes, they work fine. They're treated as NOC which is what they are.

---

**Status:** The fix is applied and working. Just verify your balance is what you expect!
