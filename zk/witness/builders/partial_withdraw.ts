import { Note } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface PartialWithdrawWitnessInput {
  inputNote: Note;
  merkleProof: MerkleProof;
  withdrawAmount: bigint;
  changeNote: Note;  // change note back to sender
  receiver: bigint;  // recipient's wallet address as field element
}

export interface PartialWithdrawWitness {
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
  // Withdrawal amount
  withdrawAmount: string;
  // Change note
  changeSecret: string;
  changeAmount: string;
  changeBlinding: string;
  // Public
  nullifier: string;
  receiver: string;
}

export function serializePartialWithdrawWitness({ 
  inputNote, 
  merkleProof, 
  withdrawAmount,
  changeNote,
  receiver 
}: PartialWithdrawWitnessInput): PartialWithdrawWitness {
  return {
    inSecret: inputNote.secret.toString(),
    inAmount: inputNote.amount.toString(),
    tokenMint: inputNote.tokenMint.toString(),
    blinding: inputNote.blinding.toString(),
    rho: inputNote.rho.toString(),
    pathElements: merkleProof.pathElements.map((x) => x.toString()),
    pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProof.root.toString(),
    withdrawAmount: withdrawAmount.toString(),
    changeSecret: changeNote.secret.toString(),
    changeAmount: changeNote.amount.toString(),
    changeBlinding: changeNote.blinding.toString(),
    nullifier: inputNote.nullifier.toString(),
    receiver: receiver.toString(),
  };
}

export function serializePartialWithdrawPublicInputs(witness: PartialWithdrawWitness): [bigint, bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier),
    BigInt(witness.receiver),
    BigInt(witness.withdrawAmount),
  ];
}
