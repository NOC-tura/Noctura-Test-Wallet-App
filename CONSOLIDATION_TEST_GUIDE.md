# Automatic Consolidation - Quick Test Guide

## Prerequisites
✅ Noctura Wallet app running (`npm run dev`)  
✅ DevNet environment active  
✅ At least 0.1 SOL in transparent balance  
✅ Access to wallet private key  

## Test Scenario: 300 × 1 SOL Deposits → Single Withdrawal

### Phase 1: Create Many Small Deposits (10-15 min)
This step creates fragmented notes that will require consolidation.

#### Option A: Manual Deposits (Fast for testing)
1. Open app, switch to "Shielded Mode"
2. Click "Deposit" button
3. Enter amount: `0.1` SOL
4. Repeat **300 times** *(automated script recommended)*

#### Option B: Bulk Deposit Script (Recommended)
```bash
# Create bulk_deposit.js in app/ directory
node bulk_deposit.js --amount 1 --count 300 --token SOL

# This will deposit 1 SOL, 300 times (or batch into manageable chunks)
```

**Expected Output After Phase 1:**
```
✅ Shielded Balance: 300 SOL
✅ Notes in vault: 300 individual notes
```

### Phase 2: Test Auto-Consolidation (20-40 min)

1. **Initiate Full Withdrawal**
   - Click "Withdraw" or "Send to Self"
   - Enter amount: `300` SOL
   - Click "Confirm"

2. **Observe Consolidation**
   Expected console output:
   ```
   [Transfer] ⚡ AUTO-CONSOLIDATION TRIGGERED: {
     availableNotes: 300,
     needed: 300000000000,
     totalAvailable: 300000000000
   }
   [Transfer] Consolidating batch 1/38… (proof generation ~30-60s)
   [Transfer] Consolidation step 1: merging 8 notes
   [Transfer] Consolidation proof 1 generated
   [Transfer] Submitting consolidation 1/38…
   [Transfer] Consolidation 1 submitted: [TX_HASH]
   ```

3. **Status Messages in UI**
   - "Consolidating 300 notes into 2-4 notes… (this may take 2-3 min)"
   - Progress: "Consolidating batch 1/38…", "2/38…", etc.
   - Completion: "Consolidation complete. Processing your transfer..."

4. **Final Withdrawal**
   After consolidation completes, system proceeds with withdrawal:
   - Generates withdrawal proof (~30-60s)
   - Submits via relayer
   - Shows success: "Withdrawal confirmed"

### Phase 3: Verify Results (5 min)

✅ **Check Shielded Balance**
```
Before: 300 SOL (300 notes)
After:  0 SOL (all withdrawn)
```

✅ **Check Transparent Balance**
```
Should be: Previous + 300 SOL - ~0.00005 SOL (network fee)
```

✅ **Verify on Explorer**
- Find transaction hash from success message
- Open in Solana Explorer: `https://explorer.solana.com/tx/[TX_HASH]?cluster=devnet`
- Verify:
  - Multiple consolidation transactions
  - One final withdrawal transaction
  - Single privacy fee (0.25 NOC) charged

## Expected Timings

| Phase | Duration | Notes |
|-------|----------|-------|
| Deposits (300×) | 10-15 min | Sequential deposits, each ~2s |
| Consolidation (38 batches) | 19-38 min | 30-60s per batch × 38 |
| Final Withdrawal | 1-2 min | Standard withdrawal + network |
| **Total** | **30-55 min** | Full cycle for 300 notes |

## Assertions to Verify

### 1. Consolidation Happened Automatically
```
✅ App detected >4 notes
✅ Triggered consolidation without user intervention
✅ User did NOT manually click "Consolidate" button
```

### 2. Correct Amount Preserved
```
Before: 300 SOL in 300 notes
After:  300 SOL (or 300 - fee) in wallet
❌ FAIL if: Any amount lost during consolidation
```

### 3. Single Privacy Fee Applied
```
Expected: 1 × 0.25 NOC privacy fee
❌ FAIL if: Multiple 0.25 NOC fees charged
❌ FAIL if: No privacy fee charged
```

### 4. All Consolidation Proofs Valid
```
Each batch should show:
✅ Proof generated successfully
✅ Relayer accepted proof
✅ Nullifiers marked as spent
✅ Output note added to wallet
```

### 5. Final Withdrawal Works
```
After consolidation:
✅ Withdrawal proof generated
✅ Funds transferred to recipient
✅ Transaction confirmed on-chain
```

## Troubleshooting

### "Consolidation taking too long"
- Normal: 30-60s per batch × number of batches
- For 300 notes: ~38 batches × 45s avg = ~28 minutes
- Continue waiting or check network latency

### "Consolidation Failed: Merkle Proof Error"
- Ensure no other deposits/withdrawals happening during consolidation
- Check browser console for detailed error message
- Retry: Browser may need to reconnect to prover service

### "Out of Memory During Consolidation"
- Browser memory issue
- Restart app and retry
- Consider breaking into smaller transfers (150 SOL × 2)

### "Consolidation Submitted but Transaction Failed"
- Check relayer is running: `http://localhost:8787/relay/consolidate`
- Verify prover service has `consolidate` circuit compiled
- Check network connectivity

### "UI Showing Wrong Note Count"
- Refresh browser (Cmd/Ctrl + R)
- Check localStorage: `useShieldedNotes` state
- Manual state check in console:
  ```javascript
  window.debugApi.getShieldedNotes().then(notes => console.log('Total notes:', notes.length))
  ```

## Performance Baseline

For 300 notes (reference measurement):
- Consolidation: 28-35 minutes
- Final withdrawal: 1-2 minutes
- **Total: ~30-37 minutes**

(This is acceptable as a one-time cost. Users won't consolidate 300 notes frequently.)

## Post-Test Checklist

- [ ] Consolidation auto-triggered (no manual button click)
- [ ] Progress messages shown in UI
- [ ] All 300 SOL received in wallet
- [ ] 1 × privacy fee charged (0.25 NOC)
- [ ] Transaction visible on Solana Explorer
- [ ] Nullifiers properly invalidated
- [ ] Notes marked as spent in wallet

## Success Criteria

✅ **PASS**: User deposits 300 SOL over time → Withdraws 300 SOL in ONE transaction with ONE fee  
✅ **PASS**: System automatically consolidates without user knowing technical details  
✅ **PASS**: No amount lost, only network fee + privacy fee paid  
✅ **PASS**: All proofs valid and submitted successfully  

❌ **FAIL**: Manual consolidation required  
❌ **FAIL**: Amount lost during consolidation  
❌ **FAIL**: Multiple privacy fees charged  
❌ **FAIL**: Consolidation rejected by circuit  
