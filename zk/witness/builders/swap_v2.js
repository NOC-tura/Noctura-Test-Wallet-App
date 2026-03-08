export function serializeSwapV2Witness({ inputNote, merkleProof, swapAmount, expectedOutAmount, outTokenMint, outSecret, outBlinding, changeSecret, changeBlinding, }) {
    // Change amount = input amount - swap amount
    const changeAmount = inputNote.amount - swapAmount;
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
        // Swap parameters
        swapAmount: swapAmount.toString(),
        expectedOutAmount: expectedOutAmount.toString(),
        // Output 1: Swapped token
        outSecret: outSecret.toString(),
        outAmount: expectedOutAmount.toString(),
        outTokenMint: outTokenMint.toString(),
        outBlinding: outBlinding.toString(),
        // Output 2: Change
        changeSecret: changeSecret.toString(),
        changeAmount: changeAmount.toString(),
        changeBlinding: changeBlinding.toString(),
        // Public inputs
        nullifier: inputNote.nullifier.toString(),
    };
}
export function serializeSwapV2PublicInputs(witness) {
    return [
        BigInt(witness.merkleRoot),
        BigInt(witness.nullifier),
        BigInt(witness.expectedOutAmount),
        BigInt(witness.swapAmount),
    ];
}
