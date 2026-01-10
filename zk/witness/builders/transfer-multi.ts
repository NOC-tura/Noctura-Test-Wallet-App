import { Note } from '../note';
import { MerkleProof } from '../merkle';

export interface TransferMultiWitnessInput {
  inputNotes: Note[];  // 1-2 notes to combine
  merkleProofs: MerkleProof[];  // One proof per input note
  outputNote1: Note;   // recipient note
  outputNote2: Note;   // change note back to sender
}

export interface TransferMultiWitness {
  // Input notes (up to 2, unused slots zeroed)
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
  // Pad to 2 inputs with zero notes
  const paddedInputs: Note[] = [...inputNotes];
  const paddedProofs: MerkleProof[] = [...merkleProofs];
  
  while (paddedInputs.length < 2) {
    paddedInputs.push({
      secret: 0n,
      amount: 0n,
      tokenMint: inputNotes[0].tokenMint,
      blinding: 0n,
      rho: 0n,
      commitment: 0n,
      nullifier: 0n,
    });
    paddedProofs.push({
      pathElements: Array(20).fill(0n),
      pathIndices: Array(20).fill(0n),
      root: merkleProofs[0].root,
    });
  }

  return {
    inSecret1: paddedInputs[0].secret.toString(),
    inAmount1: paddedInputs[0].amount.toString(),
    inBlinding1: paddedInputs[0].blinding.toString(),
    inRho1: paddedInputs[0].rho.toString(),
    
    inSecret2: paddedInputs[1].secret.toString(),
    inAmount2: paddedInputs[1].amount.toString(),
    inBlinding2: paddedInputs[1].blinding.toString(),
    inRho2: paddedInputs[1].rho.toString(),
    
    tokenMint: inputNotes[0].tokenMint.toString(),
    
    pathElements1: paddedProofs[0].pathElements.map((x) => x.toString()),
    pathIndices1: paddedProofs[0].pathIndices.map((x) => x.toString()),
    pathElements2: paddedProofs[1].pathElements.map((x) => x.toString()),
    pathIndices2: paddedProofs[1].pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProofs[0].root.toString(),
    
    outSecret1: outputNote1.secret.toString(),
    outAmount1: outputNote1.amount.toString(),
    outBlinding1: outputNote1.blinding.toString(),
    outSecret2: outputNote2.secret.toString(),
    outAmount2: outputNote2.amount.toString(),
    outBlinding2: outputNote2.blinding.toString(),
    
    nullifier1: paddedInputs[0].nullifier.toString(),
    nullifier2: paddedInputs[1].nullifier.toString(),
  };
}

export function serializeTransferMultiPublicInputs(witness: TransferMultiWitness): [bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier1),
    BigInt(witness.nullifier2),
  ];
}
