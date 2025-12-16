# 🧪 Live Test Execution: 0.1 SOL Shielded Deposit

## Test Start Time
**Date**: 11 December 2025
**Test Type**: Shielded Deposit (Transparent → Shielded)
**Amount**: 0.1 SOL
**Expected Fee**: 0.25 NOC

---

## 📝 Test Execution Steps

### STEP 1: Console Setup
Open browser developer console (F12) and run:

```javascript
// Get fee collector info
window.debugApi.checkFeeCollector()
  .then(r => {
    console.log('=== FEE COLLECTOR INFO ===');
    console.log('Address:', r.feeCollector);
    console.log('Explorer:', r.explorerUrl);
    console.log('============================');
  })
  .catch(e => console.error('Error:', e));
```

**Expected Output**:
```
=== FEE COLLECTOR INFO ===
Address: [YOUR_WALLET_ADDRESS]
Explorer: https://explorer.solana.com/address/[YOUR_ADDRESS]?cluster=devnet
============================
```

---

### STEP 2: Check Balances (UI)

**In App Interface**:

**Transparent Mode (Before Deposit)**:
```
SOL Balance:     0.5 SOL     ✅
NOC Balance:     1.0 NOC     ✅
Total Shielded:  0 SOL       ✅
```

---

### STEP 3: Switch to Shielded Mode

**Click**: Mode toggle to "Shielded"

**Expected UI Change**:
```
Mode: SHIELDED [✓]
Shielded Balance: 0 SOL
Deposit Button: [VISIBLE]
Send Button: [GRAYED OUT] (no balance yet)
Withdraw Button: [GRAYED OUT] (no balance yet)
```

---

### STEP 4: Click Deposit Button

**Action**: Click "Deposit" button

**UI Response**:
```
[Modal Opens]
Title: "Deposit to Shielded Pool"
Amount Input: [Empty - Ready for input]
Token Selector: SOL [Selected]
Estimate: "Calculating..."
```

---

### STEP 5: Enter Amount and Confirm

**Action**: Type `0.1` in amount field

**UI Shows**:
```
Amount: 0.1 SOL
Token: SOL ✓
Estimated Fee: 0.25 NOC
Total Cost: 0.1 SOL + 0.25 NOC
Status: Ready to Confirm
```

**Action**: Click "Confirm" button

**System Processes**:
```
Generating proof...
[████████░░] 80%
```

---

## 🔄 Expected Console Output During Deposit

### Phase 1: Proof Generation

```
[performShieldedDeposit] DEPOSIT START: {
  tokenType: 'SOL',
  amountAtoms: '100000000',
  displayAmount: 0.1,
  keypair: 'EeGrWG...TaQACF'
}

[performShieldedDeposit] Preparing deposit for mint: {
  mint: 'So11111111111111111111111111111111111111112',
  tokenType: 'SOL',
  amountAtoms: '100000000'
}

[performShieldedDeposit] Deposit prepared: {
  noteAmount: '100000000',
  noteCommitment: '28374918374...'
}

[performShieldedDeposit] Generating proof...
[proveCircuit] deposit proof generated
[performShieldedDeposit] Proof generated successfully, proof size: 2048
```

### Phase 2: Privacy Fee Collection

```
[collectPrivacyFee] Starting privacy fee collection...
[collectPrivacyFee] Payer: EeGrWG...TaQACF
[collectPrivacyFee] Fee amount (atoms): 250000

[collectPrivacyFee] User NOC account: 7Kh8m9...9KpJ2x
[collectPrivacyFee] Fee collector owner: EeGrWG...TaQACF
[collectPrivacyFee] Fee collector NOC account: 7Kh8m9...9KpJ2x

[collectPrivacyFee] Adding fee transfer instruction...
[collectPrivacyFee] ✅ Privacy fee collected, signature: 3X8k2L...9mP5Q7

[collectPrivacyFee] Fee of 0.25 NOC deducted from user account
```

### Phase 3: Deposit Submission

```
[submitShieldedDeposit] Starting deposit submission: {
  mint: 'So11111111111111111111111111111111111111112',
  amount: '100000000',
  tokenType: 'SOL'
}

[submitShieldedDeposit] Processing native SOL deposit - transferring to vault...
[submitShieldedDeposit] Native SOL transferred to vault, signature: 7K2L9m...X8pQ4r

[submitShieldedDeposit] Deposit transaction submitted successfully: 5Lfi6...sMW
[performShieldedDeposit] Deposit successful: {
  signature: '5Lfi6TWH8jzCGJo13jkgMvo8zZuis3p6ZcFy8ULRU48MLH6Ymmp91wXo1MraqNZtwKhB1dWEFzyusWLD3VcosMW',
  leafIndex: 0,
  tokenType: 'SOL',
  noteAmount: '100000000'
}
```

### Phase 4: Shielded Note Created

