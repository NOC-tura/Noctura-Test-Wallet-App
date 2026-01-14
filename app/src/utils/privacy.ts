import { generateSecureRandomBytes } from './crypto';

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
 * Uses a simple hash combination for UI purposes.
 */
export async function generateZKHashDisplay(
  recipientPubkey: Uint8Array,
  tokenMint: Uint8Array,
  amount: bigint,
  randomness: Uint8Array,
): Promise<string> {
  // Simple hash for display purposes - combine all inputs
  const combined = new Uint8Array([
    ...recipientPubkey.slice(0, 16),
    ...tokenMint.slice(0, 16),
    ...new Uint8Array(new BigUint64Array([BigInt(amount) & 0xFFFFFFFFFFFFFFFFn]).buffer),
    ...randomness.slice(0, 16),
  ]);
  
  // Use Web Crypto API for hashing
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return formatZkHash(hashHex);
}

/**
 * Generate 32 bytes of cryptographically secure randomness for commitments.
 */
export function generateSecureRandomness(): Uint8Array {
  return generateSecureRandomBytes(32);
}
