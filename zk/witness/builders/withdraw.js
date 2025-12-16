export function serializeWithdrawWitness({ inputNote, merkleProof, receiver }) {
    return {
        inSecret: inputNote.secret.toString(),
        inAmount: inputNote.amount.toString(),
        tokenMint: inputNote.tokenMint.toString(),
        blinding: inputNote.blinding.toString(),
        rho: inputNote.rho.toString(),
        pathElements: merkleProof.pathElements.map((x) => x.toString()),
        pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
        merkleRoot: merkleProof.root.toString(),
        receiver: receiver.toString(),
        nullifier: inputNote.nullifier.toString(),
    };
}
export function serializeWithdrawPublicInputs(witness) {
    return [
        BigInt(witness.merkleRoot),
        BigInt(witness.receiver),
        BigInt(witness.nullifier),
        BigInt(witness.inAmount),
    ];
}
