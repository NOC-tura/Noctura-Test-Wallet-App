/**
 * Wallet Scanner for Automatic Private Transfer Discovery
 * 
 * Scans the blockchain for encrypted notes and attempts to decrypt them
 * using the user's view key. Successfully decrypted notes are automatically
 * added to the user's shielded balance.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { getECDHPrivateKey } from './shieldedKeys';
import { decryptNoteWithViewKey, deserializeEncryptedNote, NotePayload } from './ecdhEncryption';
import { 
  getLocalNoteRegistry, 
  updateLastScannedSlot, 
  addNoteRegistryEntry,
  NoteRegistryEntry 
} from './noteRegistry';
import { SOLANA_RPC } from './constants';

// Program ID for Noctura Shield
const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Scanner configuration
const SCAN_INTERVAL_MS = 30_000; // Scan every 30 seconds
const MAX_SIGNATURES_PER_SCAN = 100;

export interface ScanResult {
  newNotesFound: number;
  notesForMe: DecryptedIncomingNote[];
  lastScannedSlot: number;
  scannedSignatures: number;
}

export interface DecryptedIncomingNote {
  notePayload: NotePayload;
  commitment: string;
  signature: string;
  slot: number;
}

/**
 * Scanner state
 */
let scannerInterval: NodeJS.Timeout | null = null;
let isScanning = false;
let onNewNoteCallback: ((note: DecryptedIncomingNote) => void) | null = null;

/**
 * Start the background scanner
 */
export function startScanner(
  keypair: Keypair,
  onNewNote: (note: DecryptedIncomingNote) => void
): void {
  if (scannerInterval) {
    console.log('[Scanner] Already running');
    return;
  }
  
  onNewNoteCallback = onNewNote;
  
  console.log('[Scanner] Starting background scanner...');
  
  // Initial scan
  scanForIncomingNotes(keypair).catch(err => {
    console.error('[Scanner] Initial scan failed:', err);
  });
  
  // Set up periodic scanning
  scannerInterval = setInterval(() => {
    scanForIncomingNotes(keypair).catch(err => {
      console.error('[Scanner] Periodic scan failed:', err);
    });
  }, SCAN_INTERVAL_MS);
}

/**
 * Stop the background scanner
 */
export function stopScanner(): void {
  if (scannerInterval) {
    clearInterval(scannerInterval);
    scannerInterval = null;
    onNewNoteCallback = null;
    console.log('[Scanner] Stopped');
  }
}

/**
 * Check if scanner is running
 */
export function isScannerRunning(): boolean {
  return scannerInterval !== null;
}

/**
 * Perform a single scan for incoming notes
 */
export async function scanForIncomingNotes(keypair: Keypair): Promise<ScanResult> {
  if (isScanning) {
    console.log('[Scanner] Scan already in progress, skipping...');
    return { newNotesFound: 0, notesForMe: [], lastScannedSlot: 0, scannedSignatures: 0 };
  }
  
  isScanning = true;
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const registry = getLocalNoteRegistry();
  
  try {
    console.log('[Scanner] Scanning for new notes since slot:', registry.lastScannedSlot);
    
    // Get recent signatures for the program
    const signatures = await connection.getSignaturesForAddress(
      PROGRAM_ID,
      { limit: MAX_SIGNATURES_PER_SCAN },
      'confirmed'
    );
    
    if (signatures.length === 0) {
      console.log('[Scanner] No new transactions found');
      return { newNotesFound: 0, notesForMe: [], lastScannedSlot: registry.lastScannedSlot, scannedSignatures: 0 };
    }
    
    // Filter to signatures we haven't seen
    const newSignatures = signatures.filter(sig => 
      sig.slot > registry.lastScannedSlot && !sig.err
    );
    
    console.log('[Scanner] Found', newSignatures.length, 'new transactions to check');
    
    // Get ECDH private key for decryption
    const ecdhPrivateKey = getECDHPrivateKey(keypair);
    
    const notesForMe: DecryptedIncomingNote[] = [];
    let newNotesFound = 0;
    
    // Process each transaction
    for (const sigInfo of newSignatures) {
      try {
        // Fetch transaction details
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx || !tx.meta) continue;
        
        // Look for encrypted notes in transaction logs/memos
        const encryptedNotes = extractEncryptedNotesFromTx(tx);
        
        for (const { commitment, encryptedData } of encryptedNotes) {
          newNotesFound++;
          
          // Try to decrypt
          const decryptedPayload = decryptNoteWithViewKey(encryptedData, ecdhPrivateKey);
          
          if (decryptedPayload) {
            console.log('[Scanner] 🎉 Found note for me! Amount:', decryptedPayload.amount);
            
            const incoming: DecryptedIncomingNote = {
              notePayload: decryptedPayload,
              commitment,
              signature: sigInfo.signature,
              slot: sigInfo.slot,
            };
            
            notesForMe.push(incoming);
            
            // Add to registry
            addNoteRegistryEntry({
              commitment,
              encryptedNote: encryptedData,
              slot: sigInfo.slot,
              signature: sigInfo.signature,
              createdAt: Date.now(),
            });
            
            // Notify callback
            if (onNewNoteCallback) {
              onNewNoteCallback(incoming);
            }
          }
        }
      } catch (err) {
        console.warn('[Scanner] Error processing transaction:', sigInfo.signature.slice(0, 16), err);
      }
    }
    
    // Update last scanned slot
    const maxSlot = Math.max(...signatures.map(s => s.slot));
    updateLastScannedSlot(maxSlot);
    
    console.log('[Scanner] Scan complete. Found', notesForMe.length, 'notes for me out of', newNotesFound, 'total');
    
    return {
      newNotesFound,
      notesForMe,
      lastScannedSlot: maxSlot,
      scannedSignatures: newSignatures.length,
    };
  } finally {
    isScanning = false;
  }
}

