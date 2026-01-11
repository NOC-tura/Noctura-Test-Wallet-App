import { buildPoseidon } from 'circomlibjs';
import { generateSecureRandomBytes } from './crypto';

type Poseidon = Awaited<ReturnType<typeof buildPoseidon>>;
let poseidonInstance: Promise<Poseidon> | null = null;

async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    poseidonInstance = buildPoseidon();
  }
  return poseidonInstance;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, '0');
    hex += h;
  }
  return BigInt(`0x${hex || '0'}`);
}

function formatZkHash(hex: string): string {
  const clean = hex.replace(/^0x/i, '').padStart(64, '0');
  const head = clean.slice(0, 4);
  const tail = clean.slice(-3);
  return `0x${head}...${tail} (ZK-Hash)`;
}

/**
 * Generate privacy-preserving ZK-Hash for address display.
 * Domain-separated Poseidon hash over recipientPubkey || tokenMint || amount || randomness.
 */
export async function generateZKHashDisplay(
  recipientPubkey: Uint8Array,
  tokenMint: Uint8Array,
  amount: bigint,
  randomness: Uint8Array,
): Promise<string> {
  const poseidon = await getPoseidon();
  const domain = 1n; // simple domain separation tag
  const hash = poseidon([domain, bytesToBigInt(recipientPubkey), bytesToBigInt(tokenMint), amount, bytesToBigInt(randomness)]);
  const hashBig = poseidon.F.toObject(hash) as bigint;
  const hex = hashBig.toString(16);
  return formatZkHash(hex);
}

/**
 * Generate 32 bytes of cryptographically secure randomness for commitments.
 */
export function generateSecureRandomness(): Uint8Array {
  return generateSecureRandomBytes(32);
}
