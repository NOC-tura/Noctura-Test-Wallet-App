# 🚀 Quick Start: Test 0.1 SOL Shielded Deposit

## 📋 What You Need to Do

### 1. Open the App
- **URL**: http://localhost:5173/
- **Status**: ✅ Server Running at port 5173

### 2. Create/Import Wallet (if needed)
- Create new OR
- Import with mnemonic/secret key

### 3. Ensure You Have Funds
In **Transparent Mode**, verify:
- [ ] SOL Balance: ≥ 0.1 SOL
- [ ] NOC Balance: ≥ 0.25 NOC

(If low, use airdrop feature or import funded wallet)

### 4. Switch to Shielded Mode
- Click mode selector
- Choose "Shielded"

### 5. Click Deposit
- Click "Deposit" button
- Enter: `0.1`
- Confirm

---

## 📊 What Will Happen

### Internally
1. ✅ System generates ZK proof
2. ✅ Collects 0.25 NOC privacy fee
3. ✅ Creates shielded note
4. ✅ Submits to blockchain

### On Blockchain
**Two transfers ONLY**:
```
Transfer 1: 0.1 SOL → Vault
Transfer 2: 0.25 NOC → Your Wallet
```

**No third transfer!** (no percentage fee)

### In App
- Shielded Balance: 0.1 SOL
- Transparent Balance: Decreases by 0.1 SOL + 0.25 NOC

---

## ✅ What to Check

### Console (F12)
Look for these logs (in order):
1. `[performShieldedDeposit] DEPOSIT START`
2. `[proveCircuit] deposit proof generated`
3. `[collectPrivacyFee] Privacy fee collected`
4. `[submitShieldedDeposit] Deposit submitted successfully`
5. `[useShieldedNotes] Note saved to localStorage`

### No Errors
❌ Should NOT see:
- "Bad Request" errors
- "Account update failed"
- "Fetch failed"
- Any red error messages

### Blockchain (Solana Explorer)
1. Get TX ID from notification
2. Open: https://explorer.solana.com/tx/[TX_ID]?cluster=devnet
3. Scroll to "Transfers"
4. Count transfers: Should be exactly **2**

**Transfer Details**:
```
✅ Transfer 1: 0.1 SOL to Vault
✅ Transfer 2: 0.25 NOC to Fee Collector
❌ Transfer 3: SHOULD NOT EXIST
```

---

## 🎯 Expected Outcome

After deposit completes:

```
TRANSPARENT MODE              SHIELDED MODE
───────────────────          ─────────────
SOL: 0.4                     SOL: 0.1
NOC: 0.75                    
                             (0.1 in privacy pool)
```

**Total Cost**: 0.1 SOL + 0.25 NOC

---

## 📈 Success Indicators

All should be ✅:
- [ ] Transaction succeeds
- [ ] Exactly 2 transfers
- [ ] 0.1 SOL to vault
- [ ] 0.25 NOC to fee collector
- [ ] No percentage fee (no 0.00025 SOL)
- [ ] Shielded balance = 0.1 SOL
- [ ] No console errors
- [ ] Privacy preserved

---

## 🔗 Key Links

**Current App**: http://localhost:5173/

**Test Plans**:
- `SHIELDED_DEPOSIT_TEST_PLAN.md` - Detailed test plan
- `DEPOSIT_TEST_EXECUTION.md` - Expected console output
- `APP_TESTING_GUIDE.md` - Complete testing guide

**Documentation**:
- `FEE_COLLECTOR_FINAL_ANSWER.md` - Fee collector info
- `STATUS_REPORT.md` - Overall status

---

## 🆘 If Something Goes Wrong

### "Bad Request" Error
→ Prover/relayer service issue
→ Check localhost:8787 is running

### Balance stays 0
→ Switch modes (transparent → shielded)
→ Wait for confirmation

### Wrong amount/fee appears
→ Refresh browser
→ Rebuild app: `npm run build`

### 0.00025 SOL fee instead of 0.25 NOC
→ Run: `window.debugApi.setShieldFees()`
→ Only admin can do this

---

## 🚀 Ready to Test!

1. ✅ App running at http://localhost:5173/
2. ✅ Build successful (no errors)
3. ✅ Server responding
4. ✅ Fee collection configured
5. ✅ Shielded mode ready

**Just open the app and try the deposit!**

---

**Go test! 🎉**
