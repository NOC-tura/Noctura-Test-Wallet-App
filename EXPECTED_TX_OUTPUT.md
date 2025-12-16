# 📋 Expected Transaction Output - 0.1 SOL Shielded Deposit

## Transaction Template (What You'll See)

When you complete the 0.1 SOL deposit to shielded mode, here's what the transaction will show:

---

## 🔗 Solana Explorer View

**URL Format**:
```
https://explorer.solana.com/tx/[YOUR_TX_ID]?cluster=devnet
```

**Example TX ID** (what to expect):
```
5Lfi6TWH8jzCGJo13jkgMvo8zZuis3p6ZcFy8ULRU48MLH6Ymmp91wXo1MraqNZtwKhB1dWEFzyusWLD3VcosMW
```

---

## 📊 Transaction Details Section

```
Transaction Type: System Program + Token Program
Block: [Devnet block height]
Timestamp: [Current timestamp]
Status: ✅ Success
Finalized: MAX confirmations
Signer(s): [Your Wallet Address]
Fee: [SOL network fee]

Programs Invoked:
  1. System Program
  2. Token Program (spl-token)
  3. Shield Program (Custom)
```

---

## 💳 Transfers Section (Most Important)

**You should see EXACTLY 2 transfers**:

### Transfer 1: Deposit Amount
```
Action: Transfer (SPL Token)
From: [Your Wallet Address]
To: [Vault Token Account]
Token: WSOL (So11111111111111111111111111111111111111112)
Amount: 0.1 WSOL
Decimals: 9
Signature: [Part of main TX]
Status: ✅ Success
```

### Transfer 2: Privacy Fee
```
Action: Transfer (SPL Token)
From: [Your Wallet Address]
To: [Fee Collector - Your Wallet]
Token: NOC (2aFVaS8yZpfJCfp5zpmMyYbCpHcUJnbqmjhVHjxU2aYUb)
Amount: 0.25 NOC
Decimals: 6
Signature: [Part of main TX]
Status: ✅ Success
```

### ❌ Transfer 3: SHOULD NOT APPEAR
```
This would be the percentage fee (0.00025 SOL)
IF IT APPEARS, there's an issue with fee configuration
```

---

## 💰 Balance Changes

### Your Wallet
```
Before:
  SOL: 0.5 SOL
  NOC: 1.0 NOC

After:
  SOL: 0.4 SOL         ← Decreased by 0.1
  NOC: 0.75 NOC        ← Decreased by 0.25

Change: -0.1 SOL, -0.25 NOC
```

### Vault Account
```
Before: 0 SOL
After: 0.1 SOL
Change: +0.1 SOL
```

### Fee Collector (Your Wallet)
```
Before: [Previous balance]
After: [Previous + 0.25 NOC]
Change: +0.25 NOC
```

---

## 📝 Accounts Involved

```
Signer (Payer):
  EeGrWGFd91uJuDggX6Gj8to62XjAoWfPv7X1mSTaQACF
  [Your wallet]

Vault Authority:
  [Shield Program PDA]

Vault Token Account:
  [Vault for holding SOL]

Merkle Tree:
  [Shield Program Merkle Tree PDA]

Global State:
  [Shield Program Global State PDA]

Verifier Account:
  [Deposit Verifier Key]

Token Program:
  TokenkegQfeZyiNwAJsyFbPVwwQQfփkwQfin5qQ
```

---

## 🔍 Instructions Section

```
Instruction 1: System Program - Transfer
  ├─ From Pubkey: [Your Wallet]
  ├─ To Pubkey: [Vault PDA]
  └─ Lamports: 100000000 (0.1 SOL)

Instruction 2: spl-token - Transfer
  ├─ Source: [Your NOC Token Account]
  ├─ Destination: [Fee Collector NOC Account]
  ├─ Authority: [Your Wallet]
  ├─ Token: NOC
  └─ Amount: 250000 (0.25 NOC)

Instruction 3: Shield Program - TransparentDeposit
  ├─ Payer: [Your Wallet]
  ├─ Global State: [PDA]
  ├─ Merkle Tree: [PDA]
  ├─ Nullifier Set: [PDA]
  ├─ User Token Account: [Your Account]
  ├─ Vault Token Account: [Vault]
  ├─ Fee Collector Token Account: [Fee Collector]
  ├─ Data: {
  │    ├─ commitment: [32-byte ZK proof commitment]
  │    ├─ nullifier: [32-byte nullifier]
  │    ├─ amount: 100000000
  │    ├─ proof: [2048 bytes Groth16 proof]
  │    └─ publicInputs: [ZK proof public inputs]
  │  }
  └─ Status: ✅ Success
```

---

## ✅ Verification Checklist

When you see the transaction, verify:

- [x] Status shows "Success"
- [x] "Finalized (MAX confirmations)"
- [x] Signer is your wallet
- [x] 2 transfers in "Transfers" section
- [x] Transfer 1: 0.1 to vault
- [x] Transfer 2: 0.25 NOC to fee collector
- [x] No Transfer 3 (no percentage fee)
- [x] "Solana Shield Program" called
- [x] No error messages
- [x] All accounts are valid (no "Unknown Program")

---

## 📱 In-App Confirmation

**You should also see in the app**:

```
Console Logs:
  ✅ [performShieldedDeposit] DEPOSIT START
  ✅ [collectPrivacyFee] Privacy fee collected
  ✅ [submitShieldedDeposit] Deposit submitted successfully
  ✅ Signature: 5Lfi6TWH...

App Notification:
  ✅ "Deposit successful!"
  ✅ Shows transaction ID
  ✅ Link to explorer

Shielded Balance:
  ✅ Shows 0.1 SOL

Transparent Balance:
  ✅ SOL decreased by 0.1
  ✅ NOC decreased by 0.25
```

---

## 🚀 How to Get Your Transaction

### Step 1: Perform Deposit
1. Open http://localhost:5173/
2. Switch to Shielded Mode
3. Click Deposit
4. Enter 0.1 SOL
5. Click Confirm

### Step 2: Get TX ID
- Watch for success notification in app
- Or check browser console for signature
- Look for: `Signature: [TX_ID]`

### Step 3: Share TX ID
- Copy the transaction ID
- Share it with me
- I'll analyze the actual transaction

### Step 4: View on Explorer
```
https://explorer.solana.com/tx/[YOUR_TX_ID]?cluster=devnet
```

---

## 📋 Template for Sharing TX Results

When you get the transaction, share:

```
Transaction Details
===================

TX ID: [Copy from app]
Date: [When executed]
Amount: 0.1 SOL

Expected vs Actual:
  Expected Transfers: 2
  Actual Transfers: [Number]
  
  Expected Fee: 0.25 NOC
  Actual Fee: [Amount]
  
  Expected Payout: 0.1 SOL to vault
  Actual Payout: [Amount]

Issues: [None / List any problems]

Console Logs: [Paste relevant logs]

Verified On-Chain: [Yes/No]
```

---

**Ready to test! Go deposit 0.1 SOL and share the TX ID with me!** 🚀
