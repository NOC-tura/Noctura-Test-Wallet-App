# Testing Shielded Transactions - Quick Start

## Browser Console Testing

### 1. Check Current Balances
```javascript
// Open browser console (F12) and run:
await __noctura_debug.getBalance()
```

Expected output:
```json
{
  "SOL": "2.5",
  "NOC": "9800",
  "shieldedSOL": "0",
  "shieldedNOC": "100",
  "totalNotes": 2,
  "notes": [...]
}
```

### 2. Test Shielded Deposit (UI)
1. Open app in browser
2. Go to "Shield" tab
3. Select token type: SOL or NOC
4. Enter amount: 0.5 SOL or 50 NOC
5. Click "Shield"
6. Confirm transaction
7. **Expected:** Transparent balance stays same, shielded balance increases
8. **Check console:** Look for `[performShieldedDeposit]` logs

### 3. Verify Note Created
```javascript
// After deposit, check notes:
const notes = useShieldedNotes.getState().notes;
console.log('Notes:', notes.map(n => ({
  amount: n.amount,
  tokenType: n.tokenType,
  spent: n.spent
})));
```

Expected: Should see note with correct `tokenType` ('SOL' or 'NOC')

### 4. Test Shielded Transfer
1. Go to "Shielded" tab
2. Click "Send"
3. Enter recipient address
4. Enter amount to send
5. Click "Review"
6. Click "Confirm transfer"
7. **Expected:** Browser console shows:
   - `[startShieldedTransfer] Starting transfer...`
   - `[confirmShieldedTransfer] Submitting...`
   - `[relayTransfer] Submitting shielded transfer via relayer...`
   - `[relayTransfer] ✅ Transfer relayed successfully`

### 5. Verify Transfer Completed
```javascript
// Check that note was marked as spent:
const notes = useShieldedNotes.getState().notes;
console.log('Spent notes:', notes.filter(n => n.spent).length);
console.log('Unspent notes:', notes.filter(n => !n.spent).length);
```

## Expected Behavior After Fixes

### Shielded Deposits (Transparent → Shielded)
- ✅ Works for both SOL and NOC
- ✅ Creates note with correct `tokenType`
- ✅ Transparent balance unchanged
- ✅ Shielded balance increases
- ✅ Fee (0.25 NOC) deducted from shielded

### Shielded Transfers (Shielded → Shielded)
- ✅ Notes filtered correctly by `tokenType`
- ✅ Relayer called with transfer proof
- ✅ Original note marked as spent
- ✅ Change note added to shielded
- ✅ Recipient note created

### Balance Calculation
- ✅ Shielded SOL = sum of notes where `tokenType === 'SOL'`
- ✅ Shielded NOC = sum of notes where `tokenType === 'NOC'`
- ✅ Transparent SOL = unchanged by shielded ops
- ✅ Transparent NOC = unchanged by shielded ops

## Troubleshooting

### Issue: Transfer doesn't send
**Check:** Browser console for `[relayTransfer]` logs
- If not present: Transfer not reaching relayer call
- If error: Relayer not responding at `http://localhost:3001`

### Issue: Balance doesn't update
**Check:** After deposit, run `await __noctura_debug.getBalance()`
- If balance unchanged: Note not being added to state
- If wrong amount: Check `tokenType` field on note

### Issue: Wrong token type showing
**Check:** Console logs during deposit
```javascript
// Show tokenType of all notes:
useShieldedNotes.getState().notes.map(n => ({
  nullifier: n.nullifier.slice(0,8),
  tokenType: n.tokenType,
  amount: n.amount
}))
```

## Key Changes Made

| Component | Change | Impact |
|-----------|--------|--------|
| Balance calc | Use `tokenType` field | Correct SOL/NOC separation |
| Note filtering | Filter by `tokenType` only | Transfers find correct notes |
| Deposit mint | Always NOC_TOKEN_MINT | Single vault for all tokens |
| Relayer calls | Added relayTransfer/relayWithdraw | Transfers actually submit |

## Next Steps If Tests Fail

1. **Check relayer is running:**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Check relayer endpoints exist:**
   ```bash
   curl http://localhost:3001/api/relay-transfer -X POST
   ```

3. **Enable detailed logging:**
   - Open DevTools (F12)
   - Filter logs by: `[Transfer]`, `[relayTransfer]`, `[Balance]`

4. **Verify note structure:**
   ```javascript
   useShieldedNotes.getState().notes[0]
   ```
   Should show: `tokenType`, `amount`, `owner`, `spent`

## Success Indicators

✅ Shielded deposits appear immediately  
✅ Correct token type shown in balance  
✅ Transfers submit to relayer  
✅ Console logs show relayer success  
✅ Transparent balance never decreases  
