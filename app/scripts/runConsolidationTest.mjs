#!/usr/bin/env node
import { PublicKey } from '@solana/web3.js';
import { parseNocAmount, createNoteFromSecrets, snapshotNote, pubkeyToField } from '../src/lib/shield.js';
import { partitionNotesForConsolidation, buildConsolidationWitness } from '../src/lib/consolidate.js';
import { proveCircuit, relayWithdraw } from '../src/lib/prover.js';
import { relayConsolidate } from '../src/lib/shieldProgram.js';
import { buildMerkleProof } from '../src/lib/merkle.js';
import { serializeWithdrawWitness } from '../../zk/witness/builders/withdraw.ts';
import { NOC_TOKEN_MINT } from '../src/lib/constants.js';
import crypto from 'node:crypto';

// Polyfill crypto.getRandomValues for shield.ts randomScalar
globalThis.crypto = {
  getRandomValues: (arr) => {
    const buf = crypto.randomBytes(arr.length);
    arr.set(buf);
    return arr;
  },
};

// Point app libs to mock relayer/prover
globalThis.__PROVER_URL__ = 'http://localhost:8787';
process.env.VITE_RELAYER_ENDPOINTS = 'http://localhost:8787';

async function main() {
  console.log('=== 300× deposit → single withdraw test (mock) ===');

  const mintKey = new PublicKey(NOC_TOKEN_MINT);
  const walletKey = crypto.generateKeyPairSync('ed25519').publicKey; // Node KeyObject
  // Create a fake Solana PublicKey for owner/recipient
  const owner = PublicKey.unique();
  const recipient = PublicKey.unique();

  const oneNoc = parseNocAmount('1');

  // Generate 300 notes
  const allNotes = [];
  for (let i = 0; i < 300; i++) {
    const note = createNoteFromSecrets(oneNoc, mintKey);
    const record = snapshotNote(note, owner, mintKey, {
      leafIndex: i,
      tokenType: 'NOC',
    });
    allNotes.push(record);
  }

  console.log(`[Setup] Created ${allNotes.length} notes of 1 NOC each`);

  // Consolidate iteratively down to 1 note
  let current = [...allNotes];
  let round = 0;
  while (current.length > 1) {
    round++;
    console.log(`\n[Round ${round}] Notes before: ${current.length}`);
    const nextRound = [];

    for (let i = 0; i < current.length; i += 8) {
      const batchRecords = current.slice(i, i + 8);
      const batches = partitionNotesForConsolidation(batchRecords, mintKey);
      // Each batch returns exactly one output when <=8 inputs
      for (const step of batches) {
        const witness = buildConsolidationWitness({
          inputRecords: step.inputRecords,
          outputNote: step.outputNote,
          allNotesForMerkle: allNotes,
        });
        const proof = await proveCircuit('consolidate', witness);
        const resp = await relayConsolidate({
          proof,
          inputNullifiers: witness.nullifiers,
          outputCommitment: step.outputNote.commitment.toString(),
        });
        // Mark inputs as spent and append new consolidated note
        for (const rec of step.inputRecords) {
          rec.spent = true;
        }
        const newRecord = snapshotNote(step.outputNote, owner, mintKey, {
          leafIndex: allNotes.length,
          tokenType: 'NOC',
        });
        allNotes.push(newRecord);
        nextRound.push(newRecord);
        console.log(`[Round ${round}] Consolidated ${step.inputRecords.length} → 1 (sig ${resp.signature})`);
      }
    }

    current = nextRound;
    console.log(`[Round ${round}] Notes after: ${current.length}`);
  }

  if (current.length !== 1) {
    throw new Error('Expected single consolidated note at end');
  }

  const finalNoteRecord = current[0];
  const totalAtoms = BigInt(allNotes.filter(n => !n.spent).reduce((s, r) => s + BigInt(r.amount), 0n));
  console.log(`[Final] Single note amount atoms: ${finalNoteRecord.amount}, expected total: ${totalAtoms}`);

  // Build withdraw witness for the single consolidated note
  const finalNote = {
    secret: BigInt(finalNoteRecord.secret),
    amount: BigInt(finalNoteRecord.amount),
    tokenMint: BigInt(finalNoteRecord.tokenMintField),
    blinding: BigInt(finalNoteRecord.blinding),
    rho: BigInt(finalNoteRecord.rho),
    commitment: BigInt(finalNoteRecord.commitment),
    nullifier: BigInt(finalNoteRecord.nullifier),
  };
  const merkleProof = buildMerkleProof(allNotes, finalNoteRecord);
  const receiverField = pubkeyToField(recipient);
  const withdrawWitness = serializeWithdrawWitness({
    inputNote: finalNote,
    merkleProof,
    receiver: receiverField,
  });

  const withdrawProof = await proveCircuit('withdraw', withdrawWitness);

  const relayResp = await relayWithdraw({
    proof: withdrawProof,
    amount: finalNoteRecord.amount,
    nullifier: finalNoteRecord.nullifier,
    recipientAta: recipient.toBase58(),
    mint: NOC_TOKEN_MINT,
    collectFee: true,
  });

  console.log(`[Withdraw] Relayed with signature: ${relayResp.signature}`);
  console.log('=== Test complete: PASS ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
