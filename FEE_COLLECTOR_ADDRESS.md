# Fee Collector Address - Finding It

## The Fee Collector is:
**The wallet/keypair that initialized the shield program**

### Example from Code (App.tsx line 597):
```typescript
await initProgram(keypair, keypair.publicKey);
//                                 ↑↑↑↑↑↑↑↑↑
//                    This becomes the fee collector
```

## If You're the Program Deployer

Your wallet address IS the fee collector!

All 0.25 NOC shielded transaction fees go to **your wallet**.

## How to Find the Exact Address

### Option 1: Browser Console (Easiest)
```javascript
window.debugApi.checkFeeCollector()
  .then(r => {
    console.log('Fee Collector:', r.feeCollector);
    console.log('Solana Explorer:', r.explorerUrl);
  })
```

### Option 2: Check Transaction History
Look at any shielded transaction on Solana Explorer:
- You'll see two transfers
- The second one goes to the fee collector address
- That's the 0.25 NOC transfer

Example: In your last shielded deposit transaction
```
Transfer 1: Your Wallet → Vault (0.1 SOL)
Transfer 2: Your Wallet → [FEE COLLECTOR] (0.25 NOC)
            ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
            This address is the fee collector
```

## If You Need the Program Admin's Address

The fee collector was set during program initialization. If you need to change it, **only the program admin can do so**.

To change it, the admin would need to call the `set_fee_collector` instruction (requires program update to implement).

## Summary

| Question | Answer |
|----------|--------|
| Who gets the 0.25 NOC fees? | The fee collector address |
| Who is the fee collector? | The wallet that initialized the program |
| How to find it? | `window.debugApi.checkFeeCollector()` in browser |
| Can I change it? | Only if you're the program admin |
| Where does it go? | To the fee collector's NOC token account |

## Verification

To verify your fees are going to the right place:

1. **Make a shielded deposit** (0.1 SOL or 0.05 NOC)
2. **Get transaction ID** from app notification
3. **Go to Solana Explorer**: `https://explorer.solana.com/tx/[TX_ID]?cluster=devnet`
4. **Look for the 0.25 NOC transfer**
5. **The recipient is your fee collector**
