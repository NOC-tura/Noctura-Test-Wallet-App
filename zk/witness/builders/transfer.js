export function serializeTransferWitness({ inputNote, merkleProof, outputNote1, outputNote2 }) {
    return {
        inSecret: inputNote.secret.toString(),
        inAmount: inputNote.amount.toString(),
        tokenMint: inputNote.tokenMint.toString(),
        blinding: inputNote.blinding.toString(),
        rho: inputNote.rho.toString(),
        pathElements: merkleProof.pathElements.map((x) => x.toString()),
        pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
        merkleRoot: merkleProof.root.toString(),
        outSecret1: outputNote1.secret.toString(),
        outAmount1: outputNote1.amount.toString(),
        outBlinding1: outputNote1.blinding.toString(),
        outSecret2: outputNote2.secret.toString(),
        outAmount2: outputNote2.amount.toString(),
        outBlinding2: outputNote2.blinding.toString(),
        nullifier: inputNote.nullifier.toString(),
    };
}
export function serializeTransferPublicInputs(witness) {
    return [
        BigInt(witness.merkleRoot),
        BigInt(witness.nullifier),
    ];
}
