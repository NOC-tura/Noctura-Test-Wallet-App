import { ShieldedNoteRecord } from '../types/shield';

export type WithdrawalStep = {
  note: ShieldedNoteRecord;
  kind: 'full' | 'partial';
  amount: bigint; // amount to deliver to recipient (for 'full' it's the full note amount)
};

export type WithdrawalPlan = {
  steps: WithdrawalStep[];
  totalToSend: bigint;
  totalNotesUsed: number;
  hasPartial: boolean;
};

/**
 * Plan a staged send across multiple notes using a greedy largest-first strategy.
 * - Uses full withdrawals for earlier notes
 * - Uses a partial (split + withdraw) for the final remainder, if needed
 */
export function planStagedSend(
  notes: ShieldedNoteRecord[],
  targetAtoms: bigint,
): WithdrawalPlan {
  const sorted = [...notes]
    .filter((n) => !n.spent)
    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));

  const steps: WithdrawalStep[] = [];
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
