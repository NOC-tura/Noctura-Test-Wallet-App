import { PublicKey } from '@solana/web3.js';
import {
  createNote,
  serializeDepositPublicInputs,
  serializeDepositWitness,
  fieldToBytesBE,
  Note,
  DepositWitness,
} from '@zk-witness/index';
import { ShieldedNoteRecord } from '../types/shield';

const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const NOC_DECIMALS = 6;

function randomScalar(): bigint {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('Secure randomness unavailable in this environment');
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

export function pubkeyToField(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

export function parseNocAmount(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  const fracPadded = (frac + '0'.repeat(NOC_DECIMALS)).slice(0, NOC_DECIMALS);
  const wholePart = BigInt(whole || '0') * 10n ** BigInt(NOC_DECIMALS);
  const fracPart = BigInt(fracPadded || '0');
  return wholePart + fracPart;
}

// Create a new note with random secrets for a given amount and token
export function createNoteFromSecrets(amountAtoms: bigint, tokenMint: PublicKey): Note {
  return createNote({
    secret: randomScalar(),
    amount: amountAtoms,
    tokenMint: pubkeyToField(tokenMint),
    blinding: randomScalar(),
    rho: randomScalar(),
  });
}

export type PreparedDeposit = {
  note: Note;
  witness: DepositWitness;
  publicInputs: [bigint, bigint];
  publicInputsBytes: [Uint8Array, Uint8Array];
};

export function prepareDeposit(amountAtoms: bigint, tokenMint: PublicKey): PreparedDeposit {
  const note = createNote({
    secret: randomScalar(),
    amount: amountAtoms,
    tokenMint: pubkeyToField(tokenMint),
    blinding: randomScalar(),
    rho: randomScalar(),
  });
  const witness = serializeDepositWitness({ note });
  const publicInputs = serializeDepositPublicInputs(note);
  const publicInputsBytes: [Uint8Array, Uint8Array] = [
    fieldToBytesBE(publicInputs[0]),
    fieldToBytesBE(publicInputs[1]),
  ];
  return { note, witness, publicInputs, publicInputsBytes };
}

export function snapshotNote(
  note: Note,
  owner: PublicKey,
  tokenMint: PublicKey | null,
  overrides?: Partial<ShieldedNoteRecord>,
): ShieldedNoteRecord {
  return {
    commitment: note.commitment.toString(),
    nullifier: note.nullifier.toString(),
    amount: note.amount.toString(),
    tokenMintField: note.tokenMint.toString(),
    tokenMintAddress: tokenMint ? tokenMint.toBase58() : 'NATIVE_SOL',
    owner: owner.toBase58(),
    secret: note.secret.toString(),
    blinding: note.blinding.toString(),
    rho: note.rho.toString(),
    leafIndex: overrides?.leafIndex ?? 0,
    spent: overrides?.spent,
    createdAt: overrides?.createdAt ?? Date.now(),
    signature: overrides?.signature,
    tokenType: overrides?.tokenType,  // Include token type (NOC or SOL)
  };
}
