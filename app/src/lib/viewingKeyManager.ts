/**
 * Viewing Key Manager
 * 
 * Allows users to export viewing keys for read-only audit access.
 * Third parties can verify holdings without spending ability.
 * 
 * Per Privacy Guide:
 * - Viewing Key: Allows decrypting incoming notes
 * - Does NOT allow spending or creating nullifiers
 * - Perfect for accountants, auditors, or monitoring tools
 */

import { 
  deriveShieldedKeys, 
  encodeShieldedAddress,
  decodeShieldedAddress 
} from './shieldedKeys';
import { setEncrypted, getEncrypted, ENCRYPTED_STORAGE_KEYS } from './encryptedStorage';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

/**
 * Viewing key structure for export
 */
export interface ExportedViewingKey {
  version: number;
  label: string;                    // User-provided label
  noctura1Address: string;          // Associated shielded address
  viewingKeyPublic: string;         // Base58 encoded public viewing key
  viewingKeyPrivate: string;        // Base58 encoded private viewing key (ECDH)
  createdAt: number;                // Export timestamp
  expiresAt?: number;               // Optional expiration
  permissions: ViewingKeyPermissions;
}

/**
 * Permissions for viewing key
 */
export interface ViewingKeyPermissions {
  canViewBalance: boolean;          // Can see total shielded balance
  canViewHistory: boolean;          // Can see transaction history
  canViewNotes: boolean;            // Can see individual notes
  canViewContacts: boolean;         // Can see address book (usually false)
}

/**
 * Stored viewing key record
 */
export interface ViewingKeyRecord {
  id: string;
  label: string;
  exportedTo: string;               // Who received this key
  noctura1Address: string;
  createdAt: number;
  expiresAt?: number;
  revoked: boolean;
  revokedAt?: number;
  permissions: ViewingKeyPermissions;
}

/**
 * All stored viewing keys
 */
interface ViewingKeyStorage {
  version: number;
  records: ViewingKeyRecord[];
}

const VIEWING_KEY_VERSION = 1;

/**
 * Generate unique viewing key ID
 */
