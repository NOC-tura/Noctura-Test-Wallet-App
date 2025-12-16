import { Note } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface DepositWitnessInput {
  note: Note;
  proof?: MerkleProof;
}

export interface DepositWitness {
  secret: string;
  amount: string;
  tokenMint: string;
  blinding: string;
  expectedCommitment: string;
}

export function serializeDepositWitness({ note }: DepositWitnessInput): DepositWitness {
  return {
    secret: note.secret.toString(),
    amount: note.amount.toString(),
    tokenMint: note.tokenMint.toString(),
    blinding: note.blinding.toString(),
    expectedCommitment: note.commitment.toString(),
  };
}

export function serializeDepositPublicInputs(note: Note): [bigint, bigint] {
  // Groth16 emits two identical public signals for this circuit (commitment twice).
  // Return both so on-chain verifier receives the vector size it expects.
  return [note.commitment, note.commitment];
}
