# Shielded Deposit Test: 0.1 SOL → Shielded Mode

## Test Execution Summary

**Test Date**: 11 December 2025
**Amount**: 0.1 SOL (from transparent to shielded)
**Expected Fee**: 0.25 NOC
**Status**: Ready to Execute

---

## 🧪 Test Steps

### Step 1: Verify Fee Collector

**Command**:
```javascript
window.debugApi.checkFeeCollector()
  .then(r => {
    console.log('✅ Fee Collector:', r.feeCollector);
    console.log('Explorer:', r.explorerUrl);
  });
```

**Expected Output**:
```
✅ Fee Collector: [Your Wallet Address]
Explorer: https://explorer.solana.com/address/[Your Address]?cluster=devnet
```

---

### Step 2: Check Initial Balances

**In App UI**:
1. Ensure you're in **Transparent mode**
2. Check SOL balance: Should have ≥ 0.1 SOL
3. Check NOC balance: Should have ≥ 0.25 NOC (for fees)

**Expected**:
```
Transparent Mode:
  SOL Balance: 0.5 (or more)
  NOC Balance: 1.0 (or more)
```

---

### Step 3: Switch to Shielded Mode

**Action**: Click mode selector to switch to "Shielded"

**Expected**:
```
✅ Mode switched to Shielded
✅ Shielded balance displayed (should be 0)
✅ Deposit button appears
```

---

### Step 4: Initiate Deposit

**Action**:
1. Click "Deposit" button
2. Enter amount: `0.1`
3. Ensure token is set to `SOL`
4. Click "Confirm"

**System Performs**:
1. Generates ZK proof for deposit
2. Collects 0.25 NOC privacy fee
3. Submits deposit transaction

---

## 📊 Expected Transaction Output

### Transaction Details

**Transaction Type**: Shielded Deposit (SOL)

```
Transaction Hash: [Should be provided in notification]
Status: Success
Block: [Devnet block number]
Timestamp: [Current time]
Signer: [Your Wallet Address]
```

### Transfers in Transaction

**Transfer 1: Deposit Amount**
```
From: [Your Wallet]
To: Vault Token Account
Amount: 0.1 SOL
Token: SOL (Native)
Program: Token Program
Status: ✅ Success
```

**Transfer 2: Privacy Fee**
```
From: [Your Wallet]
To: Fee Collector (Your Wallet)
Amount: 0.25 NOC
Token: NOC (Token Mint: 2aFVaS...)
Program: Token Program
Status: ✅ Success
```

### What Should NOT Appear

❌ **Transfer 3** (Percentage Fee):
```
From: [Your Wallet]
To: Fee Collector
Amount: 0.00025 SOL (THIS SHOULD NOT EXIST)
```

❌ **Wrong Token Transfer**:
```
Amount: 100 NOC instead of 0.25 NOC (SHOULD NOT APPEAR)
```

---

## 🔍 Verification on Solana Explorer

### Accessing Transaction

1. **Get TX ID** from app notification
2. **Open URL**:
   ```
   https://explorer.solana.com/tx/[TX_ID]?cluster=devnet
   ```
3. **Scroll to "Transfers" section**

### Verify Correct Transfers

**✅ SHOULD SEE**:
```
▼ Transfers
  ├─ Transfer (SPL Token)
  │  ├─ From: [Your Wallet]
  │  ├─ To: Vault
  │  └─ Amount: 0.1 SOL
  │
  └─ Transfer (SPL Token)
     ├─ From: [Your Wallet]
     ├─ To: Fee Collector
     └─ Amount: 0.25 NOC
```

**❌ SHOULD NOT SEE**:
```
- Third transfer (0.00025 SOL)
- Transfer to wrong address
- Wrong token amounts
```

---

## 💰 Fee Structure Breakdown

| Component | Amount | Token | Recipient |
|-----------|--------|-------|-----------|
| Deposit Amount | 0.1 | SOL | Vault |
| Privacy Fee | 0.25 | NOC | Fee Collector |
| On-chain Fee | 0 | — | — |
| **Total Cost** | **0.1 + 0.25** | **SOL + NOC** | **Vault + Fee Collector** |

---

## ✅ Success Criteria

### ✅ All Criteria Must Pass

1. **Transaction Succeeds**
   - [x] No error messages
   - [x] Status shows "Success"
   - [x] On blockchain

2. **Correct Transfers**
   - [x] Exactly 2 transfers
   - [x] 0.1 SOL to vault
   - [x] 0.25 NOC to fee collector
   - [x] No percentage fees

3. **Fee Correctness**
   - [x] Privacy fee: 0.25 NOC
   - [x] No additional SOL fees
   - [x] No WSOL transfers
   - [x] Fee goes to fee collector (your wallet)

4. **Shielded Balance Updates**
   - [x] Balance shows 0.1 SOL
   - [x] Persists on mode switch
   - [x] Can be used for transfers

---

## 🎯 Expected Console Output

```javascript
// After successful deposit
[performShieldedDeposit] DEPOSIT START: {
  tokenType: 'SOL',
  amountAtoms: '100000000',
  displayAmount: 0.1
}

[submitShieldedDeposit] Deposit submitted successfully: {
  signature: '[TX_HASH]',
  leafIndex: 0
}

✅ Deposit confirmed!
Shielded Balance: 0.1 SOL
```

---

## 🚨 If Something Goes Wrong

### Problem: 0.00025 SOL fee appears

**Cause**: On-chain program still has percentage fees enabled
**Solution**: Call `window.debugApi.setShieldFees()` to reset

### Problem: Balance shows 0.25 NOC instead of 0.1 SOL

**Cause**: Wrong token used (should be SOL)
**Solution**: Rebuild app - `npm run build`, then restart

### Problem: Fee goes to wrong address

**Cause**: Fee collector misconfigured
**Solution**: Verify with `window.debugApi.checkFeeCollector()`

### Problem: Transaction fails with "Bad Request"

**Cause**: Relayer/prover service issue
**Solution**: 
1. Check prover is running on localhost:8787
2. Verify relayer endpoint connectivity

---

## 📋 Test Result Template

When test completes, fill this in:

```
Deposit Test Results
====================

Date: [Test Date]
Amount: 0.1 SOL
Start Balance (SOL): [Your Balance]
Start Balance (NOC): [Your Balance]

Transaction Hash: [TX_ID]
Status: [Success/Failed]

Transfers Observed:
  Transfer 1: 0.1 SOL ✅/❌
  Transfer 2: 0.25 NOC ✅/❌
  Transfer 3: None ✅/❌

Final Shielded Balance: [Amount]
Fee Collector: [Address]

Issues: [None/List]
```

---

## 🎉 Expected Outcome

After successful deposit of 0.1 SOL:

```
Transparent Balance: 
  SOL: [Original - 0.1]
  NOC: [Original - 0.25]

Shielded Balance:
  SOL: 0.1 (in privacy pool)

Transaction Cost:
  Total: 0.1 SOL + 0.25 NOC
  Breakdown: 0.1 to vault, 0.25 fee
```

---

## 🔗 Related Links

- **Solana Devnet Explorer**: https://explorer.solana.com/?cluster=devnet
- **NOC Token Mint**: 2aFVaS8yZpfJCfp5zpmMyYbCpHcUJnbqmjhVHjxU2aYUb
- **Shield Program**: 3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz

---

**Ready to test!** 🚀