function generateViewingKeyId(): string {
  return `vk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * ViewingKeyManager - Manage viewing key exports
 */
export class ViewingKeyManager {
  private password: string;
  private storage: ViewingKeyStorage | null = null;
  private loaded = false;

  constructor(password: string) {
    this.password = password;
  }

  /**
   * Load viewing key records from encrypted storage
   */
  private async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const stored = await getEncrypted<ViewingKeyStorage>(
        ENCRYPTED_STORAGE_KEYS.VIEWING_KEYS,
        this.password
      );
      
      this.storage = stored || {
        version: VIEWING_KEY_VERSION,
        records: [],
      };
      
      this.loaded = true;
    } catch (err) {
      this.storage = {
        version: VIEWING_KEY_VERSION,
        records: [],
      };
      this.loaded = true;
    }
  }

  /**
   * Save viewing key records
   */
  private async save(): Promise<void> {
    if (!this.storage) return;
    await setEncrypted(
      ENCRYPTED_STORAGE_KEYS.VIEWING_KEYS,
      this.storage,
      this.password
    );
  }

  /**
   * Export a viewing key for third-party access
   */
  async exportViewingKey(
    wallet: Keypair,
    label: string,
    exportedTo: string,
    permissions: Partial<ViewingKeyPermissions> = {},
    expiresIn?: number // milliseconds until expiration
  ): Promise<ExportedViewingKey> {
    await this.load();

    // Derive shielded keys from wallet
    const shieldedKeys = deriveShieldedKeys(wallet);
    const noctura1Address = encodeShieldedAddress(shieldedKeys.publicKey);

    // Create viewing key export
    const now = Date.now();
    const exportedKey: ExportedViewingKey = {
      version: VIEWING_KEY_VERSION,
      label,
      noctura1Address,
      viewingKeyPublic: bs58.encode(shieldedKeys.publicKey),
      viewingKeyPrivate: bs58.encode(shieldedKeys.viewKeyPrivate),
      createdAt: now,
      expiresAt: expiresIn ? now + expiresIn : undefined,
      permissions: {
        canViewBalance: permissions.canViewBalance ?? true,
        canViewHistory: permissions.canViewHistory ?? true,
        canViewNotes: permissions.canViewNotes ?? true,
        canViewContacts: permissions.canViewContacts ?? false,
      },
    };

    // Store record of export
    const record: ViewingKeyRecord = {
      id: generateViewingKeyId(),
      label,
      exportedTo,
      noctura1Address,
      createdAt: now,
      expiresAt: exportedKey.expiresAt,
      revoked: false,
      permissions: exportedKey.permissions,
    };

    this.storage!.records.push(record);
    await this.save();

    console.log(`[ViewingKey] Exported viewing key: ${label} to ${exportedTo}`);
    return exportedKey;
  }

  /**
   * Get all viewing key records
   */
  async getRecords(): Promise<ViewingKeyRecord[]> {
    await this.load();
    return this.storage!.records;
  }

  /**
   * Get active (non-revoked, non-expired) viewing keys
   */
  async getActiveRecords(): Promise<ViewingKeyRecord[]> {
    await this.load();
    const now = Date.now();
    return this.storage!.records.filter(r => 
      !r.revoked && (!r.expiresAt || r.expiresAt > now)
    );
  }

  /**
   * Revoke a viewing key
   */
  async revokeViewingKey(id: string): Promise<void> {
    await this.load();
    
    const record = this.storage!.records.find(r => r.id === id);
    if (!record) {
      throw new Error('Viewing key record not found');
    }
    
    record.revoked = true;
    record.revokedAt = Date.now();
    await this.save();

    console.log(`[ViewingKey] Revoked viewing key: ${record.label}`);
  }

  /**
   * Delete a viewing key record
   */
  async deleteRecord(id: string): Promise<void> {
    await this.load();
    
    const index = this.storage!.records.findIndex(r => r.id === id);
    if (index === -1) {
      throw new Error('Viewing key record not found');
    }
    
    this.storage!.records.splice(index, 1);
    await this.save();
  }

  /**
   * Verify an imported viewing key
   */
  static verifyViewingKey(exportedKey: ExportedViewingKey): boolean {
    try {
      // Check version
      if (exportedKey.version !== VIEWING_KEY_VERSION) {
        console.warn('[ViewingKey] Version mismatch');
        return false;
      }

      // Check expiration
      if (exportedKey.expiresAt && exportedKey.expiresAt < Date.now()) {
        console.warn('[ViewingKey] Key has expired');
        return false;
      }

      // Verify address format
      const decoded = decodeShieldedAddress(exportedKey.noctura1Address);
      if (!decoded) {
        console.warn('[ViewingKey] Invalid noctura1 address');
        return false;
      }

      // Verify keys are valid base58
      bs58.decode(exportedKey.viewingKeyPublic);
      bs58.decode(exportedKey.viewingKeyPrivate);

      return true;
    } catch (err) {
      console.error('[ViewingKey] Verification failed:', err);
      return false;
    }
  }

  /**
   * Import and use a viewing key to scan for notes
   */
  static async useViewingKey(
    exportedKey: ExportedViewingKey
  ): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    permissions: ViewingKeyPermissions;
  } | null> {
    // Verify key first
    if (!this.verifyViewingKey(exportedKey)) {
      return null;
    }

    return {
      publicKey: bs58.decode(exportedKey.viewingKeyPublic),
      privateKey: bs58.decode(exportedKey.viewingKeyPrivate),
      permissions: exportedKey.permissions,
    };
  }
}

/**
 * Encode viewing key for sharing (as JSON string or QR code)
 */
export function encodeViewingKeyForSharing(key: ExportedViewingKey): string {
  return btoa(JSON.stringify(key));
}

/**
 * Decode shared viewing key
 */
export function decodeViewingKeyFromSharing(encoded: string): ExportedViewingKey | null {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

/**
 * Generate QR code data for viewing key
 */
export function getViewingKeyQRData(key: ExportedViewingKey): string {
  // Create compact representation for QR codes
  const compact = {
    v: key.version,
    a: key.noctura1Address,
    p: key.viewingKeyPublic,
    k: key.viewingKeyPrivate,
    e: key.expiresAt,
    r: [
      key.permissions.canViewBalance ? 1 : 0,
      key.permissions.canViewHistory ? 1 : 0,
      key.permissions.canViewNotes ? 1 : 0,
    ].join(''),
  };
  return `noctura-vk:${btoa(JSON.stringify(compact))}`;
}

/**
 * Create viewing key manager instance
 */
export function createViewingKeyManager(password: string): ViewingKeyManager {
  return new ViewingKeyManager(password);
}
