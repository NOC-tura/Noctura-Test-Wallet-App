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
 * Get the note registry from localStorage
 */
export function getLocalNoteRegistry(): NoteRegistryState {
  const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
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
 */
export function saveLocalNoteRegistry(state: NoteRegistryState): void {
  localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Add a new entry to the note registry
 */
export function addNoteRegistryEntry(entry: NoteRegistryEntry): void {
  const registry = getLocalNoteRegistry();
  
  // Check for duplicates by commitment
  const exists = registry.entries.some(e => e.commitment === entry.commitment);
  if (exists) {
    console.log('[NoteRegistry] Entry already exists for commitment:', entry.commitment.slice(0, 16));
    return;
  }
  
  registry.entries.push(entry);
  saveLocalNoteRegistry(registry);
  console.log('[NoteRegistry] Added new entry:', entry.commitment.slice(0, 16));
}

/**
 * Update last scanned slot
 */
export function updateLastScannedSlot(slot: number): void {
  const registry = getLocalNoteRegistry();
  registry.lastScannedSlot = Math.max(registry.lastScannedSlot, slot);
  saveLocalNoteRegistry(registry);
}

/**
 * Get entries since a given slot (for incremental scanning)
 */
export function getEntriesSinceSlot(slot: number): NoteRegistryEntry[] {
  const registry = getLocalNoteRegistry();
  return registry.entries.filter(e => e.slot > slot);
}

/**
 * Clear the note registry (for debugging/reset)
 */
export function clearNoteRegistry(): void {
  localStorage.removeItem(REGISTRY_STORAGE_KEY);
  console.log('[NoteRegistry] Cleared all entries');
}

/**
 * Prune old entries that have been processed
 * Keeps entries for the last N slots for reorg safety
 */
export function pruneOldEntries(maxAgeSlots: number = 100000): void {
  const registry = getLocalNoteRegistry();
  const cutoffSlot = registry.lastScannedSlot - maxAgeSlots;
  
  const before = registry.entries.length;
  registry.entries = registry.entries.filter(e => e.slot > cutoffSlot);
  const after = registry.entries.length;
  
  if (before !== after) {
    saveLocalNoteRegistry(registry);
    console.log(`[NoteRegistry] Pruned ${before - after} old entries`);
  }
}
