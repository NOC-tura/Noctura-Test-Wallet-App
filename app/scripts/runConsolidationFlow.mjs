#!/usr/bin/env node
import crypto from 'node:crypto';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8787';
const NOC_MINT = '2aFVaSy29RZ5V7D6cPBf59sVwJB34nETF6piwjT7AYUb';

function randomHex(bits = 256) {
  const bytes = crypto.randomBytes(bits / 8);
  return '0x' + bytes.toString('hex');
}

async function http(path, body) {
  const res = await fetch(`${RELAYER_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${path}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log('=== 300× deposit → single withdraw test (mock-only) ===');
  const notes = [];
  for (let i = 0; i < 300; i++) {
    notes.push({
      commitment: randomHex(),
      nullifier: randomHex(),
      amount: (1_000_000).toString(), // 1 NOC in atoms
      leafIndex: i,
      spent: false,
    });
  }
  console.log(`[Setup] Created ${notes.length} mock notes`);

  let current = notes.filter(n => !n.spent);
  let round = 0;
  while (current.length > 1) {
    round++;
    console.log(`\n[Round ${round}] Notes before: ${current.length}`);
    const nextRound = [];
    for (let i = 0; i < current.length; i += 8) {
      const batch = current.slice(i, i + 8);
      if (batch.length === 0) continue;
      const inputNullifiers = batch.map(n => n.nullifier);
      const outputCommitment = randomHex();
      // Prove consolidate (mock)—just pass empty publicInputs since mock accepts any
      await http(`/prove/consolidate`, { publicInputs: [] });
      // Relay consolidate
      const resp = await http(`/relay/consolidate`, {
        proof: '0xdeadbeef',
        publicInputs: inputNullifiers,
        inputNullifiers,
        outputCommitment,
      });
      // Mark spent & append new note
      batch.forEach(n => (n.spent = true));
      const newNote = {
        commitment: outputCommitment,
        nullifier: randomHex(),
        amount: (batch.length * 1_000_000).toString(),
        leafIndex: notes.length,
        spent: false,
      };
      notes.push(newNote);
      nextRound.push(newNote);
      console.log(`[Round ${round}] Consolidated ${batch.length} → 1 (sig ${resp.signature})`);
    }
    current = nextRound;
    console.log(`[Round ${round}] Notes after: ${current.length}`);
  }

  const final = current[0];
  const totalAtoms = notes.filter(n => !n.spent).reduce((s, n) => s + Number(n.amount), 0);
  console.log(`[Final] Single note amount atoms: ${final.amount}, expected total: ${totalAtoms}`);

  // Withdraw: public inputs are [merkleRoot, receiver, nullifier, amount]
  await http('/prove/withdraw', { publicInputs: [randomHex(), randomHex(), final.nullifier, final.amount] });
  const recipientAta = 'RecipientFakeAta1111111111111111111111111111111';
  const withdrawResp = await http('/relay/withdraw', {
    proof: '0xdeadbeef',
    publicInputs: [final.nullifier, final.amount],
    amount: final.amount,
    nullifier: final.nullifier,
    recipientAta,
    mint: NOC_MINT,
    collectFee: true,
  });
  console.log(`[Withdraw] Relayed with signature: ${withdrawResp.signature}`);
  console.log('=== Test complete: PASS ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
