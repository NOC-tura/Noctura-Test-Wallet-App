export function serializePartialWithdrawWitness({ inputNote, merkleProof, withdrawAmount, changeNote, receiver }) {
    return {
        inSecret: inputNote.secret.toString(),
        inAmount: inputNote.amount.toString(),
        tokenMint: inputNote.tokenMint.toString(),
        blinding: inputNote.blinding.toString(),
        rho: inputNote.rho.toString(),
        pathElements: merkleProof.pathElements.map((x) => x.toString()),
        pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
        merkleRoot: merkleProof.root.toString(),
        withdrawAmount: withdrawAmount.toString(),
        changeSecret: changeNote.secret.toString(),
        changeAmount: changeNote.amount.toString(),
        changeBlinding: changeNote.blinding.toString(),
        nullifier: inputNote.nullifier.toString(),
        receiver: receiver.toString(),
    };
}
export function serializePartialWithdrawPublicInputs(witness) {
    return [
        BigInt(witness.merkleRoot),
        BigInt(witness.nullifier),
        BigInt(witness.receiver),
        BigInt(witness.withdrawAmount),
    ];
}
