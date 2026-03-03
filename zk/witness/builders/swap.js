function serializeSwapWitness({
  inputNote,
  merkleProof,
  outAmount,
  outTokenMint,
  outSecret,
  outBlinding
}) {
  return {
    // Input note
    inSecret: inputNote.secret.toString(),
    inAmount: inputNote.amount.toString(),
    inTokenMint: inputNote.tokenMint.toString(),
    inBlinding: inputNote.blinding.toString(),
    inRho: inputNote.rho.toString(),
    // Merkle proof
    pathElements: merkleProof.pathElements.map((x) => x.toString()),
    pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProof.root.toString(),
    // Output note
    outSecret: outSecret.toString(),
    outAmount: outAmount.toString(),
    outTokenMint: outTokenMint.toString(),
    outBlinding: outBlinding.toString(),
    // Public inputs
    nullifier: inputNote.nullifier.toString(),
    expectedOutAmount: outAmount.toString()
  };
}
function serializeSwapPublicInputs(witness) {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier),
    BigInt(witness.expectedOutAmount)
  ];
}
export {
  serializeSwapPublicInputs,
  serializeSwapWitness
};
