import { poseidon } from 'circomlibjs';
export const TREE_HEIGHT = 20;
export const ZERO = BigInt(0);
export function poseidonHash(inputs) {
    const normalized = inputs.map((input) => BigInt(input));
    return poseidon(normalized);
}
