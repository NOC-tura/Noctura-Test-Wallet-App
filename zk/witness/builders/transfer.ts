import { Note } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface TransferWitnessInput {
  inputNote: Note;
  merkleProof: MerkleProof;
  outputNote1: Note;  // recipient note
  outputNote2: Note;  // change note back to sender
}

export interface TransferWitness {
  // Input note
  inSecret: string;
  inAmount: string;
  tokenMint: string;
  blinding: string;
  rho: string;
  // Merkle proof
  pathElements: string[];
  pathIndices: string[];
  merkleRoot: string;
  // Output note 1 (recipient)
  outSecret1: string;
  outAmount1: string;
  outBlinding1: string;
  // Output note 2 (change)
  outSecret2: string;
  outAmount2: string;
  outBlinding2: string;
  // Public
  nullifier: string;
}

export function serializeTransferWitness({ inputNote, merkleProof, outputNote1, outputNote2 }: TransferWitnessInput): TransferWitness {
  return {
    inSecret: inputNote.secret.toString(),
    inAmount: inputNote.amount.toString(),
    tokenMint: inputNote.tokenMint.toString(),
    blinding: inputNote.blinding.toString(),
    rho: inputNote.rho.toString(),
    pathElements: merkleProof.pathElements.map((x) => x.toString()),
    pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProof.root.toString(),
    outSecret1: outputNote1.secret.toString(),
    outAmount1: outputNote1.amount.toString(),
    outBlinding1: outputNote1.blinding.toString(),
    outSecret2: outputNote2.secret.toString(),
    outAmount2: outputNote2.amount.toString(),
    outBlinding2: outputNote2.blinding.toString(),
    nullifier: inputNote.nullifier.toString(),
  };
}

export function serializeTransferPublicInputs(witness: TransferWitness): [bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier),
  ];
}
