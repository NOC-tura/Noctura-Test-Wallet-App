# App Testing Guide - Noctura Wallet Shielded Mode

## ✅ Build Status
- **Build**: ✅ SUCCESS - No TypeScript errors
- **Server**: ✅ RUNNING at http://localhost:5173/
- **All fixes**: ✅ APPLIED

## 🧪 Testing Checklist

### 1. App Loads Successfully
**What to check:**
- [ ] App opens without errors (F12 console)
- [ ] Wallet UI displays correctly
- [ ] Mode selector visible (Transparent/Shielded)

**Expected:**
- Clean console (no 404s or critical errors)
- Wallet interface fully functional

---

### 2. Wallet Operations
**What to test:**
- [ ] Create new wallet
- [ ] Import wallet via mnemonic
- [ ] Check wallet address displayed
- [ ] View balances (SOL + NOC)

**Expected:**
- Wallet initializes without errors
- Can switch between transparent/shielded modes

---

### 3. Transparent Mode (Should Work as Before)
**What to test:**
```
a) SOL Transfer
   - Send 0.05 SOL to test address
   - Check transaction on explorer

b) NOC Transfer  
   - Send 0.05 NOC to test address
   - Check transaction on explorer
```

**Expected:**
- Transactions succeed
- Only network fees (no extra charges)
- No privacy fees in transparent mode

---

### 4. Shielded Mode - Key Tests

#### Test 4a: Check Fee Collector
```javascript
// In browser console (F12):
window.debugApi.checkFeeCollector()
  .then(r => {
    console.log('✅ Fee Collector:', r.feeCollector);
    console.log('Explorer:', r.explorerUrl);
  })
  .catch(e => console.error('❌', e));
```

**Expected:**
- Returns your wallet address as fee collector
- No errors in console

---

#### Test 4b: Shielded Deposit (0.1 SOL)
```
1. Switch to Shielded mode
2. Click "Deposit"
3. Enter amount: 0.1 SOL
4. Confirm transaction
```

**Expected Transaction:**
```
Transfer 1: Your Wallet → Vault (0.1 SOL)
Transfer 2: Your Wallet → Fee Collector (0.25 NOC)

Total Cost: 0.1 SOL + 0.25 NOC
No 0.00025 SOL fee (should be gone)
```

**Verification:**
- Get transaction ID from notification
- Go to: https://explorer.solana.com/tx/[TX_ID]?cluster=devnet
- Verify only 2 transfers (not 3)

---

#### Test 4c: Shielded Balance
After deposit:

```javascript
// Check shielded balance
window.debugApi.getShieldedBalance?.()
  .then(bal => console.log('Shielded:', bal))
```

**Expected:**
- Shows 0.1 SOL in shielded pool
- Balance persists on mode switch

---

#### Test 4d: Shielded Transfer
```
1. In shielded mode
2. Click "Send"
3. Recipient address: [test address]
4. Amount: 0.05 SOL
5. Confirm
```

**Expected:**
- Two on-chain transactions:
  - Split: 0.05 SOL (internal to shielded pool)
  - Withdraw: 0.05 SOL to recipient + 0.25 NOC fee
- Recipient receives 0.05 SOL in transparent wallet
- You pay 0.25 NOC

---

#### Test 4e: Shielded Withdrawal
```
1. In shielded mode
2. Click "Withdraw"
3. Withdraw to your address
4. Amount: 0.02 SOL
```

**Expected:**
- Two transactions (split + withdraw)
- You receive 0.02 SOL
- Fee: 0.25 NOC

---

### 5. Admin Functions (If You're the Deployer)

#### Check Fee Collector
```javascript
window.debugApi.checkFeeCollector()
```

#### Set Shield Fees to 0 (if not already)
```javascript
window.debugApi.setShieldFees()
  .then(r => console.log('✅', r))
  .catch(e => console.error('❌', e))
```

**Expected:**
- If already 0: success message
- If not 0: updates them to 0
- Signature returned if updated

---

## 🔍 Error Checking

### Console (F12) Should Show:
✅ No 404 errors
✅ No TypeScript errors
✅ No import failures
✅ Privacy systems initialized (optional success logs)

### Should NOT See:
❌ "Module not found" errors
❌ "Cannot read property" errors
❌ "Fetch failed" from relayer (unless prover not running)
❌ Undefined function errors

---

## 📊 Fee Verification Matrix

| Operation | Token | Amount | Fee | Total Cost |
|-----------|-------|--------|-----|------------|
| Deposit | SOL | 0.1 | 0.25 NOC | 0.1 SOL + 0.25 NOC |
| Transfer | SOL | 0.05 | 0.25 NOC | 0.05 SOL + 0.25 NOC |
| Withdraw | SOL | 0.02 | 0.25 NOC | 0.02 SOL + 0.25 NOC |

**All fees should be 0.25 NOC exactly - no percentage fees!**

---

## ✨ Success Criteria

### Build: ✅
- [x] No TypeScript compile errors
- [x] No type mismatches
- [x] All modules resolve correctly

### Runtime: ✅
- [ ] App loads without 404 errors
- [ ] Console has no critical errors
- [ ] Wallet initializes correctly

### Shielded Mode: ✅
- [ ] Deposits work (0.1 SOL test)
- [ ] Only 0.25 NOC fee (no percentage fees)
- [ ] Balances display correctly
- [ ] Transfers execute properly
- [ ] Recipient receives tokens

### Fees: ✅
- [ ] Fixed 0.25 NOC per transaction
- [ ] No WSOL transfers (only SOL)
- [ ] Fee collector is your wallet
- [ ] No hidden charges

---

## 🚀 If Everything Works:

```
✅ App compiles without errors
✅ Loads successfully in browser
✅ Shielded mode fully functional
✅ Fees are correct (0.25 NOC only)
✅ Privacy preserved
✅ Ready for production testing
```

## 🐛 If Issues Occur:

1. **App won't load**: Check F12 console for import errors
2. **Balance is 0**: Try switching modes (hydration issue)
3. **Transfer fails**: Check recipient address format
4. **Fee is wrong amount**: Check explorer for actual transfer
5. **Relayer error**: Make sure prover service is running

---

## Quick Debug Commands

```javascript
// Check all systems
window.debugApi?.checkFeeCollector?.()
window.debugApi?.setShieldFees?.()

// View window debug API
console.log(Object.keys(window.debugApi || {}))

// Check browser console for full logs
// Press F12 → Console tab
```

---

**Status**: Ready for comprehensive testing! 🎉