/**
 * Extract encrypted notes from a transaction
 * Looks in logs for our custom format and in memo program data
 */
function extractEncryptedNotesFromTx(tx: any): Array<{ commitment: string; encryptedData: any }> {
  const results: Array<{ commitment: string; encryptedData: any }> = [];
  
  // Look in transaction logs for our encrypted note format
  const logs: string[] = tx.meta?.logMessages || [];
  
  for (const log of logs) {
    // Look for our marker: "EncryptedNote:<commitment>|<data>"
    if (log.includes('EncryptedNote:')) {
      const dataStart = log.indexOf('EncryptedNote:') + 'EncryptedNote:'.length;
      const data = log.slice(dataStart).trim();
      
      // Parse commitment|encrypted_data format
      const firstPipe = data.indexOf('|');
      if (firstPipe > 0) {
        const commitment = data.slice(0, firstPipe);
        const encryptedDataStr = data.slice(firstPipe + 1);
        const encryptedData = deserializeEncryptedNote(encryptedDataStr);
        
        if (encryptedData) {
          results.push({ commitment, encryptedData });
        }
      }
    }
    
    // Also look for noctura: prefix (from memo program)
    if (log.includes('noctura:')) {
      const dataStart = log.indexOf('noctura:') + 'noctura:'.length;
      const encryptedDataStr = log.slice(dataStart).trim();
      const encryptedData = deserializeEncryptedNote(encryptedDataStr);
      
      if (encryptedData) {
        // For noctura: format, commitment is inside the encrypted data
        // We'll use a placeholder and let decryption reveal the actual commitment
        results.push({ commitment: 'encrypted', encryptedData });
      }
    }
  }
  
  // Check transaction memo instructions for memo program
  // Memo program ID: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
  const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  
  if (tx.transaction?.message?.instructions) {
    for (const ix of tx.transaction.message.instructions) {
      // Check if this is a memo instruction
      const programId = tx.transaction.message.accountKeys?.[ix.programIdIndex]?.toString?.();
      if (programId === MEMO_PROGRAM_ID) {
        try {
          // Memo data is base58 encoded in instruction data
          const memoData = ix.data;
          if (typeof memoData === 'string') {
            // Decode base58 memo data
            const decoded = Buffer.from(memoData, 'base64').toString('utf-8');
            
            if (decoded.startsWith('noctura:')) {
              const encryptedDataStr = decoded.slice('noctura:'.length);
              const encryptedData = deserializeEncryptedNote(encryptedDataStr);
              
              if (encryptedData) {
                results.push({ commitment: 'encrypted', encryptedData });
                console.log('[Scanner] Found encrypted note in memo');
              }
            }
          }
        } catch (e) {
          // Ignore decode errors
        }
      }
    }
  }
  
  return results;
}

/**
 * Manual scan trigger (for UI button)
 */
export async function triggerManualScan(keypair: Keypair): Promise<ScanResult> {
  console.log('[Scanner] Manual scan triggered');
  return scanForIncomingNotes(keypair);
}

/**
 * Get scanner status for UI
 */
export function getScannerStatus(): { running: boolean; lastScan: number } {
  const registry = getLocalNoteRegistry();
  return {
    running: isScannerRunning(),
    lastScan: registry.lastScannedSlot,
  };
}
