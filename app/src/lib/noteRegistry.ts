/**
 * Note Registry for Automatic Private Transfer Discovery
 * 
 * Stores encrypted notes alongside commitments so recipients can automatically
 * discover incoming payments by scanning and attempting decryption.
 */

import { EncryptedNotePayload } from './ecdhEncryption';

/**
 * A note registry entry stored on-chain or locally
 */
export interface NoteRegistryEntry {
  // On-chain data
  commitment: string;           // The on-chain commitment (hex or bigint string)
  encryptedNote: EncryptedNotePayload; // Encrypted payload
  slot: number;                 // Solana slot when created
  signature: string;            // Transaction signature that created this entry
  
  // Metadata
  createdAt: number;            // Unix timestamp
  merkleLeafIndex?: number;     // Index in the Merkle tree (if known)
}

/**
 * Local registry state stored in localStorage
 */
export interface NoteRegistryState {
  version: number;
  lastScannedSlot: number;      // Last slot we scanned for new notes
  entries: NoteRegistryEntry[]; // All discovered encrypted notes
}

const REGISTRY_STORAGE_KEY = 'noctura.noteRegistry';
const REGISTRY_VERSION = 1;

/**
 * Get storage key for a specific wallet (or global if not specified)
 */
function getStorageKey(walletAddress?: string): string {
  if (walletAddress) {
    return `${REGISTRY_STORAGE_KEY}.${walletAddress}`;
  }
  return REGISTRY_STORAGE_KEY;
}

/**
 * Get the note registry from localStorage
 * @param walletAddress - If provided, gets wallet-specific registry (for per-wallet scanning)
 */
export function getLocalNoteRegistry(walletAddress?: string): NoteRegistryState {
  const raw = localStorage.getItem(getStorageKey(walletAddress));
  if (!raw) {
    return {
      version: REGISTRY_VERSION,
      lastScannedSlot: 0,
      entries: [],
    };
  }
  
  try {
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || REGISTRY_VERSION,
      lastScannedSlot: parsed.lastScannedSlot || 0,
      entries: parsed.entries || [],
    };
  } catch {
    return {
      version: REGISTRY_VERSION,
      lastScannedSlot: 0,
      entries: [],
    };
  }
}

/**
 * Save the note registry to localStorage
 * @param walletAddress - If provided, saves to wallet-specific registry
 */
export function saveLocalNoteRegistry(state: NoteRegistryState, walletAddress?: string): void {
  localStorage.setItem(getStorageKey(walletAddress), JSON.stringify(state));
}

/**
 * Add a new entry to the note registry
 * @param walletAddress - If provided, adds to wallet-specific registry
 */
export function addNoteRegistryEntry(entry: NoteRegistryEntry, walletAddress?: string): void {
  const registry = getLocalNoteRegistry(walletAddress);
  
  // Check for duplicates by commitment
  const exists = registry.entries.some(e => e.commitment === entry.commitment);
  if (exists) {
    console.log('[NoteRegistry] Entry already exists for commitment:', entry.commitment.slice(0, 16));
    return;
  }
  
  registry.entries.push(entry);
  saveLocalNoteRegistry(registry, walletAddress);
  console.log('[NoteRegistry] Added new entry:', entry.commitment.slice(0, 16));
}

/**
 * Update last scanned slot
 * @param walletAddress - If provided, updates wallet-specific slot
 */
export function updateLastScannedSlot(slot: number, walletAddress?: string): void {
  const registry = getLocalNoteRegistry(walletAddress);
  registry.lastScannedSlot = Math.max(registry.lastScannedSlot, slot);
  saveLocalNoteRegistry(registry, walletAddress);
}

/**
 * Get entries since a given slot (for incremental scanning)
 * @param walletAddress - If provided, gets from wallet-specific registry
 */
export function getEntriesSinceSlot(slot: number, walletAddress?: string): NoteRegistryEntry[] {
  const registry = getLocalNoteRegistry(walletAddress);
  return registry.entries.filter(e => e.slot > slot);
}

/**
 * Clear the note registry (for debugging/reset)
 * @param walletAddress - If provided, clears wallet-specific registry
 */
export function clearNoteRegistry(walletAddress?: string): void {
  localStorage.removeItem(getStorageKey(walletAddress));
  console.log('[NoteRegistry] Cleared all entries', walletAddress ? `for wallet ${walletAddress.slice(0, 8)}...` : '(global)');
}

/**
 * Prune old entries that have been processed
 * Keeps entries for the last N slots for reorg safety
 * @param walletAddress - If provided, prunes wallet-specific registry
 */
export function pruneOldEntries(maxAgeSlots: number = 100000, walletAddress?: string): void {
  const registry = getLocalNoteRegistry(walletAddress);
  const cutoffSlot = registry.lastScannedSlot - maxAgeSlots;
  
  const before = registry.entries.length;
  registry.entries = registry.entries.filter(e => e.slot > cutoffSlot);
  const after = registry.entries.length;
  
  if (before !== after) {
    saveLocalNoteRegistry(registry, walletAddress);
    console.log(`[NoteRegistry] Pruned ${before - after} old entries`);
  }
}
