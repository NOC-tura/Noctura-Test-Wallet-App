import { poseidonHash } from './constants.js';

export type Note = {
  secret: bigint;
  amount: bigint;
  tokenMint: bigint;
  blinding: bigint;
  rho: bigint;
  commitment: bigint;
  nullifier: bigint;
};

export function createNote(params: {
  secret: bigint;
  amount: bigint;
  tokenMint: bigint;
  blinding: bigint;
  rho: bigint;
}): Note {
  const commitment = poseidonHash([params.secret, params.amount, params.tokenMint, params.blinding]);
  const nullifier = poseidonHash([params.secret, params.rho]);
  return { ...params, commitment, nullifier };
}
