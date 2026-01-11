/**
 * AES-256-GCM encryption for sensitive data at rest.
 * Key derived from wallet master seed.
 */

export interface EncryptedData {
  encrypted: string; // base64
  nonce: string; // base64
  authTag: string; // base64
}

async function getSubtleCrypto(): Promise<SubtleCrypto> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SubtleCrypto unavailable');
  }
  return globalThis.crypto.subtle;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert a Uint8Array view to a tightly-sized ArrayBuffer.
 * Ensures BufferSource compatibility across TS lib variations.
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}

/**
 * Derive encryption key from master key using PBKDF2.
 */
async function deriveKey(masterKey: Uint8Array): Promise<CryptoKey> {
  const subtle = await getSubtleCrypto();
  const importedKey = await subtle.importKey('raw', toArrayBuffer(masterKey), 'PBKDF2', false, ['deriveKey']);
  const salt = new Uint8Array([0x6e, 0x6f, 0x63, 0x74, 0x75, 0x72, 0x61, 0x00]); // "noctura\0"
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 100000, hash: 'SHA-256' },
    importedKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt sensitive data using AES-256-GCM.
 */
export async function encryptSensitiveData(data: unknown, masterKey: Uint8Array): Promise<EncryptedData> {
  const subtle = await getSubtleCrypto();
  const key = await deriveKey(masterKey);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(plaintext)
  );
  
  // Extract auth tag (last 16 bytes of ciphertext in GCM mode)
  const ciphertextBytes = new Uint8Array(ciphertext);
  const encrypted = ciphertextBytes.slice(0, -16);
  const authTag = ciphertextBytes.slice(-16);
  
  return {
    encrypted: bufferToBase64(encrypted.buffer),
    nonce: bufferToBase64(nonce.buffer),
    authTag: bufferToBase64(authTag.buffer),
  };
}

/**
 * Decrypt sensitive data.
 */
export async function decryptSensitiveData(encrypted: EncryptedData, masterKey: Uint8Array): Promise<unknown> {
  const subtle = await getSubtleCrypto();
  const key = await deriveKey(masterKey);
  
  const encryptedBytes = new Uint8Array(base64ToBuffer(encrypted.encrypted));
  const authTagBytes = new Uint8Array(base64ToBuffer(encrypted.authTag));
  const nonce = new Uint8Array(base64ToBuffer(encrypted.nonce));
  
  // Reconstruct ciphertext with auth tag
  const ciphertext = new Uint8Array(encryptedBytes.length + authTagBytes.length);
  ciphertext.set(encryptedBytes);
  ciphertext.set(authTagBytes, encryptedBytes.length);
  
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(ciphertext)
  );
  
  const decoded = new TextDecoder().decode(plaintext);
  return JSON.parse(decoded);
}

/**
 * Store transaction amount encrypted.
 */
export async function storeTransactionAmount(
  txId: string,
  amount: bigint,
  masterKey: Uint8Array
): Promise<void> {
  const encrypted = await encryptSensitiveData({ amount: amount.toString() }, masterKey);
  localStorage.setItem(`tx_amount_${txId}`, JSON.stringify(encrypted));
}

/**
 * Retrieve and decrypt transaction amount.
 */
export async function getTransactionAmount(
  txId: string,
  masterKey: Uint8Array
): Promise<bigint | null> {
  const stored = localStorage.getItem(`tx_amount_${txId}`);
  if (!stored) return null;
  
  try {
    const encrypted = JSON.parse(stored) as EncryptedData;
    const decrypted = await decryptSensitiveData(encrypted, masterKey) as { amount: string };
    return BigInt(decrypted.amount);
  } catch {
    return null;
  }
}
