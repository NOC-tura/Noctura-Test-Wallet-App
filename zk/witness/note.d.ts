export type Note = {
    secret: bigint;
    amount: bigint;
    tokenMint: bigint;
    blinding: bigint;
    rho: bigint;
    commitment: bigint;
    nullifier: bigint;
};
export declare function createNote(params: {
    secret: bigint;
    amount: bigint;
    tokenMint: bigint;
    blinding: bigint;
    rho: bigint;
}): Note;
