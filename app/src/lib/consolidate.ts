/**
 * Note consolidation utilities for merging multiple shielded notes
 * when circuit input limits prevent direct withdrawal/transfer
 */

import { PublicKey } from '@solana/web3.js';
import type { Note } from '@zk-witness/index';
import { createNoteFromSecrets, createNoteFromSecretsLegacy } from '../lib/shield';
import { ShieldedNoteRecord } from '../types/shield';
import { serializeConsolidateWitness } from '@zk-witness/builders/consolidate';
import { buildMerkleProof } from '../lib/merkle';

/**
 * Consolidate multiple notes into one or two larger notes using the consolidate circuit
 * Up to 8 input notes can be consolidated into 1 output note in a single proof
 *
 * @param inputNotes - Array of notes to consolidate (max 8)
 * @param tokenMint - Token mint for all notes
 * @param allNotesForMerkle - All available notes for building merkle proofs
 * @returns Consolidated note(s) that fit within 4-input circuit limits
 */
export function partitionNotesForConsolidation(
  inputRecords: ShieldedNoteRecord[],
  tokenMint: PublicKey,
): Array<{
  inputNotes: Note[];
  inputRecords: ShieldedNoteRecord[];
  outputNote: Note;
}> {
  if (inputRecords.length === 0) {
    throw new Error('No notes to consolidate');
  }

  // If we have 8 or fewer notes, consolidate all into 1
  if (inputRecords.length <= 8) {
    const inputNotes = inputRecords.map(record => ({
      secret: BigInt(record.secret),
      amount: BigInt(record.amount),
      tokenMint: BigInt(record.tokenMintField),
      blinding: BigInt(record.blinding),
      rho: BigInt(record.rho),
      commitment: BigInt(record.commitment),
      nullifier: BigInt(record.nullifier),
    }));

    const totalAmount = inputNotes.reduce((sum, n) => sum + n.amount, 0n);
    // Use legacy function to create note from PublicKey
    const outputNote = createNoteFromSecretsLegacy(totalAmount, tokenMint);

    return [{ inputNotes, inputRecords, outputNote }];
  }

  // If we have more than 8 notes, need multiple consolidation rounds
  // First consolidate groups of 8 into single notes
  // Then consolidate those consolidated notes in a second round if needed

  const steps: Array<{
    inputNotes: Note[];
    inputRecords: ShieldedNoteRecord[];
    outputNote: Note;
  }> = [];

  let remaining = [...inputRecords];

  while (remaining.length > 4) {
    // Take the next batch of 8 (or fewer if not enough left)
    const batch = remaining.splice(0, 8);

    const inputNotes = batch.map(record => ({
      secret: BigInt(record.secret),
      amount: BigInt(record.amount),
      tokenMint: BigInt(record.tokenMintField),
      blinding: BigInt(record.blinding),
      rho: BigInt(record.rho),
      commitment: BigInt(record.commitment),
      nullifier: BigInt(record.nullifier),
    }));

    const totalAmount = inputNotes.reduce((sum, n) => sum + n.amount, 0n);
    // Use legacy function to create note from PublicKey
    const outputNote = createNoteFromSecretsLegacy(totalAmount, tokenMint);

    steps.push({ inputNotes, inputRecords: batch, outputNote });
  }

  // Any remaining notes (4 or fewer) don't need consolidation
  // They can be used as-is in the withdrawal circuit

  return steps;
}

/**
 * Build the witness data for a consolidation circuit proof
 */
export function buildConsolidationWitness(input: {
  inputRecords: ShieldedNoteRecord[];
  outputNote: Note;
  allNotesForMerkle: ShieldedNoteRecord[];
}) {
  const { inputRecords, outputNote, allNotesForMerkle } = input;

  const inputNotes = inputRecords.map(record => ({
    secret: BigInt(record.secret),
    amount: BigInt(record.amount),
    tokenMint: BigInt(record.tokenMintField),
    blinding: BigInt(record.blinding),
    rho: BigInt(record.rho),
    commitment: BigInt(record.commitment),
    nullifier: BigInt(record.nullifier),
  }));

  // Build merkle proof for each input note
  const merkleProofs = inputRecords.map(record => {
    // Find the record in allNotes
    const foundRecord = allNotesForMerkle.find(n => n.nullifier === record.nullifier);
    if (!foundRecord) {
      throw new Error(`Record not found in merkle tree for nullifier ${record.nullifier.slice(0, 16)}`);
    }
    return buildMerkleProof(allNotesForMerkle, foundRecord);
  });

  return serializeConsolidateWitness({
    inputNotes,
    merkleProofs,
    outputNote,
  });
}
