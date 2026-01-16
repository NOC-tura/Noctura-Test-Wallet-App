/**
 * Encrypted Local Storage for Shielded Notes
 * 
 * All sensitive shielded data (notes, keys, balances) is encrypted
 * with AES-256-GCM before storing in localStorage.
 * 
 * Security features:
 * - AES-256-GCM authenticated encryption
 * - Key derived from wallet password + salt using PBKDF2
 * - Random IV per encryption operation
 * - Tamper detection via authentication tag
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { randomBytes, bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';

// Storage configuration
const STORAGE_VERSION = 1;
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Encrypted data structure stored in localStorage
 */
interface EncryptedBlob {
  version: number;
  salt: string;      // Hex-encoded salt for key derivation
  iv: string;        // Hex-encoded initialization vector
  ciphertext: string; // Hex-encoded encrypted data
  tag: string;       // Hex-encoded authentication tag
}

/**
 * Storage keys for different data types
 */
export const ENCRYPTED_STORAGE_KEYS = {
  SHIELDED_NOTES: 'noctura.encrypted.notes',
  PRIVATE_CONTACTS: 'noctura.encrypted.contacts',
  VIEWING_KEYS: 'noctura.encrypted.viewkeys',
  TRANSACTION_HISTORY: 'noctura.encrypted.history',
  SETTINGS: 'noctura.encrypted.settings',
} as const;

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  // Copy Uint8Array to new ArrayBuffer for Web Crypto compatibility
  const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer;
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-256-GCM
 * 
 * @param data - Data to encrypt (will be JSON stringified)
 * @param password - User's wallet password
 * @returns Encrypted blob ready for storage
 */
export async function encryptData<T>(data: T, password: string): Promise<EncryptedBlob> {
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  
  // Derive encryption key
  const key = await deriveKey(password, salt);
  
  // Copy IV to new ArrayBuffer for Web Crypto compatibility
  const ivBuffer = new Uint8Array(iv).buffer as ArrayBuffer;
  
  // Serialize and encrypt
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    plaintext
  );
  
  // AES-GCM returns ciphertext + tag concatenated
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -16);
  const tag = encryptedArray.slice(-16);
  
  return {
    version: STORAGE_VERSION,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
    tag: bytesToHex(tag),
  };
}

/**
 * Decrypt data with AES-256-GCM
 * 
 * @param blob - Encrypted blob from storage
 * @param password - User's wallet password
 * @returns Decrypted data
 * @throws Error if decryption fails (wrong password or tampered data)
 */
export async function decryptData<T>(blob: EncryptedBlob, password: string): Promise<T> {
  if (blob.version !== STORAGE_VERSION) {
    throw new Error(`Unsupported storage version: ${blob.version}`);
  }
  
  const salt = hexToBytes(blob.salt);
  const iv = hexToBytes(blob.iv);
  const ciphertext = hexToBytes(blob.ciphertext);
  const tag = hexToBytes(blob.tag);
  
  // Derive key with same salt
  const key = await deriveKey(password, salt);
  
  // Reconstruct encrypted data (ciphertext + tag)
  const encryptedData = concatBytes(ciphertext, tag);
  
  // Copy IV and encrypted data to new ArrayBuffer for Web Crypto compatibility
  const ivBuffer = new Uint8Array(iv).buffer as ArrayBuffer;
  const dataBuffer = new Uint8Array(encryptedData).buffer as ArrayBuffer;
  
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      key,
      dataBuffer
    );
    
    const plaintext = new TextDecoder().decode(decrypted);
    return JSON.parse(plaintext) as T;
  } catch (err) {
    throw new Error('Decryption failed: Invalid password or corrupted data');
  }
}

/**
 * Store encrypted data in localStorage
 */
export async function setEncrypted<T>(
  key: string,
  data: T,
  password: string
): Promise<void> {
  const encrypted = await encryptData(data, password);
  localStorage.setItem(key, JSON.stringify(encrypted));
  console.log(`[EncryptedStorage] Saved encrypted data to ${key}`);
}

/**
 * Retrieve and decrypt data from localStorage
 */
export async function getEncrypted<T>(
  key: string,
  password: string
): Promise<T | null> {
  const stored = localStorage.getItem(key);
  if (!stored) {
    return null;
  }
  
  try {
    const blob: EncryptedBlob = JSON.parse(stored);
    return await decryptData<T>(blob, password);
  } catch (err) {
    console.error(`[EncryptedStorage] Failed to decrypt ${key}:`, err);
    throw err;
  }
}

/**
 * Check if encrypted data exists for a key
 */
export function hasEncryptedData(key: string): boolean {
  return localStorage.getItem(key) !== null;
}

/**
 * Remove encrypted data
 */
export function removeEncrypted(key: string): void {
  localStorage.removeItem(key);
  console.log(`[EncryptedStorage] Removed ${key}`);
}

/**
 * Re-encrypt all data with a new password (for password change)
 */
export async function reEncryptAll(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const keys = Object.values(ENCRYPTED_STORAGE_KEYS);
  
  for (const key of keys) {
    if (hasEncryptedData(key)) {
      try {
        // Decrypt with old password
        const data = await getEncrypted(key, oldPassword);
        // Re-encrypt with new password
        await setEncrypted(key, data, newPassword);
        console.log(`[EncryptedStorage] Re-encrypted ${key}`);
      } catch (err) {
        console.error(`[EncryptedStorage] Failed to re-encrypt ${key}:`, err);
        throw err;
      }
    }
  }
}

/**
 * Verify password is correct by attempting to decrypt a known key
 */
export async function verifyPassword(password: string): Promise<boolean> {
  // Try to decrypt any existing encrypted data
  for (const key of Object.values(ENCRYPTED_STORAGE_KEYS)) {
    if (hasEncryptedData(key)) {
      try {
        await getEncrypted(key, password);
        return true;
      } catch {
        return false;
      }
    }
  }
  // No encrypted data exists yet, password is valid for new storage
  return true;
}

/**
 * Export encrypted data for backup
 */
export function exportEncryptedBackup(): Record<string, string | null> {
  const backup: Record<string, string | null> = {};
  for (const key of Object.values(ENCRYPTED_STORAGE_KEYS)) {
    backup[key] = localStorage.getItem(key);
  }
  return backup;
}

/**
 * Import encrypted data from backup
 */
export function importEncryptedBackup(backup: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(backup)) {
    if (value !== null) {
      localStorage.setItem(key, value);
    }
  }
  console.log('[EncryptedStorage] Imported encrypted backup');
}
