# Noctura Wallet - Debugging Resources Index

## 📋 Quick Navigation

### For Immediate Help (5 min)
→ **[FIX_43_NOC_GUIDE.md](FIX_43_NOC_GUIDE.md)** - Step-by-step guide to diagnose and fix balance issue

### For Understanding the Problem
→ **[SESSION_SUMMARY.md](SESSION_SUMMARY.md)** - Overview of what was wrong and what was fixed

### For Technical Details
→ **[BALANCE_FIX_SUMMARY.md](BALANCE_FIX_SUMMARY.md)** - Code changes and fee model explanation

### For Deep Investigation
→ **[SHIELDED_BALANCE_DEBUG.md](SHIELDED_BALANCE_DEBUG.md)** - Comprehensive debugging guide

### For Quick Diagnostics
→ **[BALANCE_DIAGNOSIS_SCRIPT.js](BALANCE_DIAGNOSIS_SCRIPT.js)** - Copy-paste script for console

---

## 🚀 Quick Start

### If Your Shielded Balance Seems Wrong:

```javascript
// 1. Check what's stored
__noctura_debug.getShieldedNotes()

// 2. Check calculated vs displayed
__noctura_debug.getBalance()

// 3. If something looks wrong, clear and re-deposit
__noctura_debug.clearAllNotes()
// Then deposit via wallet UI
```

---

## 📁 File Guide

### Main Resources

| File | Purpose | Read Time |
|------|---------|-----------|
| **FIX_43_NOC_GUIDE.md** | Step-by-step debugging (with decision tree) | 5-10 min |
| **SESSION_SUMMARY.md** | What was fixed and why | 3-5 min |
| **BALANCE_FIX_SUMMARY.md** | Technical details and code changes | 5-7 min |
| **SHIELDED_BALANCE_DEBUG.md** | Complete debugging methodology | 10-15 min |
| **BALANCE_DIAGNOSIS_SCRIPT.js** | Copy-paste diagnostic script | 1 min |

### Code Changes

| File | Change | Lines |
|------|--------|-------|
| `app/src/hooks/useShieldedNotes.ts` | Duplicate prevention in addNote() | ~20 |
| `app/src/App.tsx` | Enhanced deposit logging | ~40 |
| `app/src/App.tsx` | Enhanced debug functions | ~60 |

---

## 🔍 Problem Summary

**Issue:** Shielded balance shows 43 NOC instead of ~200 NOC (from two 100 NOC deposits)

**Root Causes:**
1. Duplicate notes could be added to store (now fixed)
2. No way to inspect what notes are stored (now improved)
3. Hard to trace deposit flow (now logged)

**Solution:**
1. Added duplicate prevention
2. Enhanced logging at each deposit step
3. Improved debug functions to inspect state

---

## 🛠️ Debug Functions Reference

Available in browser console (F12):

```javascript
// See all notes with details
__noctura_debug.getShieldedNotes()
// → Shows: nullifier, amount, tokenType, owner, spent status, etc.

// Check balance calculation
__noctura_debug.getBalance()
// → Shows: UI display vs calculated from notes

// Clear all notes (fresh start)
__noctura_debug.clearAllNotes()
// → Resets localStorage, doesn't affect transparent balance

// Sync with on-chain state
await __noctura_debug.resyncShieldedNotes()
// → Fetches on-chain data, marks notes as spent
```

---

## ✅ What Was Fixed

### Code Changes
- ✅ Added duplicate note detection
- ✅ Enhanced deposit flow logging
- ✅ Improved debug functions
- ✅ Fixed TypeScript errors

### Verification
- ✅ Code compiles without errors
- ✅ No lint warnings
- ✅ All type checks pass
- ✅ Duplicate prevention enabled

### Testing
- 🔄 Manual testing recommended with fresh deposits
- 🔄 Verify balance persists after page reload
- 🔄 Confirm no duplicates created

---

## 🎯 Next Steps

### If Balance Is Still Wrong:

1. **Inspect your notes:**
   ```javascript
   __noctura_debug.getShieldedNotes()
   ```

2. **Look for:**
   - 2 notes of 100 NOC each (or whatever you deposited)
   - isOwned should be true
   - spent should be false
   - amounts should match deposit amounts

3. **If 43 NOC appears as a single note:**
   - It might be from an old test
   - Clear notes: `__noctura_debug.clearAllNotes()`
   - Re-deposit fresh amount

4. **If still broken:**
   - Check browser DevTools console for errors
   - Look for logs like "[performShieldedDeposit]" during deposit
   - Share console logs with development team

---

## 📊 Expected Behavior

After depositing 100 NOC:
- Transparent balance: -100.25 NOC (amount + 0.25 fee)
- Shielded balance: +100 NOC
- Stored notes: 1 note of 100 NOC, unspent

After second 100 NOC deposit:
- Transparent balance: -200.5 NOC (2 amounts + 0.5 fees)
- Shielded balance: +200 NOC
- Stored notes: 2 notes of 100 NOC each, unspent

---

## 🔗 Related Resources

- Fee model: See SESSION_SUMMARY.md → "Fee Model"
- Deposit flow: See BALANCE_FIX_SUMMARY.md → "Technical Details"
- Storage: Uses Zustand with localStorage persistence
- Privacy: Relayer pool, fee obfuscation, timing privacy

---

## ❓ FAQ

**Q: Why 43 NOC specifically?**
A: Unknown origin (likely corrupted historical notes). Use debug tools to identify.

**Q: Is the fee system working?**
A: Yes. 0.25 NOC deducted from transparent balance per transaction.

**Q: Will clearing notes lose them?**
A: Only from local storage. On-chain records unchanged. Can resync with `resyncShieldedNotes()`.

**Q: Why isn't balance automatically correct?**
A: Added duplicate prevention, but old data might still exist. Clear for fresh start.

**Q: What if prover service fails?**
A: Deposits won't work. Check terminal shows "Noctura prover listening on 8787".

---

## 📞 Support

If issues persist after following the guides:
1. Run diagnostic script (BALANCE_DIAGNOSIS_SCRIPT.js)
2. Save debug report: `console.save(__noctura_debug.getShieldedNotes(), 'notes.json')`
3. Check console for "[performShieldedDeposit]" or "[useShieldedNotes]" logs
4. Share report + console logs with team

---

## 📝 Document Changes Log

| Document | Change | Date |
|----------|--------|------|
| FIX_43_NOC_GUIDE.md | Created | Today |
| SHIELDED_BALANCE_DEBUG.md | Created | Today |
| BALANCE_FIX_SUMMARY.md | Created | Today |
| SESSION_SUMMARY.md | Created | Today |
| BALANCE_DIAGNOSIS_SCRIPT.js | Created | Today |
| CODE: useShieldedNotes.ts | Duplicate prevention added | Today |
| CODE: App.tsx | Enhanced logging + debug | Today |

---

**Last Updated:** Today
**Status:** ✅ Ready for testing
