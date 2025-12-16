# Fee Collector Address - Quick Reference

## Check Fee Collector Address

To see which address is collecting the 0.25 NOC shielded transaction fees:

### In Browser Console (F12)

```javascript
// Check the fee collector address
window.debugApi.checkFeeCollector()
  .then(result => {
    if (result.success) {
      console.log('✅ Fee Collector:', result.feeCollector);
      console.log('Explorer:', result.explorerUrl);
    } else {
      console.error('❌', result.error);
    }
  });
```

**Output Example:**
```
✅ Fee Collector: 7KVsdX...dkap7U
Explorer: https://explorer.solana.com/address/7KVsdX...dkap7U?cluster=devnet
```

## How Fees Are Collected

1. **User initiates shielded transaction** (deposit, transfer, or withdrawal)
   - Example: Deposit 0.1 SOL

2. **Client-side fee collection** (automatic)
   - 0.25 NOC transferred from user's NOC account
   - Transferred TO the fee collector address
   - Happens BEFORE on-chain deposit/transfer/withdrawal

3. **Fee collector address**
   - By default: **The program deployer's address**
   - Can be changed by program admin
   - All shielded transaction fees accumulate there

## Fee Structure

| Operation | Token | Amount | To |
|-----------|-------|--------|-----|
| Deposit SOL | NOC | 0.25 | Fee Collector |
| Transfer SOL | NOC | 0.25 | Fee Collector |
| Withdraw SOL | NOC | 0.25 | Fee Collector |
| Deposit NOC | NOC | 0.25 | Fee Collector |
| Transfer NOC | NOC | 0.25 | Fee Collector |
| Withdraw NOC | NOC | 0.25 | Fee Collector |

## Finding the Fee Collector

### Method 1: Browser Console
```javascript
window.debugApi.checkFeeCollector()
  .then(r => console.log(r.feeCollector));
```

### Method 2: Script
```bash
cd /Users/banel/Noctura-Wallet
npx ts-node scripts/checkFeeCollector.ts
```

### Method 3: View Recent Transactions
Search for 0.25 NOC transfers to see which address is the collector.

## Changing the Fee Collector

Only the program admin (deployer) can change the fee collector:

```javascript
// Call the on-chain set_fee_collector instruction
// This requires custom implementation (not yet in UI)
```

Currently, this would need to be done by:
1. Modifying the program to add a `set_fee_collector` instruction
2. Calling it from the admin wallet
3. Or re-initializing the program with a different fee collector address

## Fee Collection Pattern

Every shielded transaction creates this pattern:

```
Transaction:
  Transfer 1: User → Vault (amount in SOL/NOC)
  Transfer 2: User → Fee Collector (0.25 NOC)
```

Example for 0.1 SOL deposit:
```
Transfer 1: EeGrWG...TaQACF → Vault
  Amount: 0.1 SOL

Transfer 2: EeGrWG...TaQACF → 7KVsdX...dkap7U
  Amount: 0.25 NOC
```

## Total Cost

For any shielded transaction:
- **Deposit/Transfer/Withdraw 0.1 SOL** = 0.1 SOL + 0.25 NOC fee
- **Deposit/Transfer/Withdraw 0.05 NOC** = 0.05 NOC + 0.25 NOC fee

The 0.25 NOC fee is ALWAYS paid to the fee collector address.
