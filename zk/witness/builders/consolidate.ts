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
 * 
 * CRITICAL: The circuit is compiled with nInputs=8 (MAX_INPUTS), so the witness
 * MUST have exactly 8 values for all input arrays. Unused slots are padded with 0.
 */
export function serializeConsolidateWitness({
  inputNotes,
  merkleProofs,
  outputNote,
}: ConsolidateWitnessInput): ConsolidateWitness {
  const MAX_INPUTS = 8;
  
  if (inputNotes.length === 0 || inputNotes.length > MAX_INPUTS) {
    throw new Error(`Consolidate circuit supports 1-${MAX_INPUTS} input notes, got ${inputNotes.length}`);
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

  // Pad input arrays to MAX_INPUTS with zeros
  // This is required because the circuit is instantiated with Consolidate(8)
  const paddedSecrets = inputNotes.map((n) => n.secret.toString());
  const paddedAmounts = inputNotes.map((n) => n.amount.toString());
  const paddedBlindings = inputNotes.map((n) => n.blinding.toString());
  const paddedRhos = inputNotes.map((n) => n.rho.toString());
  const paddedNullifiers = inputNotes.map((n) => n.nullifier.toString());
  
  // Pad with zeros to reach MAX_INPUTS
  while (paddedSecrets.length < MAX_INPUTS) {
    paddedSecrets.push('0');
    paddedAmounts.push('0');
    paddedBlindings.push('0');
    paddedRhos.push('0');
    paddedNullifiers.push('0');
  }

  // Merkle proofs: pad to MAX_INPUTS with empty proofs
  const TREE_HEIGHT = 20;
  const paddedPathElements = merkleProofs.map((p) => p.pathElements.map((x) => x.toString()));
  const paddedPathIndices = merkleProofs.map((p) => p.pathIndices.map((x) => x.toString()));
  
  // Pad merkle proofs with zero-filled arrays
  while (paddedPathElements.length < MAX_INPUTS) {
    paddedPathElements.push(Array(TREE_HEIGHT).fill('0'));
    paddedPathIndices.push(Array(TREE_HEIGHT).fill('0'));
  }

  return {
    inSecrets: paddedSecrets,
    inAmounts: paddedAmounts,
    tokenMint: firstTokenMint.toString(),
    blindings: paddedBlindings,
    rhos: paddedRhos,
    pathElements: paddedPathElements,
    pathIndices: paddedPathIndices,
    merkleRoot: merkleProofs[0].root.toString(),
    outSecret: outputNote.secret.toString(),
    outBlinding: outputNote.blinding.toString(),
    nullifiers: paddedNullifiers,
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
