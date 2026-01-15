import { Note } from '../note';
import { MerkleProof } from '../merkle';

export interface TransferMultiWitnessInput {
  inputNotes: Note[];  // 1-4 notes to combine
  merkleProofs: MerkleProof[];
  outputNote1: Note;
  outputNote2: Note;
}

export interface TransferMultiWitness {
  inSecret1: string; inAmount1: string; inBlinding1: string; inRho1: string;
  inSecret2: string; inAmount2: string; inBlinding2: string; inRho2: string;
  inSecret3: string; inAmount3: string; inBlinding3: string; inRho3: string;
  inSecret4: string; inAmount4: string; inBlinding4: string; inRho4: string;
  tokenMint: string;
  pathElements1: string[]; pathIndices1: string[];
  pathElements2: string[]; pathIndices2: string[];
  pathElements3: string[]; pathIndices3: string[];
  pathElements4: string[]; pathIndices4: string[];
  merkleRoot: string;
  outSecret1: string; outAmount1: string; outBlinding1: string;
  outSecret2: string; outAmount2: string; outBlinding2: string;
  nullifier1: string; nullifier2: string; nullifier3: string; nullifier4: string;
}

export function serializeTransferMultiWitness({
  inputNotes,
  merkleProofs,
  outputNote1,
  outputNote2,
}: TransferMultiWitnessInput): TransferMultiWitness {
  // For multi-input transfers, we need exactly 4 input notes
  // If we have fewer, pad by DUPLICATING the first note (same amount!)
  // This means the circuit will verify 4 notes, but some are duplicates
  // The on-chain nullifier check will prevent actual double-spending
  // The amount conservation check: sum(inputs) = sum(outputs) will still hold
  // because we're counting the same note multiple times in the ZK proof
  // but the actual outputs are based on the real total
  
  if (inputNotes.length < 1) {
    throw new Error('At least one input note is required');
  }
  
  if (inputNotes.length > 4) {
    throw new Error('Maximum 4 input notes supported');
  }
  
  // Ensure we have 4 merkle proofs
  if (merkleProofs.length < inputNotes.length) {
    throw new Error(`Need ${inputNotes.length} merkle proofs, got ${merkleProofs.length}`);
  }
  
  console.log('[TransferMulti] === PADDING DEBUG ===');
  console.log('[TransferMulti] Input notes:', inputNotes.length);
  console.log('[TransferMulti] Merkle proofs:', merkleProofs.length);
  
  const paddedInputs: Note[] = [...inputNotes];
  const paddedProofs: MerkleProof[] = [...merkleProofs];
  
  // Pad with EXACT COPIES of the first note (including amount!)
  // This ensures merkle proofs pass. The nullifier will be the same,
  // which is fine for the ZK proof - on-chain will only see unique nullifiers
  const paddingNeeded = 4 - inputNotes.length;
  console.log('[TransferMulti] Padding with', paddingNeeded, 'copies of note 0');
  
  while (paddedInputs.length < 4) {
    paddedInputs.push({ ...inputNotes[0] }); // Exact copy
    paddedProofs.push({ ...merkleProofs[0] });
  }
  
  // Debug: Verify all proofs have same root
  const roots = paddedProofs.map(p => p.root.toString());
  console.log('[TransferMulti] Padded proof roots:', roots);
  const uniqueRoots = new Set(roots);
  if (uniqueRoots.size > 1) {
    console.error('[TransferMulti] ❌ CRITICAL: Different roots in padded proofs!');
    console.error('[TransferMulti] Unique roots:', [...uniqueRoots]);
  } else {
    console.log('[TransferMulti] ✓ All padded proofs have same root');
  }
  
  // Calculate what the circuit expects for outputs
  // The circuit checks: input1 + input2 + input3 + input4 = output1 + output2
  // With padding by duplication: if we have 2 notes of 100 each, padded becomes:
  //   100 + 100 + 100 + 100 = 400 expected
  // But our outputs are based on real total (200)
  // This will FAIL the amount conservation check!
  //
  // Solution: Only use transfer-multi when we have exactly 4 notes,
  // OR adjust outputs to match padded input total
  const paddedInputTotal = paddedInputs.reduce((sum, n) => sum + n.amount, 0n);
  const outputTotal = outputNote1.amount + outputNote2.amount;
  
  console.log('[TransferMulti] Padded input total:', paddedInputTotal.toString());
  console.log('[TransferMulti] Output total:', outputTotal.toString());
  
  if (paddedInputTotal !== outputTotal) {
    console.error(`[TransferMulti] Amount mismatch! Padded inputs: ${paddedInputTotal}, outputs: ${outputTotal}`);
    console.error(`[TransferMulti] Real input notes: ${inputNotes.length}, amounts: ${inputNotes.map(n => n.amount.toString())}`);
    throw new Error(
      `Amount conservation failed. With ${inputNotes.length} notes padded to 4, ` +
      `circuit sees ${paddedInputTotal} input but outputs sum to ${outputTotal}. ` +
      `Use exactly 4 notes or adjust output amounts.`
    );
  }
  
  console.log('[TransferMulti] === END PADDING DEBUG ===');

  return {
    inSecret1: paddedInputs[0].secret.toString(), inAmount1: paddedInputs[0].amount.toString(),
    inBlinding1: paddedInputs[0].blinding.toString(), inRho1: paddedInputs[0].rho.toString(),
    inSecret2: paddedInputs[1].secret.toString(), inAmount2: paddedInputs[1].amount.toString(),
    inBlinding2: paddedInputs[1].blinding.toString(), inRho2: paddedInputs[1].rho.toString(),
    inSecret3: paddedInputs[2].secret.toString(), inAmount3: paddedInputs[2].amount.toString(),
    inBlinding3: paddedInputs[2].blinding.toString(), inRho3: paddedInputs[2].rho.toString(),
    inSecret4: paddedInputs[3].secret.toString(), inAmount4: paddedInputs[3].amount.toString(),
    inBlinding4: paddedInputs[3].blinding.toString(), inRho4: paddedInputs[3].rho.toString(),
    tokenMint: inputNotes[0].tokenMint.toString(),
    pathElements1: paddedProofs[0].pathElements.map((x) => x.toString()),
    pathIndices1: paddedProofs[0].pathIndices.map((x) => x.toString()),
    pathElements2: paddedProofs[1].pathElements.map((x) => x.toString()),
    pathIndices2: paddedProofs[1].pathIndices.map((x) => x.toString()),
    pathElements3: paddedProofs[2].pathElements.map((x) => x.toString()),
    pathIndices3: paddedProofs[2].pathIndices.map((x) => x.toString()),
    pathElements4: paddedProofs[3].pathElements.map((x) => x.toString()),
    pathIndices4: paddedProofs[3].pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProofs[0].root.toString(),
    outSecret1: outputNote1.secret.toString(), outAmount1: outputNote1.amount.toString(),
    outBlinding1: outputNote1.blinding.toString(),
    outSecret2: outputNote2.secret.toString(), outAmount2: outputNote2.amount.toString(),
    outBlinding2: outputNote2.blinding.toString(),
    nullifier1: paddedInputs[0].nullifier.toString(), nullifier2: paddedInputs[1].nullifier.toString(),
    nullifier3: paddedInputs[2].nullifier.toString(), nullifier4: paddedInputs[3].nullifier.toString(),
  };
}

export function serializeTransferMultiPublicInputs(witness: TransferMultiWitness): [bigint, bigint, bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot), BigInt(witness.nullifier1), BigInt(witness.nullifier2),
    BigInt(witness.nullifier3), BigInt(witness.nullifier4),
  ];
}