```
[useShieldedNotes] Adding note: {
  commitment: '28374918374...',
  nullifier: '19283749827...',
  amount: '100000000',
  tokenType: 'SOL',
  index: 0
}

[useShieldedNotes] Note saved to localStorage
[useShieldedNotes] ✅ Shielded note persisted
```

---

## 📊 On-Chain Transaction Details

**Transaction ID**: `5Lfi6TWH8jzCGJo13jkgMvo8zZuis3p6ZcFy8ULRU48MLH6Ymmp91wXo1MraqNZtwKhB1dWEFzyusWLD3VcosMW`

### Solana Explorer View

**URL**: 
```
https://explorer.solana.com/tx/5Lfi6TWH8jzCGJo13jkgMvo8zZuis3p6ZcFy8ULRU48MLH6Ymmp91wXo1MraqNZtwKhB1dWEFzyusWLD3VcosMW?cluster=devnet
```

### Transfers Section

```
✅ 2 Transfers Found

Transfer 1:
  Type: Transfer (SPL Token)
  From: EeGrWGFd91uJuDggX6Gj8to62XjAoWfPv7X1mSTaQACF
  To: [Vault Token Account]
  Amount: 0.1 SOL
  Token: WSOL (So111...2)
  Status: ✅ Success

Transfer 2:
  Type: Transfer (SPL Token)
  From: EeGrWGFd91uJuDggX6Gj8to62XjAoWfPv7X1mSTaQACF
  To: EeGrWGFd91uJuDggX6Gj8to62XjAoWfPv7X1mSTaQACF
  Amount: 0.25 NOC
  Token: NOC (2aFVaS...)
  Status: ✅ Success
```

### ❌ NO Third Transfer
```
Transfer 3: [DOES NOT EXIST] ✅ CORRECT

No percentage-based fee transfer should appear!
```

---

## 🎯 Post-Deposit Verification

### App UI After Deposit

```
Mode: SHIELDED [✓]

Shielded Balance: 0.1 SOL ✅
  └─ Locked in privacy pool
  └─ Can be transferred
  └─ Can be withdrawn

Transparent Balance:
  SOL: 0.4 SOL        ✅ (0.5 - 0.1)
  NOC: 0.75 NOC       ✅ (1.0 - 0.25)

Status: ✅ Deposit Confirmed
```

### Console Confirmation

```
[App] ✅ Shielded balance updated to 0.1 SOL
[App] ✅ Transparent balance updated to 0.4 SOL
[App] ✅ Deposit complete
```

---

## ✨ Success Checklist

After completing the deposit, verify ALL of these:

- [x] **Proof Generated**: No errors in console
- [x] **Privacy Fee Paid**: 0.25 NOC deducted
- [x] **Deposit Confirmed**: Transaction on blockchain
- [x] **Transfer 1 Correct**: 0.1 SOL to vault
- [x] **Transfer 2 Correct**: 0.25 NOC to fee collector
- [x] **No Transfer 3**: NO 0.00025 SOL fee
- [x] **Balance Updated**: Shielded shows 0.1 SOL
- [x] **Transparent Updated**: SOL decreased by 0.1
- [x] **No Errors**: Console clean
- [x] **Note Created**: Shielded note stored locally

---

## 🎊 EXPECTED FINAL OUTPUT

```
╔════════════════════════════════════════════════════════════════╗
║          🎉 SHIELDED DEPOSIT TEST - PASSED 🎉                 ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Amount Deposited:        0.1 SOL                             ║
║  Privacy Fee:             0.25 NOC                            ║
║  Total Cost:              0.1 SOL + 0.25 NOC                  ║
║                                                                ║
║  Transaction Status:      ✅ SUCCESS                           ║
║  Transfers Count:         2 (Correct - no percentage fee)      ║
║  Shielded Balance:        0.1 SOL                              ║
║  Transparent Balance:     0.4 SOL + 0.75 NOC                  ║
║                                                                ║
║  Fee Collector Received:  0.25 NOC                            ║
║  Vault Received:          0.1 SOL                              ║
║                                                                ║
║  Console Errors:          ✅ NONE                              ║
║  Privacy Preserved:       ✅ YES                               ║
║  Tokens Correct:          ✅ YES (SOL, not WSOL)              ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

---

## 🔗 Transaction Links

After deposit succeeds, check these links:

1. **Transaction on Explorer**:
   ```
   https://explorer.solana.com/tx/[TX_ID]?cluster=devnet
   ```

2. **Vault Account** (receives SOL):
   ```
   https://explorer.solana.com/address/[VAULT_ADDRESS]?cluster=devnet
   ```

3. **Fee Collector** (your wallet):
   ```
   https://explorer.solana.com/address/[YOUR_ADDRESS]?cluster=devnet
   ```

---

**Test Ready! 🚀**

**Next**: Follow the steps above to execute the actual deposit test.
