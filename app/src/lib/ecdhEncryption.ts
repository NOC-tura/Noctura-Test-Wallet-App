/**
 * ECDH Encryption for Shielded Note Transfer
 * 
 * Encrypts note details to recipient's shielded public key so they can
 * automatically discover and claim incoming payments without manual note sharing.
 * 
 * Uses secp256k1 ECDH + ChaCha20-Poly1305 for authenticated encryption.
 * 
 * COMPACT ENCODING: Uses binary format instead of JSON to fit in Solana memo limits
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes, bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';

// HKDF info string as Uint8Array (required by @noble/hashes)
const HKDF_INFO = new TextEncoder().encode('noctura/encrypt/v1');

// Compact encoding version
const COMPACT_VERSION = 1;

/**
 * Encrypted note payload structure
 */
export interface EncryptedNotePayload {
  ephemeralPubkey: string;  // Hex-encoded ephemeral public key (33 bytes compressed)
  nonce: string;            // Hex-encoded nonce (12 bytes)
  ciphertext: string;       // Hex-encoded encrypted data
}

/**
 * Plaintext note data to be encrypted
 */
export interface NotePayload {
  amount: string;           // Amount as string (bigint)
  tokenMint: string;        // Token mint field as string (bigint)
  secret: string;           // Note secret as string (bigint)
  blinding: string;         // Blinding factor as string (bigint)
  rho: string;              // Rho (randomness) as string (bigint)
  commitment: string;       // Note commitment as string (bigint)
  tokenType: 'SOL' | 'NOC'; // Token type for display
  memo?: string;            // Optional memo from sender
}

/**
 * Convert bigint to fixed-size bytes (32 bytes, big-endian)
 */
function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = value < 0n ? -value : value; // Handle negative values
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
}

/**
 * Convert bytes to bigint (32 bytes, big-endian)
 */
function bytes32ToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Serialize note payload to compact binary format
 * Format: version(1) + tokenType(1) + amount(32) + secret(32) + blinding(32) + rho(32) + commitment(32)
 * Total: 162 bytes (vs ~500+ bytes for JSON)
 */
function serializeNotePayloadCompact(payload: NotePayload): Uint8Array {
  const data = new Uint8Array(162);
  let offset = 0;
  
  // Version (1 byte)
  data[offset++] = COMPACT_VERSION;
  
  // Token type (1 byte: 0=SOL, 1=NOC)
  data[offset++] = payload.tokenType === 'SOL' ? 0 : 1;
  
  // Amount (32 bytes)
  const amount = bigintToBytes32(BigInt(payload.amount));
  data.set(amount, offset);
  offset += 32;
  
  // Secret (32 bytes)
  const secret = bigintToBytes32(BigInt(payload.secret));
  data.set(secret, offset);
  offset += 32;
  
  // Blinding (32 bytes)
  const blinding = bigintToBytes32(BigInt(payload.blinding));
  data.set(blinding, offset);
  offset += 32;
  
  // Rho (32 bytes)
  const rho = bigintToBytes32(BigInt(payload.rho));
  data.set(rho, offset);
  offset += 32;
  
  // Commitment (32 bytes)
  const commitment = bigintToBytes32(BigInt(payload.commitment));
  data.set(commitment, offset);
  
  return data;
}

/**
 * Deserialize note payload from compact binary format
 */
function deserializeNotePayloadCompact(data: Uint8Array): NotePayload | null {
  try {
    if (data.length < 162) return null;
    
    let offset = 0;
    
    // Version check
    const version = data[offset++];
    if (version !== COMPACT_VERSION) {
      console.warn('[ECDH] Unknown compact version:', version);
      return null;
    }
    
    // Token type
    const tokenTypeCode = data[offset++];
    const tokenType = tokenTypeCode === 0 ? 'SOL' : 'NOC';
    
    // Amount
    const amount = bytes32ToBigint(data.slice(offset, offset + 32)).toString();
    offset += 32;
    
    // Secret
    const secret = bytes32ToBigint(data.slice(offset, offset + 32)).toString();
    offset += 32;
    
    // Blinding
    const blinding = bytes32ToBigint(data.slice(offset, offset + 32)).toString();
    offset += 32;
    
    // Rho
    const rho = bytes32ToBigint(data.slice(offset, offset + 32)).toString();
    offset += 32;
    
    // Commitment
    const commitment = bytes32ToBigint(data.slice(offset, offset + 32)).toString();
    
    // TokenMint derived from tokenType
    // SOL uses simple constant '1', NOC uses the expected field value
    const EXPECTED_NOC_TOKEN_MINT_FIELD = '10573237895933377819207813447621407372083533411926671627115170254672242817572';
    const tokenMint = tokenType === 'SOL' ? '1' : EXPECTED_NOC_TOKEN_MINT_FIELD;
    
    return {
      amount,
      tokenMint,
      secret,
      blinding,
      rho,
      commitment,
      tokenType,
    };
  } catch (err) {
    console.error('[ECDH] Failed to deserialize compact payload:', err);
    return null;
  }
}

