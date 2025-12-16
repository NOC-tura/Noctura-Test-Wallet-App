import { poseidonHash } from './constants.js';
export function createNote(params) {
    const commitment = poseidonHash([params.secret, params.amount, params.tokenMint, params.blinding]);
    const nullifier = poseidonHash([params.secret, params.rho]);
    return { ...params, commitment, nullifier };
}
