/**
 * Shielded Key Derivation and Management
 * 
 * Per Privacy Guide, each user has a complete key hierarchy:
 * - Spend Key (sk_spend): Private, used to authorize spending notes
 * - View Key (sk_view): Private, used to scan/decrypt incoming notes  
 * - Nullifier Key (sk_nullifier): Private, separate key for computing nullifiers
 * - Shielded Public Key (pk_shielded): Public, shareable address
 * 
 * KEY SEPARATION RATIONALE:
 * The nullifier key is separate from the spend key for security modularity.
 * This allows:
 * - Viewing keys to be shared without compromising spend/nullifier ability
 * - Nullifier computation isolated from spending authorization
 * - Better key compromise recovery scenarios
 * 
 * Keys are derived deterministically from the master seed using HKDF (RFC 5869).
 */

import { Keypair } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import * as secp256k1 from '@noble/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// Field modulus for BN254 (same as circuit)
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Derivation paths (HKDF info strings) - converted to bytes
const encoder = new TextEncoder();
const SPEND_KEY_INFO = encoder.encode('noctura/spend/v1');
const VIEW_KEY_INFO = encoder.encode('noctura/view/v1');
const NULLIFIER_KEY_INFO = encoder.encode('noctura/nullifier/v1');  // NEW: Separate nullifier key
const SHIELDED_PK_INFO = encoder.encode('noctura/shielded/v1');

export interface ShieldedKeyPair {
  spendKey: Uint8Array;        // 32 bytes - for authorizing spending
  viewKey: Uint8Array;         // 32 bytes - for scanning/decrypting
  nullifierKey: Uint8Array;    // 32 bytes - for computing nullifiers (SEPARATE)
  shieldedPublicKey: Uint8Array; // 33 bytes compressed secp256k1 pubkey
  shieldedAddress: string;     // Bech32-like encoded address for sharing
  // Additional fields for convenience
  viewKeyPrivate: Uint8Array;  // ECDH private key for decryption
  publicKey: Uint8Array;       // Alias for shieldedPublicKey
}

/**
 * Derive shielded keys from a Solana keypair's secret key
 * 
 * Key Hierarchy (per Privacy Guide):
 * Master Seed (from wallet)
 *   ├── Spend Key (sk_spend) - Authorizes spending
 *   ├── View Key (sk_view) - Decrypts incoming notes
 *   ├── Nullifier Key (sk_nullifier) - Computes nullifiers (SEPARATE for security)
 *   └── ECDH Keypair - For note encryption/decryption
 */
export function deriveShieldedKeys(solanaKeypair: Keypair): ShieldedKeyPair {
  const masterSeed = solanaKeypair.secretKey.slice(0, 32); // Use first 32 bytes as master seed
  
  // Derive spend key using HKDF
  const spendKey = hkdf(sha256, masterSeed, undefined, SPEND_KEY_INFO, 32);
  
  // Derive view key using HKDF (different info string)
  const viewKey = hkdf(sha256, masterSeed, undefined, VIEW_KEY_INFO, 32);
  
  // Derive SEPARATE nullifier key (per Privacy Guide security requirement)
  // This is distinct from spend key for security modularity
  const nullifierKey = hkdf(sha256, masterSeed, undefined, NULLIFIER_KEY_INFO, 32);
  
  // Derive shielded public key (secp256k1)
  // Use a separate derivation for the ECDH keypair
  const ecdhSeed = hkdf(sha256, masterSeed, undefined, SHIELDED_PK_INFO, 32);
  const shieldedPublicKey = secp256k1.getPublicKey(ecdhSeed, true); // compressed
  
  // Encode as shielded address (custom format)
  const shieldedAddress = encodeShieldedAddress(shieldedPublicKey);
  
  return {
    spendKey,
    viewKey,
    nullifierKey,           // NEW: Separate nullifier key
    shieldedPublicKey,
    shieldedAddress,
    viewKeyPrivate: ecdhSeed,  // ECDH private key for decryption
    publicKey: shieldedPublicKey, // Alias for convenience
  };
}

/**
 * Get the ECDH private key for decryption (derived from view key context)
 */
export function getECDHPrivateKey(solanaKeypair: Keypair): Uint8Array {
  const masterSeed = solanaKeypair.secretKey.slice(0, 32);
  return hkdf(sha256, masterSeed, undefined, SHIELDED_PK_INFO, 32);
}

/**
 * Encode shielded public key as a shareable address
 * Format: noctura1<base58 encoded pubkey>
 */
export function encodeShieldedAddress(publicKey: Uint8Array): string {
  // Use a simple hex encoding with prefix for now
  // In production, use Bech32 for better UX and error detection
  const hex = bytesToHex(publicKey);
  return `noctura1${hex}`;
}