/**
 * Encrypt note details to recipient's shielded public key using ECDH
 * Uses compact binary encoding to fit in Solana memo limits
 * 
 * @param recipientPubkey - Recipient's shielded public key (33 bytes compressed)
 * @param notePayload - The note details to encrypt
 * @returns Encrypted payload that can be posted on-chain
 */
export function encryptNoteToRecipient(
  recipientPubkey: Uint8Array,
  notePayload: NotePayload
): EncryptedNotePayload {
  // Generate ephemeral keypair for this single transfer
  const ephemeralPrivkey = randomBytes(32);
  const ephemeralPubkey = secp256k1.getPublicKey(ephemeralPrivkey, true); // compressed
  
  // Compute ECDH shared secret
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivkey, recipientPubkey, true);
  
  // Derive encryption key from shared secret using HKDF
  const encryptionKey = hkdf(sha256, sharedPoint, undefined, HKDF_INFO, 32);
  
  // Serialize the note payload using compact binary format
  const plaintext = serializeNotePayloadCompact(notePayload);
  
  // Generate random nonce for ChaCha20-Poly1305
  const nonce = randomBytes(12);
  
  // Encrypt with ChaCha20-Poly1305 (authenticated encryption)
  const cipher = chacha20poly1305(encryptionKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  
  return {
    ephemeralPubkey: bytesToHex(ephemeralPubkey),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
}

/**
 * Attempt to decrypt an encrypted note using view key
 * Supports both compact binary format (v1) and legacy JSON format
 * 
 * @param encryptedPayload - The encrypted note from on-chain
 * @param ecdhPrivateKey - Recipient's ECDH private key (derived from view key context)
 * @returns Decrypted note payload, or null if decryption fails (not for us)
 */
export function decryptNoteWithViewKey(
  encryptedPayload: EncryptedNotePayload,
  ecdhPrivateKey: Uint8Array
): NotePayload | null {
  try {
    // Decode components
    const ephemeralPubkey = hexToBytes(encryptedPayload.ephemeralPubkey);
    const nonce = hexToBytes(encryptedPayload.nonce);
    const ciphertext = hexToBytes(encryptedPayload.ciphertext);
    
    // Compute ECDH shared secret (same as sender computed)
    const sharedPoint = secp256k1.getSharedSecret(ecdhPrivateKey, ephemeralPubkey, true);
    
    // Derive same encryption key
    const encryptionKey = hkdf(sha256, sharedPoint, undefined, HKDF_INFO, 32);
    
    // Decrypt with ChaCha20-Poly1305
    const cipher = chacha20poly1305(encryptionKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    
    // Try compact binary format first (check version byte)
    if (plaintext.length >= 162 && plaintext[0] === COMPACT_VERSION) {
      const compactResult = deserializeNotePayloadCompact(plaintext);
      if (compactResult) {
        return compactResult;
      }
    }
    
    // Fallback to legacy JSON format
    const payloadJson = new TextDecoder().decode(plaintext);
    const notePayload: NotePayload = JSON.parse(payloadJson);
    
    return notePayload;
  } catch (err) {
    // Decryption failed - this note is not for us (silent failure is expected)
    return null;
  }
}

/**
 * Serialize encrypted payload to a compact string for on-chain storage
 */
export function serializeEncryptedNote(payload: EncryptedNotePayload): string {
  // Format: ephemeralPubkey|nonce|ciphertext (all hex)
  return `${payload.ephemeralPubkey}|${payload.nonce}|${payload.ciphertext}`;
}

/**
 * Deserialize encrypted payload from on-chain string
 */
export function deserializeEncryptedNote(data: string): EncryptedNotePayload | null {
  try {
    const parts = data.split('|');
    if (parts.length !== 3) return null;
    
    return {
      ephemeralPubkey: parts[0],
      nonce: parts[1],
      ciphertext: parts[2],
    };
  } catch {
    return null;
  }
}

/**
 * Calculate the on-chain storage size for an encrypted note
 * Used for rent calculation
 * 
 * Compact format sizes:
 * - ephemeralPubkey: 33 bytes = 66 hex chars
 * - nonce: 12 bytes = 24 hex chars
 * - ciphertext: 162 bytes plaintext + 16 bytes auth tag = 178 bytes = 356 hex chars
 * - separators: 2 chars
 * - "noctura:" prefix: 8 chars
 * Total: ~456 chars (well under 566 byte memo limit)
 */
export function getEncryptedNoteSize(): number {
  return 500; // Buffer for slightly larger payloads
}

/**
 * Validate that a public key is a valid secp256k1 compressed pubkey
 */
export function isValidSecp256k1Pubkey(pubkey: Uint8Array): boolean {
  if (pubkey.length !== 33) return false;
  if (pubkey[0] !== 0x02 && pubkey[0] !== 0x03) return false;
  try {
    // Try to get the shared secret with a dummy key - will throw if pubkey is invalid
    const dummyPrivkey = new Uint8Array(32).fill(1);
    secp256k1.getSharedSecret(dummyPrivkey, pubkey, true);
    return true;
  } catch {
    return false;
  }
}
