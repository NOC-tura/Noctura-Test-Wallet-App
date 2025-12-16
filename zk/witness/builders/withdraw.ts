import { Note } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface WithdrawWitnessInput {
  inputNote: Note;
  merkleProof: MerkleProof;
  receiver: bigint;
}

export interface WithdrawWitness {
  inSecret: string;
  inAmount: string;
  tokenMint: string;
  blinding: string;
  rho: string;
  pathElements: string[];
  pathIndices: string[];
  merkleRoot: string;
  receiver: string;
  nullifier: string;
}

export function serializeWithdrawWitness({ inputNote, merkleProof, receiver }: WithdrawWitnessInput): WithdrawWitness {
  return {
    inSecret: inputNote.secret.toString(),
    inAmount: inputNote.amount.toString(),
    tokenMint: inputNote.tokenMint.toString(),
    blinding: inputNote.blinding.toString(),
    rho: inputNote.rho.toString(),
    pathElements: merkleProof.pathElements.map((x) => x.toString()),
    pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProof.root.toString(),
    receiver: receiver.toString(),
    nullifier: inputNote.nullifier.toString(),
  };
}

export function serializeWithdrawPublicInputs(witness: WithdrawWitness): [bigint, bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.receiver),
    BigInt(witness.nullifier),
    BigInt(witness.inAmount),
  ];
}
