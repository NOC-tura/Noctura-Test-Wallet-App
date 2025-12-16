export function serializeDepositWitness({ note }) {
    return {
        secret: note.secret.toString(),
        amount: note.amount.toString(),
        tokenMint: note.tokenMint.toString(),
        blinding: note.blinding.toString(),
        expectedCommitment: note.commitment.toString(),
    };
}
export function serializeDepositPublicInputs(note) {
    // Groth16 emits two identical public signals for this circuit (commitment twice).
    // Return both so on-chain verifier receives the vector size it expects.
    return [note.commitment, note.commitment];
}
