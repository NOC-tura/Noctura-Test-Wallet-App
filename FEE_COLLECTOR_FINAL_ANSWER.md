# Shielded Transaction Fee Collector - Definitive Answer

## ✅ THE FEE COLLECTOR IS: YOUR WALLET ADDRESS

### How It Works

When the shield program was initialized:
```typescript
// App.tsx line 597
await initProgram(keypair, keypair.publicKey);
//                                ↑↑↑↑↑↑↑↑↑↑
//                   This is your wallet's public key
```

**Result:** Your wallet's public key was set as the fee collector in the program's global state.

### Code Flow

1. **You initialize the program** (or someone with your keypair does)
   ```typescript
   keypair = useWallet state (your wallet)
   feeCollectorAddress = keypair.publicKey (your wallet's address)
   ```

2. **Program stores it**
   ```rust
   global.fee_collector = fee_collector;  // Your wallet address
   ```

3. **Every shielded transaction sends 0.25 NOC to your wallet**
   ```
   Transfer: User → Fee Collector (0.25 NOC)
   Fee Collector = Your Wallet
   ```

## What This Means

✅ **All 0.25 NOC shielded transaction fees go back to your wallet**
- Deposits: +0.25 NOC
- Transfers: +0.25 NOC  
- Withdrawals: +0.25 NOC
- Any user's shielded transaction: +0.25 NOC to you

## How to Verify

Get your wallet's public key:

```javascript
// In browser console (F12)
window.debugApi.checkFeeCollector()
  .then(r => {
    console.log('Fee Collector:', r.feeCollector);
    console.log('Your Wallet:', window.walletAddress); // if exposed
  });
```

Or check in the wallet UI - the fee collector is your connected wallet address.

## To See It In Action

1. **Make any shielded transaction**
2. **Get the transaction ID**
3. **Check on Solana Explorer**: `https://explorer.solana.com/tx/[TX_ID]?cluster=devnet`
4. **Look for the 0.25 NOC transfer**
5. **The recipient is your fee collector (your wallet)**

## Summary Table

| Item | Value |
|------|-------|
| **Fee per shielded transaction** | 0.25 NOC |
| **Who collects it** | Your wallet (fee collector) |
| **Where it goes** | Your NOC token account |
| **How often** | Every deposit, transfer, or withdrawal |
| **Can you change it** | Only if you're program admin (deployer) |

---

**Bottom Line:** Every time someone (including you) does a shielded transaction, your wallet receives 0.25 NOC. If you initialized the program, **you're the fee collector and you're earning fees!**
