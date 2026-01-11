import { Note } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface ConsolidateWitnessInput {
  inputNotes: Note[];
  merkleProofs: MerkleProof[];
  outputNote: Note;
}

export interface ConsolidateWitness {
  // Input notes (up to 8)
  inSecrets: string[];
  inAmounts: string[];
  tokenMint: string;
  blindings: string[];
  rhos: string[];

  // Merkle proofs for each input
  pathElements: string[][];
  pathIndices: string[][];
  merkleRoot: string;

  // Output note
  outSecret: string;
  outBlinding: string;

  // Public signals
  nullifiers: string[];
}

/**
 * Serialize consolidation witness for circuit
 * Consolidates up to 8 input notes into 1 output note
 */
export function serializeConsolidateWitness({
  inputNotes,
  merkleProofs,
  outputNote,
}: ConsolidateWitnessInput): ConsolidateWitness {
  if (inputNotes.length === 0 || inputNotes.length > 8) {
    throw new Error(`Consolidate circuit supports 1-8 input notes, got ${inputNotes.length}`);
  }

  if (inputNotes.length !== merkleProofs.length) {
    throw new Error(
      `Mismatch: ${inputNotes.length} notes but ${merkleProofs.length} merkle proofs`,
    );
  }

  // All notes must have same token mint
  const firstTokenMint = inputNotes[0].tokenMint;
  for (let i = 1; i < inputNotes.length; i++) {
    if (inputNotes[i].tokenMint !== firstTokenMint) {
      throw new Error('All input notes must have the same token mint for consolidation');
    }
  }

  // Verify output note has same token mint
  if (outputNote.tokenMint !== firstTokenMint) {
    throw new Error('Output note must have same token mint as input notes');
  }

  // Verify sum: sum of inputs = output amount
  const inputSum = inputNotes.reduce((sum, note) => sum + note.amount, 0n);
  if (inputSum !== outputNote.amount) {
    throw new Error(
      `Amount mismatch: inputs sum to ${inputSum}, output is ${outputNote.amount}`,
    );
  }

  return {
    inSecrets: inputNotes.map((n) => n.secret.toString()),
    inAmounts: inputNotes.map((n) => n.amount.toString()),
    tokenMint: firstTokenMint.toString(),
    blindings: inputNotes.map((n) => n.blinding.toString()),
    rhos: inputNotes.map((n) => n.rho.toString()),
    pathElements: merkleProofs.map((p) => p.pathElements.map((x) => x.toString())),
    pathIndices: merkleProofs.map((p) => p.pathIndices.map((x) => x.toString())),
    merkleRoot: merkleProofs[0].root.toString(),
    outSecret: outputNote.secret.toString(),
    outBlinding: outputNote.blinding.toString(),
    nullifiers: inputNotes.map((n) => n.nullifier.toString()),
  };
}

/**
 * Public inputs for consolidate circuit
 * Returns [nullifier1, nullifier2, ..., nullifierN, merkleRoot]
 * (circuit main component declares: component main {public [nullifiers, merkleRoot]})
 */
export function serializeConsolidatePublicInputs(
  inputNotes: Note[],
  merkleRoot: bigint,
): bigint[] {
  return [...inputNotes.map((n) => n.nullifier), merkleRoot];
}
