# Shielded-to-Shielded Transfer Fix Summary

## Issue
NOC shielded-to-shielded transfers were failing - funds would leave the sender's vault but never arrive at the recipient's wallet. SOL transfers worked correctly.

## Root Cause
The **tokenMint field** in the compact format deserializer was returning incorrect values for NOC tokens.

In `app/src/lib/ecdhEncryption.ts`, the `deserializeNotePayloadCompact()` function was returning:
- SOL: `tokenMint: '1'` ✅ Correct
- NOC: `tokenMint: '2'` ❌ Wrong!

The correct NOC token mint field value is:
```
'10573237895933377819207813447621407372083533411926671627115170254672242817572'
```

When notes were deserialized with `tokenMint: '2'`, the `isNoteCorrupted()` validation function would mark them as corrupted because they didn't match the expected NOC token mint constant.

## Fix Applied

### File: `app/src/lib/ecdhEncryption.ts` (lines ~153-155)

**Before (Buggy):**
```typescript
const tokenMint = tokenType === 'SOL' ? '1' : '2'; // Simple encoding
```

**After (Fixed):**
```typescript
const EXPECTED_NOC_TOKEN_MINT_FIELD = '10573237895933377819207813447621407372083533411926671627115170254672242817572';
const tokenMint = tokenType === 'SOL' ? '1' : EXPECTED_NOC_TOKEN_MINT_FIELD;
```

## How the System Works

### Shielded Transfer Flow
1. **Sender** generates a new note for the recipient with their commitment
2. **Sender** encrypts the note payload using ECDH (recipient's public key + sender's ephemeral key)
3. **Transfer transaction** is submitted to chain with output commitments
4. **Encrypted memo** is sent in a separate transaction with `noctura:` prefix
5. **Recipient's wallet scanner** finds transactions, extracts memos
6. **Scanner** attempts to decrypt memos using recipient's view key
7. **Successful decryption** reveals the note details (amount, secret, blinding, etc.)
8. **Note is added** to recipient's shielded balance

### Why the Bug Caused Failure
- Step 6 succeeded (decryption worked)
- But the deserialized note had `tokenMint: '2'`
- The validation at step 7 failed because '2' ≠ expected NOC mint
- Note was marked as corrupted and filtered out
- Recipient never received the funds

## Related Systems

### Privacy Fee (0.25 NOC)
- Automatically charged on shielded transfers when available
- Requires an **exact 0.25 NOC note** in the sender's wallet
- Fee notes are auto-created after NOC deposits via `ensureFeeNotes(4)`
- If no exact fee note exists, transfer proceeds without fee

### ECDH Encryption
- Uses secp256k1 ECDH key exchange
- ChaCha20-Poly1305 authenticated encryption
- Compact binary format: 162 bytes total

### Token Type Encoding
| Token | Type Byte | tokenMint Field |
|-------|-----------|-----------------|
| SOL   | 0x01      | `'1'` |
| NOC   | 0x02      | `'10573237895933377819...'` (full 77-char string) |

## Debug API Functions
The following debug functions are available in the browser console via `window.debugApi`:

- `verifyKeyPair()` - Verify ECDH key pair validity
- `testSelfEncrypt()` - Test encryption/decryption to self
- `testAddressDecryption(address)` - Test encryption to a specific address
- `tryDecrypt(encryptedNoteString)` - Decrypt an encrypted note string
- `getLastSentMemo()` - Get details of the last sent memo
- `extractLastMemo()` - Extract memo from last transfer transaction
- `extractMemoData(signature)` - Extract memo data from any transaction

## Verification
After applying the fix:
- ✅ SOL shielded-to-shielded transfers work
- ✅ NOC shielded-to-shielded transfers work
- ✅ Recipient wallet scanner discovers incoming notes
- ✅ Notes are correctly validated and added to balance

## Files Modified
1. `app/src/lib/ecdhEncryption.ts` - Fixed tokenMint deserialization
2. `app/src/lib/walletScanner.ts` - Cleaned up debug logging
3. `app/src/App.tsx` - Added debug API, cleaned up transfer logging

---
*Fix applied: January 2025*
