import { describe, it, expect, vi } from 'vitest';
import { encryptSensitiveData, decryptSensitiveData } from '../utils/encryption';

// Simple mock for crypto.subtle
const mockCrypto = {
  subtle: {
    importKey: vi.fn(),
    deriveKey: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }),
};

// Mock globalThis.crypto
vi.stubGlobal('crypto', mockCrypto);

describe('Encryption utilities', () => {
  const mockMasterKey = new Uint8Array(32).fill(42);
  const mockDerivedKey = { type: 'secret' } as CryptoKey;
  const mockNonce = new Uint8Array(12).fill(1);
  const mockEncrypted = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);

  it('encrypts sensitive data with AES-GCM', async () => {
    // Setup mocks
    mockCrypto.subtle.importKey.mockResolvedValue(mockDerivedKey);
    mockCrypto.subtle.deriveKey.mockResolvedValue(mockDerivedKey);
    mockCrypto.subtle.encrypt.mockResolvedValue(mockEncrypted.buffer);
    mockCrypto.getRandomValues.mockReturnValue(mockNonce);

    const data = { amount: '1000000' };
    const result = await encryptSensitiveData(data, mockMasterKey);

    expect(result).toHaveProperty('encrypted');
    expect(result).toHaveProperty('nonce');
    expect(result).toHaveProperty('authTag');
    expect(typeof result.encrypted).toBe('string');
    expect(typeof result.nonce).toBe('string');
    expect(typeof result.authTag).toBe('string');
  });

  it('decrypts sensitive data successfully', async () => {
    const plaintext = JSON.stringify({ amount: '1000000' });
    const plaintextBytes = new TextEncoder().encode(plaintext);

    // Setup mocks
    mockCrypto.subtle.importKey.mockResolvedValue(mockDerivedKey);
    mockCrypto.subtle.deriveKey.mockResolvedValue(mockDerivedKey);
    mockCrypto.subtle.decrypt.mockResolvedValue(plaintextBytes.buffer);

    const encrypted = {
      encrypted: 'AQIDBA==',
      nonce: 'AQEBAQEBAQEBAQEBAg==',
      authTag: 'AQIDBA==',
    };

    const result = await decryptSensitiveData(encrypted, mockMasterKey);
    expect(result).toEqual({ amount: '1000000' });
  });

  it('round-trip encryption and decryption', async () => {
    // More realistic round-trip test
    const originalData = { amount: '5000000', token: 'NOC' };
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(originalData));
    
    // Setup encrypt mocks
    mockCrypto.subtle.importKey.mockResolvedValue(mockDerivedKey);
    mockCrypto.subtle.deriveKey.mockResolvedValue(mockDerivedKey);
    mockCrypto.subtle.encrypt.mockResolvedValue(mockEncrypted.buffer);
    mockCrypto.getRandomValues.mockReturnValue(mockNonce);

    const encrypted = await encryptSensitiveData(originalData, mockMasterKey);

    // Setup decrypt mocks
    mockCrypto.subtle.decrypt.mockResolvedValue(plaintextBytes.buffer);

    const decrypted = await decryptSensitiveData(encrypted, mockMasterKey);
    expect(decrypted).toEqual(originalData);
  });
});
