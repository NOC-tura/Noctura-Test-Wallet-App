import { Note, createNote } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface SwapWitnessInput {
  inputNote: Note;
  merkleProof: MerkleProof;
  outAmount: bigint;
  outTokenMint: bigint;
  outSecret: bigint;
  outBlinding: bigint;
}

export interface SwapWitness {
  // Input note
  inSecret: string;
  inAmount: string;
  inTokenMint: string;
  inBlinding: string;
  inRho: string;
  // Merkle proof
  pathElements: string[];
  pathIndices: string[];
  merkleRoot: string;
  // Output note
  outSecret: string;
  outAmount: string;
  outTokenMint: string;
  outBlinding: string;
  // Public inputs
  nullifier: string;
  expectedOutAmount: string;
}

export function serializeSwapWitness({ 
  inputNote, 
  merkleProof, 
  outAmount,
  outTokenMint,
  outSecret,
  outBlinding,
}: SwapWitnessInput): SwapWitness {
  return {
    // Input note
    inSecret: inputNote.secret.toString(),
    inAmount: inputNote.amount.toString(),
    inTokenMint: inputNote.tokenMint.toString(),
    inBlinding: inputNote.blinding.toString(),
    inRho: inputNote.rho.toString(),
    // Merkle proof
    pathElements: merkleProof.pathElements.map((x) => x.toString()),
    pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProof.root.toString(),
    // Output note
    outSecret: outSecret.toString(),
    outAmount: outAmount.toString(),
    outTokenMint: outTokenMint.toString(),
    outBlinding: outBlinding.toString(),
    // Public inputs
    nullifier: inputNote.nullifier.toString(),
    expectedOutAmount: outAmount.toString(),
  };
}

export function serializeSwapPublicInputs(witness: SwapWitness): [bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier),
    BigInt(witness.expectedOutAmount),
  ];
}
