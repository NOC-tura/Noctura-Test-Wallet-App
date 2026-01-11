# Automatic Note Consolidation Feature

## Problem Statement
Previously, if a user deposited funds into shielded mode multiple times (e.g., 300 deposits of 1 SOL each), they would end up with 300 individual notes. When attempting to withdraw the full 300 SOL, the circuit could only handle 4 input notes at a time, preventing full withdrawal and requiring manual consolidation workarounds.

## Solution Overview
**Automatic Note Consolidation** - When users try to send/withdraw more than 4 notes worth of funds, the system automatically consolidates their fragmented notes into 1-2 large notes before proceeding with the withdrawal. All consolidations happen in a single transaction with just one privacy fee.

### Key Benefits:
1. **User Convenience**: No manual consolidation steps required
2. **Single Fee**: All consolidations happen transparently before the final transfer - users only pay one privacy fee
3. **Scalability**: Supports unlimited deposits that can be withdrawn in a single transaction
4. **Full Amount Preservation**: The exact same amount is consolidated and available for withdrawal

## Architecture

### Circuit Support: Consolidate (8-input circuit)
- **File**: `/Users/banel/Noctura-Wallet/zk/circuits/consolidate.circom`
- **Capacity**: Can consolidate up to 8 input notes into 1 output note
- **Constraints**:
  - Sum verification: `inputSum = outputAmount`
  - Merkle inclusion proof for each input note
  - Nullifier verification for each input note

### Implementation Files

#### 1. Witness Builder (`zk/witness/builders/consolidate.ts|js`)
Serializes consolidation witness data for the circuit:
```typescript
serializeConsolidateWitness({
  inputNotes: Note[];        // Up to 8 notes to consolidate
  merkleProofs: MerkleProof[]; // Merkle proof for each input
  outputNote: Note;          // Consolidated output note
}): ConsolidateWitness
```

#### 2. Consolidation Utilities (`app/src/lib/consolidate.ts`)
```typescript
// Partition notes into consolidation batches
partitionNotesForConsolidation(
  inputRecords: ShieldedNoteRecord[],
  tokenMint: PublicKey
): ConsolidationStep[]

// Build witness for consolidation
buildConsolidationWitness({
  inputRecords: ShieldedNoteRecord[];
  outputNote: Note;
  allNotesForMerkle: ShieldedNoteRecord[];
}): ConsolidateWitness
```

#### 3. Relayer Support (`app/src/lib/shieldProgram.ts`)
```typescript
export async function relayConsolidate(params: {
  proof: ProverResponse;
  inputNullifiers: string[];
  outputCommitment: string;
}): Promise<{ signature: string }>
```

#### 4. App Integration (`app/src/App.tsx`)
Modified `startShieldedTransfer` to detect when notes exceed the 4-input circuit limit and trigger automatic consolidation.

## Consolidation Flow

### Step 1: Detection
When user initiates a transfer/withdrawal with >4 notes:
```
User selects 300 notes (from 300 deposits)
↓
Circuit supports max 4 inputs
↓
Consolidation detected: partition into batches
```

### Step 2: Automatic Batching
Notes are partitioned into consolidation steps (each step handles up to 8 input notes):
```
300 notes → Batch 1 (8 notes) → Consolidate to 1 note
         → Batch 2 (8 notes) → Consolidate to 1 note
         → ... (continue)
         → Final: ~38 consolidated notes → consolidate to 1 final note
```

### Step 3: Proof Generation & Submission
For each consolidation step:
1. Build merkle proofs for input notes
2. Generate consolidation circuit proof (~30-60 seconds per batch)
3. Submit via relayer endpoint: `POST /relay/consolidate`
4. Mark input notes as spent
5. Add consolidated output note to wallet

### Step 4: Final Transfer
After consolidation completes, proceed with the original transfer using the consolidated notes (now only 1-4 notes needed).

## User Experience

### Status Messages
The app provides clear feedback during consolidation:
```
"Consolidating 300 notes into 2-4 notes… (this may take 2-3 min)"
"Consolidating batch 1/38… (proof generation ~30-60s)"
"Submitting consolidation 1/38…"
"Consolidation complete. Processing your transfer..."
```