/**
 * Decode a shielded address back to public key bytes
 */
export function decodeShieldedAddress(address: string): Uint8Array {
  if (!address.startsWith('noctura1')) {
    throw new Error('Invalid shielded address format');
  }
  const hex = address.slice(8); // Remove 'noctura1' prefix
  return hexToBytes(hex);
}

/**
 * Validate a shielded address
 */
export function isValidShieldedAddress(address: string): boolean {
  try {
    const pubkey = decodeShieldedAddress(address);
    // Verify it's a valid secp256k1 compressed public key (33 bytes, starts with 02 or 03)
    if (pubkey.length !== 33) return false;
    if (pubkey[0] !== 0x02 && pubkey[0] !== 0x03) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert spend key to a field element for use in ZK circuits
 */
export function spendKeyToField(spendKey: Uint8Array): bigint {
  let value = 0n;
  for (const byte of spendKey) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

/**
 * Convert view key to a field element
 */
export function viewKeyToField(viewKey: Uint8Array): bigint {
  let value = 0n;
  for (const byte of viewKey) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

/**
 * Derive a nullifier from NULLIFIER KEY and note data
 * IMPORTANT: Uses the separate nullifier key, NOT the spend key
 * 
 * nullifier = hash(nullifierKey, commitment, rho)
 * 
 * This separation ensures that even if spend key is compromised,
 * nullifier computation requires the nullifier key.
 */
export function deriveNullifierFromNullifierKey(
  nullifierKey: Uint8Array,
  commitment: bigint,
  rho: bigint
): bigint {
  const data = new Uint8Array(96); // 32 + 32 + 32
  data.set(nullifierKey, 0);
  
  // Convert commitment to bytes
  const commitmentBytes = bigintToBytes32(commitment);
  data.set(commitmentBytes, 32);
  
  // Convert rho to bytes
  const rhoBytes = bigintToBytes32(rho);
  data.set(rhoBytes, 64);
  
  const hash = sha256(data);
  let value = 0n;
  for (const byte of hash) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

/**
 * @deprecated Use deriveNullifierFromNullifierKey with the separate nullifier key
 * Kept for backward compatibility during migration
 * 
 * Derive a nullifier from spend key and note data
 * nullifier = hash(spendKey, commitment, rho)
 */
export function deriveNullifierFromSpendKey(
  spendKey: Uint8Array,
  commitment: bigint,
  rho: bigint
): bigint {
  // Log deprecation warning in development
  console.warn('[DEPRECATED] deriveNullifierFromSpendKey: Use deriveNullifierFromNullifierKey instead');
  
  const data = new Uint8Array(96); // 32 + 32 + 32
  data.set(spendKey, 0);
  
  // Convert commitment to bytes
  const commitmentBytes = bigintToBytes32(commitment);
  data.set(commitmentBytes, 32);
  
  // Convert rho to bytes
  const rhoBytes = bigintToBytes32(rho);
  data.set(rhoBytes, 64);
  
  const hash = sha256(data);
  let value = 0n;
  for (const byte of hash) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

/**
 * Helper: Convert bigint to 32 bytes (big-endian)
 */
function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
}

/**
 * Helper: Convert bytes to bigint (big-endian)
 */
export function bytes32ToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Convert nullifier key to a field element for use in ZK circuits
 */
export function nullifierKeyToField(nullifierKey: Uint8Array): bigint {
  let value = 0n;
  for (const byte of nullifierKey) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

/**
 * Derive a viewing-only key package (can decrypt but not spend)
 * 
 * This creates a key set that allows:
 * - Decrypting incoming notes
 * - Viewing balance
 * - Verifying transaction history
 * 
 * But does NOT allow:
 * - Spending notes
 * - Computing nullifiers
 */
export function deriveViewingOnlyKeys(solanaKeypair: Keypair): {
  viewKey: Uint8Array;
  viewKeyPrivate: Uint8Array;
  shieldedPublicKey: Uint8Array;
  shieldedAddress: string;
} {
  const masterSeed = solanaKeypair.secretKey.slice(0, 32);
  
  const viewKey = hkdf(sha256, masterSeed, undefined, VIEW_KEY_INFO, 32);
  const ecdhSeed = hkdf(sha256, masterSeed, undefined, SHIELDED_PK_INFO, 32);
  const shieldedPublicKey = secp256k1.getPublicKey(ecdhSeed, true);
  
  return {
    viewKey,
    viewKeyPrivate: ecdhSeed,
    shieldedPublicKey,
    shieldedAddress: encodeShieldedAddress(shieldedPublicKey),
  };
}
