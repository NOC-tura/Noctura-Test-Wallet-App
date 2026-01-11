// Cryptographic randomness helpers for commitments and entropy checks
export function generateSecureRandomBytes(length: number): Uint8Array {
  if (length <= 0) throw new Error('length must be positive');
  const bytes = new Uint8Array(length);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure randomness unavailable: crypto.getRandomValues missing');
  }
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateCommitmentRandomness(): Uint8Array {
  return generateSecureRandomBytes(32);
}

export function verifyEntropyQuality(randomBytes: Uint8Array): boolean {
  if (randomBytes.length === 0) return false;
  // Basic sanity: ensure not all zeros and not trivially repeating
  const first = randomBytes[0];
  const allSame = randomBytes.every((b) => b === first);
  if (allSame) return false;
  const nonZero = randomBytes.some((b) => b !== 0);
  return nonZero;
}
