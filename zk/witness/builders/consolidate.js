export function serializeConsolidateWitness({
  inputNotes,
  merkleProofs,
  outputNote,
}) {
  const MAX_INPUTS = 8;
  const TREE_HEIGHT = 20;

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

  // Pad input arrays to MAX_INPUTS (8) with zeros
  // CRITICAL: The circuit is compiled with Consolidate(8), so it expects exactly 8 values
  const paddedSecrets = [];
  const paddedAmounts = [];
  const paddedBlindings = [];
  const paddedRhos = [];
  const paddedNullifiers = [];
  
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

  // Pad merkle proofs to MAX_INPUTS (8) with zero-filled proofs
  const paddedPathElements = [];
  const paddedPathIndices = [];
  
  for (let i = 0; i < merkleProofs.length; i++) {
    paddedPathElements[i] = merkleProofs[i].pathElements.map((x) => x.toString());
    paddedPathIndices[i] = merkleProofs[i].pathIndices.map((x) => x.toString());
  }
  
  // Fill remaining merkle proof slots with zero arrays
  for (let i = merkleProofs.length; i < MAX_INPUTS; i++) {
    paddedPathElements[i] = Array(TREE_HEIGHT).fill('0');
    paddedPathIndices[i] = Array(TREE_HEIGHT).fill('0');
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

export function serializeConsolidatePublicInputs(
  inputNotes,
  merkleRoot,
) {
  return [...inputNotes.map((n) => n.nullifier), merkleRoot];
}
