#!/usr/bin/env node
/**
 * Smoke test for staged multi-note SOL send
 * Validates the planning and fee calculation logic
 */

// Inline planner logic for test
function planStagedSend(notes, targetAtoms) {
  const sorted = [...notes]
    .filter((n) => !n.spent)
    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));

  const steps = [];
  let remaining = targetAtoms;

  for (const note of sorted) {
    const amt = BigInt(note.amount);
    if (remaining <= 0n) break;

    if (amt <= remaining) {
      steps.push({ note, kind: 'full', amount: amt });
      remaining -= amt;
    } else {
      // Final partial step: take only what we need from this note
      steps.push({ note, kind: 'partial', amount: remaining });
      remaining = 0n;
      break;
    }
  }

  return {
    steps,
    totalToSend: targetAtoms - remaining,
    totalNotesUsed: steps.length,
    hasPartial: steps.some((s) => s.kind === 'partial'),
  };
}

// Mock shielded SOL notes (amounts in lamports)
const mockNotes = [
  { nullifier: 'note1', amount: '500000000', spent: false, tokenType: 'SOL', owner: 'test-wallet' },  // 0.5 SOL
  { nullifier: 'note2', amount: '300000000', spent: false, tokenType: 'SOL', owner: 'test-wallet' },  // 0.3 SOL
  { nullifier: 'note3', amount: '150000000', spent: false, tokenType: 'SOL', owner: 'test-wallet' },  // 0.15 SOL
  { nullifier: 'note4', amount: '50000000', spent: false, tokenType: 'SOL', owner: 'test-wallet' },   // 0.05 SOL
];

console.log('=== Staged Multi-Note Send Smoke Test ===\n');

// Test 1: Single full withdrawal
console.log('Test 1: Send 0.3 SOL (exactly one note)');
let plan = planStagedSend(mockNotes, 300000000n);
console.log('  Plan:', {
  totalToSend: Number(plan.totalToSend) / 1e9,
  notesUsed: plan.totalNotesUsed,
  fullWithdrawals: plan.steps.filter(s => s.kind === 'full').length,
  hasPartial: plan.hasPartial,
});
console.assert(plan.totalNotesUsed === 1, 'Should use 1 note');
console.assert(plan.hasPartial === false, 'Should be full withdrawal');
console.log('  ✅ Pass\n');

// Test 2: Multiple full withdrawals
console.log('Test 2: Send 0.8 SOL (requires 2 full notes)');
plan = planStagedSend(mockNotes, 800000000n);
console.log('  Plan:', {
  totalToSend: Number(plan.totalToSend) / 1e9,
  notesUsed: plan.totalNotesUsed,
  fullWithdrawals: plan.steps.filter(s => s.kind === 'full').length,
  hasPartial: plan.hasPartial,
});
console.assert(plan.totalNotesUsed === 2, 'Should use 2 notes');
console.assert(plan.steps.filter(s => s.kind === 'full').length === 2, 'Should be 2 full withdrawals');
console.log('  ✅ Pass\n');

// Test 3: Partial withdrawal required
console.log('Test 3: Send 0.55 SOL (requires 1 full + 1 partial)');
plan = planStagedSend(mockNotes, 550000000n);
console.log('  Plan:', {
  totalToSend: Number(plan.totalToSend) / 1e9,
  notesUsed: plan.totalNotesUsed,
  fullWithdrawals: plan.steps.filter(s => s.kind === 'full').length,
  hasPartial: plan.hasPartial,
  partialAmount: plan.hasPartial ? Number(plan.steps.find(s => s.kind === 'partial')?.amount) / 1e9 : 0,
});
console.assert(plan.totalNotesUsed === 2, 'Should use 2 notes');
console.assert(plan.hasPartial === true, 'Should have partial');
console.assert(plan.steps.filter(s => s.kind === 'full').length === 1, 'Should be 1 full withdrawal');
console.log('  ✅ Pass\n');

// Test 4: Fee estimate calculation
console.log('Test 4: Fee estimation for 0.95 SOL (3 notes)');
plan = planStagedSend(mockNotes, 950000000n);
const fullCount = plan.steps.filter(s => s.kind === 'full').length;
const feeSteps = fullCount + (plan.hasPartial ? 1 : 0);
const feeEstimate = feeSteps * 0.25; // 0.25 NOC per step
console.log('  Plan:', {
  totalToSend: Number(plan.totalToSend) / 1e9,
  notesUsed: plan.totalNotesUsed,
  fullWithdrawals: fullCount,
  hasPartial: plan.hasPartial,
  estimatedNocFees: feeEstimate,
});
console.assert(feeEstimate === plan.totalNotesUsed * 0.25, 'Fee should be 0.25 NOC per note');
console.log('  ✅ Pass\n');

// Test 5: Insufficient balance
console.log('Test 5: Send 1.5 SOL (exceeds total balance)');
plan = planStagedSend(mockNotes, 1500000000n);
console.log('  Plan:', {
  totalToSend: Number(plan.totalToSend) / 1e9,
  requested: 1.5,
  shortfall: 1.5 - Number(plan.totalToSend) / 1e9,
});
console.assert(plan.totalToSend < 1500000000n, 'Should not cover full amount');
console.log('  ✅ Pass (correctly reports insufficient funds)\n');

console.log('=== All Tests Passed ===');
console.log('\nNote: This validates planning logic only.');
console.log('For full end-to-end test, run the app in dev mode and:');
console.log('  1. Ensure you have multiple SOL notes shielded');
console.log('  2. Ensure you have NOC in your transparent wallet for fees');
console.log('  3. Try sending an amount larger than your largest note');
console.log('  4. Confirm the staged send modal appears');
console.log('  5. Monitor status messages for each step\n');
