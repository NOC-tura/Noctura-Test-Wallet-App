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
  const paddedSecrets: string[] = [];
  const paddedAmounts: string[] = [];
  const paddedBlindings: string[] = [];
  const paddedRhos: string[] = [];
  const paddedNullifiers: string[] = [];
  
  // Add real values
  for (let i = 0; i < inputNotes.length; i++) {
    paddedSecrets[i] = inputNotes[i].secret.toString();
    paddedAmounts[i] = inputNotes[i].amount.toString();
    paddedBlindings[i] = inputNotes[i].blinding.toString();
    paddedRhos[i] = inputNotes[i].rho.toString();
    paddedNullifiers[i] = inputNotes[i].nullifier.toString();
  }
  
  // Fill remaining slots with zeros
  for (let i = inputNotes.length; i < MAX_INPUTS; i++) {
    paddedSecrets[i] = '0';
    paddedAmounts[i] = '0';
    paddedBlindings[i] = '0';
    paddedRhos[i] = '0';
    paddedNullifiers[i] = '0';
  }

  // Merkle proofs: must have exactly 8 entries
  const TREE_HEIGHT = 20;
  const paddedPathElements: string[][] = [];
  const paddedPathIndices: string[][] = [];
  
  // Add real merkle proofs
  for (let i = 0; i < merkleProofs.length; i++) {
    paddedPathElements[i] = merkleProofs[i].pathElements.map((x) => x.toString());
    paddedPathIndices[i] = merkleProofs[i].pathIndices.map((x) => x.toString());
  }
  
  // Fill remaining slots with zero-filled proofs
  for (let i = merkleProofs.length; i < MAX_INPUTS; i++) {
    paddedPathElements[i] = Array(TREE_HEIGHT).fill('0');
    paddedPathIndices[i] = Array(TREE_HEIGHT).fill('0');
  }

  const witness: ConsolidateWitness = {
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
  
  // DEBUG: Log the actual array lengths being sent
  console.log('[ConsolidateWitness] Built witness with:');
  console.log(`  - inSecrets: ${witness.inSecrets.length} entries`);
  console.log(`  - inAmounts: ${witness.inAmounts.length} entries`);
  console.log(`  - blindings: ${witness.blindings.length} entries`);
  console.log(`  - rhos: ${witness.rhos.length} entries`);
  console.log(`  - pathElements: ${witness.pathElements.length} rows`);
  console.log(`  - nullifiers: ${witness.nullifiers.length} entries`);
  console.log(`  - Actual input notes: ${inputNotes.length}, merkle proofs: ${merkleProofs.length}`);
  
  return witness;
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
