/** Base and variable fees for shielded transactions */
export function calculateNOCFee(
  transactionType: 'transfer' | 'deposit' | 'withdraw',
  numberOfNotes: number,
  priorityLane = false,
): number {
  let fee = 0.05; // base NOC fee

  // Complexity adjustments
  if (numberOfNotes > 5) fee += 0.02;
  if (numberOfNotes > 10) fee += 0.03; // cumulative +0.05

  // Priority lane surcharge
  if (priorityLane) fee += 0.15;

  return fee;
}

export const SOL_FEE_LAMPORTS = 50_000; // 0.000005 SOL
export const SOL_FEE = 0.000005;

export function validateMinimumNOC(shieldedNOCBalance: number): boolean {
  const MIN_NOC_REQUIRED = 0.25;
  return shieldedNOCBalance >= MIN_NOC_REQUIRED;
}
