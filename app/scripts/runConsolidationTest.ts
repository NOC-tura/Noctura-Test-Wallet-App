#!/usr/bin/env ts-node
import crypto from 'node:crypto';

// Polyfill crypto.getRandomValues for shield.ts randomScalar
globalThis.crypto = {
  getRandomValues: (arr: Uint8Array) => {
    const buf = crypto.randomBytes(arr.length);
    arr.set(buf);
    return arr;
  },
} as any;

// Point app libs to mock relayer/prover
globalThis.__PROVER_URL__ = 'http://localhost:8787';
process.env.VITE_RELAYER_ENDPOINTS = 'http://localhost:8787';

async function main() {
  console.log('=== 300× deposit → single withdraw test (mock) ===');

  const [{ PublicKey }, { parseNocAmount, createNoteFromSecrets, snapshotNote, pubkeyToField }, { partitionNotesForConsolidation, buildConsolidationWitness }, { proveCircuit, relayWithdraw }, { relayConsolidate }, { buildMerkleProof }, { serializeWithdrawWitness }, { NOC_TOKEN_MINT }] = await Promise.all([
    import('@solana/web3.js'),
    import('../src/lib/shield'),
    import('../src/lib/consolidate'),
    import('../src/lib/prover'),
    import('../src/lib/shieldProgram'),
    import('../src/lib/merkle'),
    import('../../zk/witness/builders/withdraw'),
    import('../src/lib/constants'),
  ]);

  const mintKey = new PublicKey(NOC_TOKEN_MINT);
  const owner = new PublicKey(crypto.randomBytes(32));
  const recipient = new PublicKey(crypto.randomBytes(32));

  const oneNoc = parseNocAmount('1');

  // Generate 300 notes
  const allNotes = [] as ReturnType<typeof snapshotNote>[];
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
    const nextRound: typeof current = [];

    for (let i = 0; i < current.length; i += 8) {
      const batchRecords = current.slice(i, i + 8);
      const steps = partitionNotesForConsolidation(batchRecords, mintKey);
      for (const step of steps) {
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
  const totalAtoms = allNotes
    .filter((n) => !n.spent)
    .reduce((s, r) => s + BigInt(r.amount), 0n);
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
