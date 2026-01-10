import { Note } from '../note';
import { MerkleProof } from '../merkle';

export interface TransferMultiWitnessInput {
  inputNotes: Note[];  // 2 notes to combine
  merkleProofs: MerkleProof[];  // One proof per input note
  outputNote1: Note;   // recipient note
  outputNote2: Note;   // change note back to sender
}

export interface TransferMultiWitness {
  // Input notes (exactly 2)
  inSecret1: string;
  inAmount1: string;
  inBlinding1: string;
  inRho1: string;
  
  inSecret2: string;
  inAmount2: string;
  inBlinding2: string;
  inRho2: string;
  
  tokenMint: string;
  
  // Merkle proofs (one per input note)
  pathElements1: string[];
  pathIndices1: string[];
  pathElements2: string[];
  pathIndices2: string[];
  merkleRoot: string;
  
  // Output notes
  outSecret1: string;
  outAmount1: string;
  outBlinding1: string;
  outSecret2: string;
  outAmount2: string;
  outBlinding2: string;
  
  // Public: nullifiers for both inputs
  nullifier1: string;
  nullifier2: string;
}

export function serializeTransferMultiWitness({
  inputNotes,
  merkleProofs,
  outputNote1,
  outputNote2,
}: TransferMultiWitnessInput): TransferMultiWitness {
  // Must have exactly 2 input notes
  if (inputNotes.length !== 2) {
    throw new Error(`transfer-multi requires exactly 2 input notes, got ${inputNotes.length}`);
  }
  
  if (merkleProofs.length !== 2) {
    throw new Error(`transfer-multi requires exactly 2 merkle proofs, got ${merkleProofs.length}`);
  }

  return {
    inSecret1: inputNotes[0].secret.toString(),
    inAmount1: inputNotes[0].amount.toString(),
    inBlinding1: inputNotes[0].blinding.toString(),
    inRho1: inputNotes[0].rho.toString(),
    
    inSecret2: inputNotes[1].secret.toString(),
    inAmount2: inputNotes[1].amount.toString(),
    inBlinding2: inputNotes[1].blinding.toString(),
    inRho2: inputNotes[1].rho.toString(),
    
    tokenMint: inputNotes[0].tokenMint.toString(),
    
    pathElements1: merkleProofs[0].pathElements.map((x) => x.toString()),
    pathIndices1: merkleProofs[0].pathIndices.map((x) => x.toString()),
    pathElements2: merkleProofs[1].pathElements.map((x) => x.toString()),
    pathIndices2: merkleProofs[1].pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProofs[0].root.toString(),
    
    outSecret1: outputNote1.secret.toString(),
    outAmount1: outputNote1.amount.toString(),
    outBlinding1: outputNote1.blinding.toString(),
    outSecret2: outputNote2.secret.toString(),
    outAmount2: outputNote2.amount.toString(),
    outBlinding2: outputNote2.blinding.toString(),
    
    nullifier1: inputNotes[0].nullifier.toString(),
    nullifier2: inputNotes[1].nullifier.toString(),
  };
}

export function serializeTransferMultiPublicInputs(witness: TransferMultiWitness): [bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier1),
    BigInt(witness.nullifier2),
  ];
}
