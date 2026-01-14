# 🔐 Uploading Verifier Keys - Step-by-Step Guide

## ✅ Status Check
- ✅ App is running at http://localhost:5173/
- ✅ All 4 verifier key files are in `/app/public/`:
  - `deposit.vkey.json`
  - `withdraw.vkey.json`
  - `transfer.vkey.json`
  - `transfer-multi.vkey.json`

## 📋 Instructions

### Step 1: Open the App in Browser
Navigate to: **http://localhost:5173/**

### Step 2: Open Developer Console
Press **F12** (or Cmd+Option+I on Mac) to open DevTools, then click the **Console** tab

### Step 3: Make Sure Wallet is Connected
- You should see your SOL/NOC balance displayed in the app
- If not, click "Connect" and select your wallet

### Step 4: Upload Verifiers
Copy and paste this command into the console:

```javascript
await __noctura_debug.uploadVerifiers()
```

Then press **Enter**

### Step 5: Watch the Console Output
You should see:
```
[UploadVerifiers] === UPLOADING VERIFIER KEYS ===
[UploadVerifiers] Loading verifier keys from public directory...
[UploadVerifiers] transfer-multi vkey loaded (for multi-note circuit), not yet uploaded on-chain.
[UploadVerifiers] Verifier keys loaded, uploading to program...
[UploadVerifiers] ✅ All verifiers uploaded successfully!
[UploadVerifiers] Deposit signature: 3j5K9...
[UploadVerifiers] Withdraw signature: 5mK2L...
[UploadVerifiers] Transfer signature: 7pN4Q...
```

### Step 6: Wait for Confirmation (~15-20 seconds)
The function will:
1. Create 3 transactions (withdraw, transfer, and optionally deposit if needed)
2. Send them to the network
3. Wait for confirmations

## ✅ What Gets Uploaded

| Verifier | Function | Status |
|----------|----------|--------|
| **Deposit** | transparent → shielded | May already be done ✅ |
| **Withdraw** | shielded → transparent | Will be uploaded |
| **Transfer** | shielded → shielded | Will be uploaded |
| **Transfer-Multi** | multi-note transfers | Loaded but not uploaded to chain yet |

## 🎉 After Upload

Once complete, you'll have **100% full privacy functionality**:

- ✅ **Deposits** - Shield your SOL/NOC (transparent → shielded)
- ✅ **Transfers** - Send privately to other addresses (shielded → shielded)
- ✅ **Withdrawals** - Exit privacy and receive tokens (shielded → transparent)

## 🔍 Verify It Worked

After upload, try:
```javascript
// Check balance in shielded mode
await __noctura_debug.getBalance()
```

Or go to [Solana Explorer](https://explorer.solana.com/?cluster=devnet) and search for the transaction signatures to confirm they're on-chain.

## ⚠️ Troubleshooting

### "No keypair available"
- Make sure your wallet is connected in the app
- The transaction signer must be the program admin (deployer)

### "Failed to fetch verifier keys"
- Verify the `.vkey.json` files exist in `/app/public/`
- Check browser console for 404 errors
- Reload the page and try again

### "Verifier already set" error
- The verifier may already be uploaded from a previous run
- This is fine! You can try again or check with:
  ```javascript
  // Check current verifiers
  await __noctura_debug.checkVerifiers()
  ```

### Transaction timeout
- Wait a few seconds and try again
- Check [Solana Status](https://status.solana.com/) for network issues

## 📱 Ready to Test Shielded Transactions

Once verifiers are uploaded:

1. **Test Deposit:**
   - Switch to "Shield Funds" tab
   - Deposit 0.1 SOL
   - Should appear in shielded balance

2. **Test Transfer:**
   - Switch to "Shielded Transfer" tab
   - Send to another address
   - Recipient receives SOL privately

3. **Test Withdrawal:**
   - Switch to "Withdraw" tab
   - Withdraw to transparent wallet
   - Receive tokens unshielded

---

**Questions?** Check the console output or see [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
