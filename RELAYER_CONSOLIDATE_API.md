# Relayer API Update: Consolidation Endpoint

## New Endpoint Required: `POST /relay/consolidate`

### Purpose
Submits a consolidation proof to the Solana blockchain, atomically merging multiple spent notes' commitments into a single new commitment.

### Request Format
```json
{
  "proof": {
    "proofBytes": "base64-encoded proof data",
    "publicInputs": [
      "nullifier_1_as_bigint",
      "nullifier_2_as_bigint",
      "nullifier_3_as_bigint",
      "...",
      "merkleRoot_as_bigint"
    ]
  },
  "inputNullifiers": [
    "nullifier_1_hex_string",
    "nullifier_2_hex_string",
    "nullifier_3_hex_string",
    "..."
  ],
  "outputCommitment": "0x1234567890abcdef..."
}
```

### Response Format
```json
{
  "signature": "5Hs5Z3...8xK2L",
  "slot": 12345678
}
```

### Constraints
- **Input nullifiers**: 1-8 elements (consolidated from 1-8 notes)
- **Output commitment**: Single new commitment (consolidated note)
- **Public inputs array**: Must match consolidation circuit
  - First N-1 elements: input nullifiers
  - Last element: merkle tree root
- **Proof verification**: Must validate against consolidation circuit verifier

### Implementation Steps (for relayer service)

#### 1. Add Route Handler
```typescript
router.post('/relay/consolidate', async (req, res) => {
  const { proof, inputNullifiers, outputCommitment } = req.body;
  
  try {
    // Verify proof against consolidate verifier key
    const isValid = await verifyProof(
      proof,
      'consolidate', // Verifier type
      /* public inputs from circuit */
    );
    
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid proof' });
    }
    
    // Mark nullifiers as spent (prevent double-spending)
    await markNullifiersSpent(inputNullifiers);
    
    // Add new commitment to merkle tree
    const leafIndex = await addCommitmentToTree(outputCommitment);
    
    // Submit transaction
    const signature = await submitConsolidationTx({
      nullifiers: inputNullifiers,
      newCommitment: outputCommitment,
      leafIndex,
    });
    
    res.json({ signature, slot: context.slot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### 2. Consolidation Transaction Structure
```typescript
// On-chain program call structure
{
  program: 'ShieldProgram',
  instruction: 'consolidate',
  accounts: [
    globalState,
    merkleTree,
    nullifierSet,
    verifier (consolidate variant),
  ],
  data: {
    // Proof data
    proof: proofBytes,
    publicInputs: [nullifier1, ..., nullifierN, merkleRoot],
    
    // New commitment info
    outputCommitment: newCommitment,
    leafIndex: merkleTreeLeafIndex,
  }
}
```

#### 3. Nullifier Tracking
```typescript
// Mark input nullifiers as spent
async function markNullifiersSpent(nullifiers: string[]) {
  for (const nullifier of nullifiers) {
    await nullifierSet.add(nullifier);
    console.log(`Marked nullifier spent: ${nullifier.slice(0, 16)}...`);
  }
}
```

#### 4. Merkle Tree Update
```typescript
// Add consolidated output commitment
async function addCommitmentToTree(commitment: bigint): number {
  const leafIndex = merkleTree.nextLeafIndex;
  merkleTree.append(commitment);
  console.log(`Added consolidated commitment at leaf index ${leafIndex}`);
  return leafIndex;
}
```

### Circuit Verification Details

#### Consolidate Circuit Public Inputs
```
[nullifier1, nullifier2, ..., nullifierN, merkleRoot]

Where:
- nullifier1...nullifierN: Nullifiers being consolidated (1-8)
- merkleRoot: Current merkle tree root (for inclusion proofs)

Note: Output commitment is NOT in public inputs (matches circuit design)
```

#### Verifier Key
- File: `consolidate.vkey` (compiled from `consolidate.circom`)
- Support: Configurable input counts (1, 2, 3, ..., 8 inputs)
- Or: Single generic verifier with variable witness

### Error Handling

| Error | Status | Message |
|-------|--------|---------|
| Invalid proof | 400 | "Proof verification failed" |
| Wrong # nullifiers | 400 | "Expected 1-8 nullifiers" |
| Nullifier already spent | 400 | "Nullifier already consumed" |
| Tree full | 500 | "Merkle tree has no capacity" |
| Transaction failed | 500 | "Consolidation tx rejected" |

### Example Client Call (App)

```typescript
// From app/src/lib/shieldProgram.ts
export async function relayConsolidate(params: {
  proof: ProverResponse;
  inputNullifiers: string[];
  outputCommitment: string;
}): Promise<{ signature: string }> {
  const response = await fetch('http://localhost:8787/relay/consolidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof: {
        proofBytes: params.proof.proofBytes,
        publicInputs: params.proof.publicInputs,
      },
      inputNullifiers: params.inputNullifiers,
      outputCommitment: params.outputCommitment,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Relayer error: ${response.statusText}`);
  }
  
  return response.json();
}
```

### Integration Testing

#### Test 1: Single Consolidation
```
Input: 2 notes (nullifiers A, B) totaling 100 SOL
Output: 1 note (commitment C) with 100 SOL
```

**Verification**:
- ✅ Proof accepted
- ✅ Both nullifiers marked spent
- ✅ New commitment in tree at correct index
- ✅ Signature returned

#### Test 2: Batch Consolidation (8 inputs)
```
Input: 8 notes → Output: 1 note
```

**Verification**:
- ✅ All 8 nullifiers marked spent
- ✅ Output commitment properly indexed
- ✅ Performance: <5 seconds per consolidation

#### Test 3: Consolidation Chain
```
Step 1: 8 notes → 1 note
Step 2: 8 notes → 1 note
Step 3: 2 notes → 1 note (final)
Final: Withdraw from consolidated note
```

**Verification**:
- ✅ Multi-step consolidations work
- ✅ Output notes from step 1 usable in subsequent proofs
- ✅ Final withdrawal succeeds

### Performance Metrics (Target)

| Metric | Target | Notes |
|--------|--------|-------|
| Proof acceptance | <1s | Simple verification |
| Nullifier marking | <100ms | Per consolidation |
| Tree update | <100ms | Single append |
| Total relayer response | <2s | Including all ops |
| Throughput | 30+ consolidations/min | Sequential |

### Backwards Compatibility

✅ **No breaking changes to existing endpoints**:
- `/relay/withdraw` - unchanged
- `/relay/transfer` - unchanged
- `/prove/*` - unchanged

✅ **New endpoint is additive** - existing clients unaffected

### Deployment Checklist

- [ ] Consolidate verifier key compiled and loaded
- [ ] Nullifier set can handle large consolidations (16+ at once)
- [ ] Merkle tree append tested with many updates
- [ ] Error handling covers all edge cases
- [ ] Rate limiting applied (prevent spam)
- [ ] Logging captures all consolidation events
- [ ] Monitoring alerts on verification failures
- [ ] Test with 50, 100, 300+ consecutive consolidations
- [ ] Performance benchmarked under load

### Future Enhancements

1. **Batch Consolidations** (Multiple users at once)
   - Combine consolidations from different users into single tx
   - Improved privacy + better on-chain efficiency

2. **Scheduled Consolidation**
   - Pre-consolidate notes during off-peak hours
   - Users retrieve consolidated notes when needed

3. **Direct Multi-Transfer**
   - Future circuit: Input → Output (no consolidation needed)
   - Eliminate consolidation overhead entirely
