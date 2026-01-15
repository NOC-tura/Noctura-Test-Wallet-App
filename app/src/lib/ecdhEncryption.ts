/**
 * ECDH Encryption for Shielded Note Transfer
 * 
 * Encrypts note details to recipient's shielded public key so they can
 * automatically discover and claim incoming payments without manual note sharing.
 * 
 * Uses secp256k1 ECDH + ChaCha20-Poly1305 for authenticated encryption.
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

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
 * Encrypt note details to recipient's shielded public key using ECDH
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
  const encryptionKey = hkdf(sha256, sharedPoint, undefined, 'noctura/encrypt/v1', 32);
  
  // Serialize the note payload
  const payloadJson = JSON.stringify(notePayload);
  const plaintext = new TextEncoder().encode(payloadJson);
  
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
    const encryptionKey = hkdf(sha256, sharedPoint, undefined, 'noctura/encrypt/v1', 32);
    
    // Decrypt with ChaCha20-Poly1305
    const cipher = chacha20poly1305(encryptionKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    
    // Parse JSON
    const payloadJson = new TextDecoder().decode(plaintext);
    const notePayload: NotePayload = JSON.parse(payloadJson);
    
    return notePayload;
  } catch (err) {
    // Decryption failed - this note is not for us
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
 */
export function getEncryptedNoteSize(): number {
  // Typical sizes:
  // - ephemeralPubkey: 33 bytes (compressed) = 66 hex chars
  // - nonce: 12 bytes = 24 hex chars
  // - ciphertext: ~300 bytes (JSON payload + auth tag) = ~600 hex chars
  // - separators: 2 bytes
  // Total: ~700 bytes typical
  return 800; // Buffer for larger payloads
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