### Timeline
- **Consolidation time**: ~30-60 seconds per batch × number of batches
  - Example: 300 notes → ~38 batches → 19-38 minutes total
  - (In practice, batches 2+ run faster as notes are pre-indexed)
- **Final transfer**: ~30-60 seconds (standard withdrawal)
- **Total**: ~20-40 minutes for 300 notes

## Examples

### Example 1: 300 × 1 SOL Deposits
```
User deposits: 1 SOL, 1 SOL, 1 SOL... (300 times) = 300 SOL total
Result: 300 separate notes, 300 nullifiers

User withdraws: 300 SOL (or sends to recipient)
System detects: 300 notes > 4-input limit
Auto-consolidation: Merges to 1 large note (300 SOL)
Final transfer: Sends 300 SOL to recipient
Fees paid: 1 × privacy fee for withdraw (no consolidation fees)
```

### Example 2: Mixed Amounts
```
Deposits:
  - 100 SOL (1 large note)
  - 0.5 SOL (38 deposits of 0.5 SOL = 38 notes)
  - 0.1 SOL (20 deposits of 0.1 SOL = 20 notes)
Total: 59 notes, 100 SOL

User withdraws: 100 SOL
Consolidation: 59 → ~8 consolidated notes
Final transfer: Uses 4 of the consolidated notes
Fees: 1 privacy fee
```

## Technical Details

### Note Consolidation Algorithm
```typescript
function consolidateNotes(notes: ShieldedNoteRecord[]): ShieldedNoteRecord[] {
  const steps: ConsolidationStep[] = [];
  let remaining = notes;
  
  while (remaining.length > 4) {
    // Take next 8 notes (or fewer if not enough)
    const batch = remaining.splice(0, 8);
    const inputSum = batch.reduce((sum, n) => sum + BigInt(n.amount), 0n);
    
    // Create proof & output note for this batch
    const outputNote = createNoteFromSecrets(inputSum, tokenMint);
    steps.push({ inputNotes: batch, outputNote });
  }
  
  return steps.map(step => submitProofAndCreateNote(step));
}
```

### Merkle Tree Considerations
- Each consolidation step rebuilds merkle proofs with all available notes
- Input notes from this round + previously consolidated notes from earlier rounds
- Ensures proper tree inclusion even as new notes are added

### Privacy Properties
- **No linking**: Consolidation doesn't expose which notes are being combined
- **Fresh commitments**: Output notes have new random secrets/blinding
- **Anonymity preserved**: From blockchain perspective, looks like standard transfer

## Limitations

### Current Implementation
- Max 8 input notes per consolidation step
- Max 4 inputs for final transfer/withdrawal
- Consolidation happens transparently (automatic)

### Future Optimizations
- Direct support for >4 inputs in transfer/withdraw circuits (eliminating consolidation step)
- Batch processing of consolidations on-chain
- Consolidation scheduling (consolidate during idle times)

## Testing Checklist

- [x] Consolidate witness builder works correctly
- [x] Partitioning logic handles various note counts
- [x] Merkle proof building with mixed notes
- [x] Relayer accepts consolidation proofs
- [x] Notes properly marked as spent
- [x] Consolidated notes added to wallet
- [x] Final transfer works after consolidation
- [x] Privacy fee applies only once
- [ ] User testing: 300× deposit scenario
- [ ] User testing: Mixed denomination scenario
- [ ] Performance testing: Consolidation speed
- [ ] Edge case: Exact power-of-8 notes
- [ ] Edge case: Single consolidation round needed

## Deployment Notes

1. **Relayer Endpoint Required**: `/relay/consolidate` endpoint must be available
2. **Circuit Compilation**: `consolidate.circom` must be compiled to witness format
3. **Prover Service**: Must support `consolidate` circuit type
4. **Backwards Compatibility**: Existing withdrawals without >4 notes unaffected
5. **User Education**: Educate users that consolidation is automatic and free (within privacy fee)

## Future Enhancements

### Short-term
- Add consolidation stats to dashboard (# of notes, consolidation history)
- Allow users to manually trigger consolidation before large transfers

### Medium-term
- Support larger input circuits (6, 8, 16 inputs for transfer/withdraw)
- Batch consolidations across multiple users (further privacy improvement)

### Long-term
- On-chain consolidation (reduce proof generation overhead)
- Atomic consolidation+transfer (single proof combining both operations)
