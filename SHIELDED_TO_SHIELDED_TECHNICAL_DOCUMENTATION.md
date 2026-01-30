# Noctura Wallet: Shielded-to-Shielded Transaction Technical Documentation

## Comprehensive Technical Explanation of Private-to-Private Transfers

**Document Version:** 1.0  
**Date:** January 28, 2026  
**Scope:** Full technical breakdown of shielded-to-shielded (private-to-private) transaction flow in the Noctura Wallet

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Cryptographic Primitives](#2-cryptographic-primitives)
3. [Key Architecture](#3-key-architecture)
4. [Note Structure & Commitment Scheme](#4-note-structure--commitment-scheme)
5. [The UTXO-Like Model](#5-the-utxo-like-model)
6. [Transfer Circuit (ZK-SNARK)](#6-transfer-circuit-zk-snark)
7. [Complete Transaction Flow](#7-complete-transaction-flow)
8. [Relayer System](#8-relayer-system)
9. [Encrypted Note Discovery](#9-encrypted-note-discovery)
10. [On-Chain Program Logic](#10-on-chain-program-logic)
11. [Privacy Guarantees](#11-privacy-guarantees)
12. [Code Reference Map](#12-code-reference-map)

---

## 1. Executive Summary

Shielded-to-shielded transactions in Noctura Wallet enable fully private token transfers where:

- **Sender identity is hidden**: The on-chain transaction reveals no link to the sender's wallet
- **Recipient identity is hidden**: The recipient's address is never exposed on-chain
- **Amount is hidden**: The transferred value is encrypted and never appears in plaintext
- **Transaction graph is broken**: Observers cannot link inputs to outputs

This is achieved through:
- **Zero-Knowledge Proofs (Groth16)**: Prove validity without revealing secrets
- **Poseidon Hash Commitments**: Hide note contents cryptographically
- **Nullifier System**: Prevent double-spending without revealing which note was spent
- **ECDH Encryption**: Securely share note secrets with recipients
- **Relayer Infrastructure**: Break transaction origin linkability

---

## 2. Cryptographic Primitives

### 2.1 Poseidon Hash Function

Noctura uses the Poseidon hash function, which is optimized for ZK-SNARK circuits (arithmetic over the BN254 elliptic curve scalar field).

**Field Modulus:**
```
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
```

**Properties:**
- Operates natively on field elements (no bit decomposition needed)
- ~8x more efficient in circuits than SHA-256 or Keccak
- Collision-resistant and preimage-resistant

**Usage in Noctura:**
```
commitment = Poseidon(secret, amount, tokenMint, blinding)
nullifier = Poseidon(secret, rho)
merkleHash = Poseidon(left, right)
```

### 2.2 Groth16 Zero-Knowledge Proofs

**System Parameters:**
- Curve: BN254 (also known as alt_bn128)
- Proof Size: 192 bytes (constant regardless of circuit complexity)
- Verification: ~3ms on modern hardware

**Proof Structure:**
- **π_A**: G1 point (64 bytes)
- **π_B**: G2 point (128 bytes)  
- **π_C**: G1 point (64 bytes)

### 2.3 ECDH Key Agreement

For encrypted note sharing:
- **Curve**: secp256k1
- **Key Derivation**: HKDF-SHA256
- **Encryption**: ChaCha20-Poly1305 authenticated encryption

---

## 3. Key Architecture

Each Noctura user derives a complete key hierarchy from their Solana wallet:

### 3.1 Key Derivation Tree

```
Master Seed (Solana Secret Key [0:32])
    │
    ├── Spend Key (sk_spend)
    │   └── Info: "noctura/spend/v1"
    │   └── Purpose: Authorize spending of notes
    │
    ├── View Key (sk_view)
    │   └── Info: "noctura/view/v1"
    │   └── Purpose: Decrypt incoming notes
    │
    ├── Nullifier Key (sk_nullifier)
    │   └── Info: "noctura/nullifier/v1"
    │   └── Purpose: Compute nullifiers (separate for security)
    │
    └── ECDH Keypair
        └── Info: "noctura/shielded/v1"
        └── Purpose: Receive encrypted note data
        └── Public Key → Shielded Address (noctura1...)
```

### 3.2 Shielded Address Format

```
Format: noctura1<hex-encoded-compressed-secp256k1-pubkey>
Example: noctura102f4b3c7d8e9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6
Length: 8 (prefix) + 66 (33 bytes × 2 hex chars) = 74 characters
```

### 3.3 Key Derivation Code

```typescript
export function deriveShieldedKeys(solanaKeypair: Keypair): ShieldedKeyPair {
  const masterSeed = solanaKeypair.secretKey.slice(0, 32);
  
  // Derive keys using HKDF
  const spendKey = hkdf(sha256, masterSeed, undefined, 'noctura/spend/v1', 32);
  const viewKey = hkdf(sha256, masterSeed, undefined, 'noctura/view/v1', 32);
  const nullifierKey = hkdf(sha256, masterSeed, undefined, 'noctura/nullifier/v1', 32);
  const ecdhSeed = hkdf(sha256, masterSeed, undefined, 'noctura/shielded/v1', 32);
  
  const shieldedPublicKey = secp256k1.getPublicKey(ecdhSeed, true); // compressed
  
  return {
    spendKey,
    viewKey,
    nullifierKey,
    shieldedPublicKey,
    shieldedAddress: 'noctura1' + bytesToHex(shieldedPublicKey),
    viewKeyPrivate: ecdhSeed,
  };
}
```

---

## 4. Note Structure & Commitment Scheme

### 4.1 Note Definition

A shielded note represents an unspent balance:

```typescript
type Note = {
  secret: bigint;      // Random 256-bit value (kept private)
  amount: bigint;      // Token amount in atomic units
  tokenMint: bigint;   // Token identifier (1n for SOL, hash of mint for NOC)
  blinding: bigint;    // Random blinding factor
  rho: bigint;         // Randomness for nullifier derivation
  commitment: bigint;  // Poseidon(secret, amount, tokenMint, blinding)
  nullifier: bigint;   // Poseidon(secret, rho)
};
```

### 4.2 Commitment Computation

The commitment hides the note contents while allowing verification:

```
commitment = Poseidon(secret, amount, tokenMint, blinding)
```

**Security Properties:**
- **Hiding**: Without `secret` and `blinding`, the `amount` cannot be determined
- **Binding**: Cannot create two different notes with the same commitment
- **Collision Resistant**: Finding two inputs with same output is computationally infeasible

### 4.3 Nullifier Computation

The nullifier prevents double-spending:

```
nullifier = Poseidon(secret, rho)
```

**Key Insight**: 
- The nullifier is deterministic given the note secrets
- Once published, the note is marked as spent
- The nullifier reveals NOTHING about which commitment it corresponds to

### 4.4 Note Creation Code

```typescript
export function createNote(params: {
  secret: bigint;
  amount: bigint;
  tokenMint: bigint;
  blinding: bigint;
  rho: bigint;
}): Note {
  const commitment = poseidonHash([
    params.secret, 
    params.amount, 
    params.tokenMint, 
    params.blinding
  ]);
  const nullifier = poseidonHash([params.secret, params.rho]);
  return { ...params, commitment, nullifier };
}
```

---

## 5. The UTXO-Like Model

### 5.1 State Model

Noctura uses a UTXO-like model (similar to Bitcoin/Zcash) rather than an account model:

```
Global State:
├── Merkle Tree (stores all commitments)
│   └── Height: 20 levels
│   └── Capacity: 2^20 = 1,048,576 notes
│
└── Nullifier Set (stores spent nullifiers)
    └── Linear array of 32-byte nullifier hashes
```

### 5.2 Spending Notes

To spend a note, the user must:

1. **Prove ownership**: Demonstrate knowledge of the note's secret
2. **Prove existence**: Show the commitment exists in the Merkle tree
3. **Reveal nullifier**: Publish the nullifier (marks note as spent)
4. **Create new notes**: Generate new commitments for recipient and change

### 5.3 Merkle Tree Structure

```
                    Root
                   /    \
                  /      \
               H(0,1)   H(2,3)
               /   \    /   \
             H0    H1  H2   H3
             |     |   |    |
            C0    C1  C2   C3  ← Leaf commitments
```

**Merkle Proof**: To prove C1 is in the tree:
```
path = [H0, H(2,3)]  // sibling nodes
indices = [1, 0]      // position at each level (left=0, right=1)
```

---

## 6. Transfer Circuit (ZK-SNARK)

### 6.1 Circuit Purpose

The transfer circuit proves:
1. The sender owns a valid unspent note
2. The note exists in the Merkle tree
3. The nullifier is correctly computed
4. The amounts balance (input = output1 + output2)
5. New commitments are correctly formed

**WITHOUT REVEALING:**
- Which note is being spent
- The amounts involved
- Who the recipient is

### 6.2 Circuit Inputs

```circom
template ShieldedTransfer() {
    var TREE_HEIGHT = 20;
    
    // PRIVATE INPUTS (known only to prover)
    signal input inSecret;          // Note secret
    signal input inAmount;          // Note amount
    signal input tokenMint;         // Token identifier
    signal input blinding;          // Blinding factor
    signal input rho;               // Nullifier randomness
    signal input pathElements[20];  // Merkle proof siblings
    signal input pathIndices[20];   // Merkle proof positions
    
    signal input outSecret1;        // Recipient note secret
    signal input outAmount1;        // Recipient amount
    signal input outBlinding1;      // Recipient blinding
    
    signal input outSecret2;        // Change note secret
    signal input outAmount2;        // Change amount
    signal input outBlinding2;      // Change blinding
    
    // PUBLIC INPUTS (visible to verifier)
    signal input merkleRoot;        // Current tree root
    signal input nullifier;         // Note being spent
    
    // PUBLIC OUTPUTS
    signal output outCommitment1;   // Recipient commitment
    signal output outCommitment2;   // Change commitment
}
```

### 6.3 Circuit Constraints

#### Constraint 1: Input Note Exists in Tree

```circom
// Compute input note commitment
component noteHash = Poseidon(4);
noteHash.inputs[0] <== inSecret;
noteHash.inputs[1] <== inAmount;
noteHash.inputs[2] <== tokenMint;
noteHash.inputs[3] <== blinding;

// Verify Merkle inclusion
component treeCheck = MerkleTreeInclusionProof(20);
treeCheck.leaf <== noteHash.out;
for (var i = 0; i < 20; i++) {
    treeCheck.pathElements[i] <== pathElements[i];
    treeCheck.pathIndex[i] <== pathIndices[i];
}
treeCheck.root === merkleRoot;  // Must match public root
```

#### Constraint 2: Nullifier Correctly Derived

```circom
component nullifierHash = Poseidon(2);
nullifierHash.inputs[0] <== inSecret;
nullifierHash.inputs[1] <== rho;
nullifier === nullifierHash.out;  // Must match public nullifier
```

#### Constraint 3: Amounts Balance (No Inflation)

```circom
inAmount === outAmount1 + outAmount2;
```

#### Constraint 4: Output Commitments

```circom
// Recipient note commitment
component outNoteHash1 = Poseidon(4);
outNoteHash1.inputs[0] <== outSecret1;
outNoteHash1.inputs[1] <== outAmount1;
outNoteHash1.inputs[2] <== tokenMint;  // Same token type
outNoteHash1.inputs[3] <== outBlinding1;
outCommitment1 <== outNoteHash1.out;

// Change note commitment
component outNoteHash2 = Poseidon(4);
outNoteHash2.inputs[0] <== outSecret2;
outNoteHash2.inputs[1] <== outAmount2;
outNoteHash2.inputs[2] <== tokenMint;
outNoteHash2.inputs[3] <== outBlinding2;
outCommitment2 <== outNoteHash2.out;
```

### 6.4 Public vs Private Signals

| Signal | Visibility | Purpose |
|--------|------------|---------|
| `merkleRoot` | PUBLIC | Anchor proof to on-chain state |
| `nullifier` | PUBLIC | Prevent double-spend |
| `outCommitment1` | PUBLIC | Add to tree (recipient) |
| `outCommitment2` | PUBLIC | Add to tree (change) |
| `inSecret`, `inAmount`, `blinding`, `rho` | PRIVATE | Note ownership |
| `pathElements`, `pathIndices` | PRIVATE | Which leaf (anonymity set) |
| `outSecret1/2`, `outAmount1/2`, `outBlinding1/2` | PRIVATE | New note details |

---

## 7. Complete Transaction Flow

### 7.1 High-Level Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SHIELDED-TO-SHIELDED TRANSFER                       │
└─────────────────────────────────────────────────────────────────────────┘

SENDER'S DEVICE                          RELAYER                    SOLANA CHAIN
     │                                      │                            │
     │ 1. Select input note                 │                            │
     │ 2. Decode recipient pubkey           │                            │
     │ 3. Create recipient note             │                            │
     │ 4. Create change note                │                            │
     │ 5. Build Merkle proof                │                            │
     │ 6. Generate ZK proof                 │                            │
     │ 7. Encrypt note for recipient        │                            │
     │                                      │                            │
     │───── Send proof + commitments ──────>│                            │
     │                                      │                            │
     │                                      │ 8. Validate proof format   │
     │                                      │ 9. Sign transaction        │
     │                                      │                            │
     │                                      │───── Submit tx ───────────>│
     │                                      │                            │
     │                                      │                            │ 10. Verify ZK proof
     │                                      │                            │ 11. Check nullifier
     │                                      │                            │ 12. Mark nullifier spent
     │                                      │                            │ 13. Append commitments
     │                                      │                            │
     │                                      │<──── Confirmation ─────────│
     │                                      │                            │
     │                                      │ 14. Send encrypted memo    │
     │                                      │                            │
     │<───────── Success + signature ───────│                            │
     │                                      │                            │
     │ 15. Mark input note spent            │                            │
     │ 16. Save change note locally         │                            │
     │                                      │                            │
     ▼                                      ▼                            ▼

RECIPIENT'S DEVICE
     │
     │ 17. Scanner detects memo transaction
     │ 18. Attempt decryption with view key
     │ 19. If successful, import note
     │
     ▼
```

### 7.2 Detailed Step-by-Step

#### Step 1: Validate Recipient Address

```typescript
const isShieldedRecipient = trimmedRecipient.startsWith('noctura1');
if (isShieldedRecipient) {
  const recipientPublicKey = decodeShieldedAddress(trimmedRecipient);
  // Verify it's a valid compressed secp256k1 pubkey
  if (recipientPublicKey.length !== 33 || 
      (recipientPublicKey[0] !== 0x02 && recipientPublicKey[0] !== 0x03)) {
    throw new Error('Invalid recipient public key');
  }
}
```

#### Step 2: Select Input Note

```typescript
// Filter for unspent notes of correct token type
const availableNotes = shieldedNotes.filter((note) => {
  if (note.spent || note.owner !== walletAddress) return false;
  if (tokenType === 'SOL') return note.tokenType === 'SOL';
  return note.tokenType === 'NOC' || !note.tokenType;
});

// Find note with sufficient balance
const sortedNotes = [...availableNotes].sort((a, b) => 
  Number(BigInt(b.amount) - BigInt(a.amount))
);
const spendNote = sortedNotes.find(n => BigInt(n.amount) >= atoms) || sortedNotes[0];
```

#### Step 3: Build Merkle Proof

```typescript
const merkleProof = buildMerkleProof(availableNotes, spendNote);
// Returns: { root, pathElements, pathIndices }
```

#### Step 4: Create Output Notes

```typescript
// Recipient note (with transfer amount)
const recipientNote = createNoteFromSecrets(atoms, tokenType);

// Change note (remainder)
const changeAmount = noteAmount - atoms;
const changeNote = createNoteFromSecrets(changeAmount, tokenType);
```

#### Step 5: Serialize Witness

```typescript
const transferWitness = serializeTransferWitness({
  inputNote: {
    secret: BigInt(spendNote.secret),
    amount: noteAmount,
    tokenMint: getCorrectTokenMint(spendNote),
    blinding: BigInt(spendNote.blinding),
    rho: BigInt(spendNote.rho),
  },
  merkleProof,
  outputNote1: recipientNote,
  outputNote2: changeNote,
});
```

#### Step 6: Generate ZK Proof

```typescript
const proof = await proveCircuit('transfer', transferWitness);
// Returns: { proofBytes, publicInputs, proverMs }
```

#### Step 7: Encrypt Note for Recipient

```typescript
const notePayload: NotePayload = {
  amount: recipientNote.amount.toString(),
  tokenMint: recipientNote.tokenMint.toString(),
  secret: recipientNote.secret.toString(),
  blinding: recipientNote.blinding.toString(),
  rho: recipientNote.rho.toString(),
  commitment: recipientNote.commitment.toString(),
  tokenType,
};

const encryptedNote = encryptNoteToRecipient(recipientPublicKey, notePayload);
```

#### Step 8: Submit via Relayer

```typescript
const result = await relayTransfer({
  proof,
  nullifier: spendNote.nullifier,
  outputCommitment1: recipientNote.commitment.toString(),
  outputCommitment2: changeNote.commitment.toString(),
  encryptedNote: serializeEncryptedNote(encryptedNote),
});
```

#### Step 9: Update Local State

```typescript
// Mark input as spent
markNoteSpent(spendNote.nullifier);

// Save change note
const changeRecord = snapshotNote(changeNote, keypair.publicKey, tokenType);
addShieldedNote(changeRecord);
```

---

## 8. Relayer System

### 8.1 Why a Relayer?

Without a relayer, the sender's Solana address would appear as the transaction signer, breaking sender privacy. The relayer:

1. **Hides sender identity**: Signs transactions on behalf of users
2. **Pays gas fees**: Users don't need SOL in transparent wallet
3. **Cannot steal funds**: Has no access to note secrets

### 8.2 Relayer API

```typescript
// POST /relay/transfer
{
  proof: {
    proofBytes: string,      // Base64 encoded Groth16 proof
    publicInputs: string[],  // Base64 encoded field elements
  },
  nullifier: string,         // Nullifier being consumed
  outputCommitment1: string, // Recipient commitment
  outputCommitment2: string, // Change commitment
  encryptedNote?: string,    // Optional encrypted note for recipient
}

// Response
{
  signature: string,         // Solana transaction signature
}
```

### 8.3 Relayer Transaction Building

```typescript
// Build shielded transfer instruction
const transferIx = await program.methods
  .shieldedTransfer(
    [nullifierBytes],                    // Nullifiers being spent
    [commitment1Bytes, commitment2Bytes], // New commitments
    Buffer.from(proofBytes),              // ZK proof
    publicInputs                          // Public circuit inputs
  )
  .accounts({
    merkleTree: pdas.merkleTree,
    nullifierSet: pdas.nullifierSet,
    transferVerifier: pdas.transferVerifier,
  })
  .instruction();

// Add compute budget (ZK verification is expensive)
const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 400_000,  // Default is 200K, ZK proofs need more
});

// Sign with relayer key
const tx = new Transaction().add(computeBudgetIx).add(transferIx);
tx.sign(relayerKeypair);
```

### 8.4 Encrypted Memo Transmission

```typescript
// If memo fits in transaction (< 1232 bytes total)
if (encryptedNote && estimatedSize <= MAX_TX_SIZE) {
  const memoIx = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(`noctura:${encryptedNote}`, 'utf-8'),
  });
  tx.add(memoIx);
}

// If too large, send in separate transaction
else {
  await sendEncryptedMemo(encryptedNote, transferSignature);
}
```

---

## 9. Encrypted Note Discovery

### 9.1 ECDH Encryption Scheme

```typescript
export function encryptNoteToRecipient(
  recipientPubkey: Uint8Array,    // Recipient's secp256k1 pubkey
  notePayload: NotePayload
): EncryptedNotePayload {
  // Generate ephemeral keypair
  const ephemeralPrivate = randomBytes(32);
  const ephemeralPublic = secp256k1.getPublicKey(ephemeralPrivate, true);
  
  // ECDH: shared = ephemeralPrivate * recipientPubkey
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivate, recipientPubkey);
  
  // KDF: derive encryption key
  const encKey = hkdf(sha256, sharedPoint, undefined, 'noctura/encrypt/v1', 32);
  
  // Serialize payload (compact binary format)
  const plaintext = serializeNotePayloadCompact(notePayload);
  
  // Encrypt with ChaCha20-Poly1305
  const nonce = randomBytes(12);
  const cipher = chacha20poly1305(encKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  
  return {
    ephemeralPubkey: bytesToHex(ephemeralPublic),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
}
```

### 9.2 Note Decryption

```typescript
export function decryptNoteWithViewKey(
  encryptedPayload: EncryptedNotePayload,
  viewKeyPrivate: Uint8Array
): NotePayload | null {
  try {
    const ephemeralPub = hexToBytes(encryptedPayload.ephemeralPubkey);
    
    // ECDH: shared = viewKeyPrivate * ephemeralPubkey
    const sharedPoint = secp256k1.getSharedSecret(viewKeyPrivate, ephemeralPub);
    
    // KDF: derive decryption key
    const decKey = hkdf(sha256, sharedPoint, undefined, 'noctura/encrypt/v1', 32);
    
    // Decrypt
    const nonce = hexToBytes(encryptedPayload.nonce);
    const ciphertext = hexToBytes(encryptedPayload.ciphertext);
    const cipher = chacha20poly1305(decKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    
    // Deserialize
    return deserializeNotePayloadCompact(plaintext);
  } catch {
    return null;  // Decryption failed = not for this recipient
  }
}
```

### 9.3 Background Scanner

```typescript
export async function scanForIncomingNotes(keypair: Keypair): Promise<ScanResult> {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const ecdhPrivateKey = getECDHPrivateKey(keypair);
  
  // Scan relayer transactions for memos
  const signatures = await connection.getSignaturesForAddress(RELAYER_FEE_PAYER);
  
  for (const sigInfo of signatures) {
    const tx = await connection.getTransaction(sigInfo.signature);
    
    // Extract encrypted notes from memo instructions
    const encryptedNotes = extractEncryptedNotesFromTx(tx);
    
    for (const { encryptedData } of encryptedNotes) {
      // Attempt decryption
      const encrypted = deserializeEncryptedNote(encryptedData);
      const decrypted = decryptNoteWithViewKey(encrypted, ecdhPrivateKey);
      
      if (decrypted) {
        // This note is for us!
        onNewNoteCallback({
          notePayload: decrypted,
          signature: sigInfo.signature,
          slot: sigInfo.slot,
        });
      }
    }
  }
}
```

---

## 10. On-Chain Program Logic

### 10.1 Program ID

```
3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz
```

### 10.2 Shielded Transfer Instruction

```rust
pub fn shielded_transfer(
    ctx: Context<ShieldedTransfer>,
    input_nullifiers: Vec<[u8; 32]>,
    output_commitments: Vec<[u8; 32]>,
    proof: Vec<u8>,
    public_inputs: Vec<[u8; 32]>,
) -> Result<()> {
    // 1. Validate inputs
    require!(!input_nullifiers.is_empty(), ShieldError::InvalidAmount);
    require!(!output_commitments.is_empty(), ShieldError::InvalidAmount);
    
    // 2. Verify the ZK proof
    verify_groth16(&ctx.accounts.transfer_verifier, &proof, &public_inputs)?;
    
    // 3. Mark nullifiers as spent (prevents double-spend)
    for nullifier in input_nullifiers {
        track_nullifier(&mut ctx.accounts.nullifier_set, nullifier)?;
        emit!(NullifierConsumed { nullifier });
    }
    
    // 4. Append new commitments to Merkle tree
    for commitment in output_commitments {
        let _root = ctx.accounts.merkle_tree.append_leaf(commitment)?;
    }
    
    Ok(())
}
```

### 10.3 Account Structure

```rust
#[derive(Accounts)]
pub struct ShieldedTransfer<'info> {
    #[account(mut)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    
    #[account(mut)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    
    pub transfer_verifier: Account<'info, VerifierAccount>,
}
```

### 10.4 Nullifier Tracking

```rust
pub fn track_nullifier(
    nullifier_set: &mut Account<NullifierSetAccount>,
    nullifier: [u8; 32],
) -> Result<()> {
    // Check if already spent
    for existing in &nullifier_set.nullifiers {
        if existing == &nullifier {
            return Err(ShieldError::NullifierAlreadySpent.into());
        }
    }
    
    // Mark as spent
    nullifier_set.nullifiers.push(nullifier);
    Ok(())
}
```

### 10.5 Groth16 Verification

```rust
pub fn verify_groth16(
    verifier: &Account<VerifierAccount>,
    proof: &[u8],
    public_inputs: &[[u8; 32]],
) -> Result<()> {
    // Deserialize proof points (A, B, C)
    // Deserialize public inputs as field elements
    // Perform pairing check: e(A, B) = e(α, β) · e(L, γ) · e(C, δ)
    // Return error if verification fails
    
    // Uses Solana's precompiled alt_bn128 operations
    Ok(())
}
```

---

## 11. Privacy Guarantees

### 11.1 What Observers See

For a shielded-to-shielded transfer, on-chain observers see:

| Data | Visible? | Details |
|------|----------|---------|
| Sender address | ❌ | Relayer signs, not sender |
| Recipient address | ❌ | Only commitment is stored |
| Transfer amount | ❌ | Hidden in commitment |
| Which note spent | ❌ | Nullifier unlinkable to commitment |
| Token type | ❌ | Encoded in commitment |
| New commitment 1 | ✅ | But reveals nothing |
| New commitment 2 | ✅ | But reveals nothing |
| Nullifier | ✅ | Cannot link to source |
| Encrypted memo | ✅ | But only recipient can decrypt |

### 11.2 Anonymity Set

The anonymity set is the entire Merkle tree:
- All notes that have ever been deposited
- Up to 2^20 = 1,048,576 possible notes
- The proof doesn't reveal which leaf was spent

### 11.3 Attack Resistance

| Attack | Mitigation |
|--------|------------|
| Transaction graph analysis | Nullifier unlinkability |
| Amount correlation | Hidden in commitments |
| Timing analysis | Relayer batching (optional) |
| Sender identification | Relayer signs transactions |
| Recipient identification | ECDH encryption |
| Double-spending | Nullifier tracking |
| Inflation | Circuit amount constraint |

---

## 12. Code Reference Map

### 12.1 Key Files

| Component | File Path |
|-----------|-----------|
| Key Derivation | `app/src/lib/shieldedKeys.ts` |
| Note Creation | `app/src/lib/shield.ts` |
| ZK Circuit | `zk/circuits/transfer.circom` |
| Merkle Circuit | `zk/circuits/merkle.circom` |
| Transfer Flow | `app/src/App.tsx` (lines 2290-2450, 3590-3800) |
| Relayer Client | `app/src/lib/prover.ts` |
| On-Chain Program | `programs/noctura-shield/src/lib.rs` |
| ECDH Encryption | `app/src/lib/ecdhEncryption.ts` |
| Wallet Scanner | `app/src/lib/walletScanner.ts` |
| Witness Builders | `zk/witness/builders/transfer.ts` |
| Note Type | `zk/witness/note.ts` |

### 12.2 Function Reference

| Function | Purpose | Location |
|----------|---------|----------|
| `deriveShieldedKeys()` | Derive key hierarchy | `shieldedKeys.ts:57` |
| `createNote()` | Create note with commitment | `witness/note.ts:13` |
| `createNoteFromSecrets()` | Create note for token type | `shield.ts:45` |
| `startShieldedTransfer()` | Initiate transfer | `App.tsx:2257` |
| `serializeTransferWitness()` | Build circuit input | `witness/builders/transfer.ts` |
| `proveCircuit('transfer', ...)` | Generate ZK proof | `prover.ts:107` |
| `encryptNoteToRecipient()` | ECDH encrypt note | `ecdhEncryption.ts:175` |
| `relayTransfer()` | Submit via relayer | `prover.ts:183` |
| `shielded_transfer()` | On-chain instruction | `lib.rs:152` |
| `verify_groth16()` | Verify proof on-chain | `lib.rs:verifier.rs` |
| `scanForIncomingNotes()` | Background scanner | `walletScanner.ts:111` |
| `decryptNoteWithViewKey()` | Decrypt incoming note | `ecdhEncryption.ts:219` |

---

## Summary

Shielded-to-shielded transactions in Noctura achieve full privacy through:

1. **Commitment Scheme**: Poseidon hashes hide note contents
2. **Nullifier System**: Prevents double-spend without revealing note identity
3. **Zero-Knowledge Proofs**: Prove validity without exposing secrets
4. **Relayer Architecture**: Breaks sender-transaction linkability
5. **ECDH Encryption**: Secure note sharing with recipients
6. **Background Discovery**: Automatic incoming note detection

The system provides strong privacy guarantees while maintaining full verifiability and preventing inflation attacks through cryptographic constraints enforced in the ZK circuit.

---

*Document generated for Noctura Wallet v1.0*
*Last updated: January 28, 2026*
