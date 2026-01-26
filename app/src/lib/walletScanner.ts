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
// Memo Program ID - we also scan memo transactions for encrypted notes
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// Relayer fee payer address - used to find memo transactions sent by relayer
const RELAYER_FEE_PAYER = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');

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
let currentKeypairPublicKey: string | null = null; // Track which wallet is being scanned

/**
 * Start the background scanner
 */
export function startScanner(
  keypair: Keypair,
  onNewNote: (note: DecryptedIncomingNote) => void
): void {
  const newPublicKey = keypair.publicKey.toBase58();
  
  // If scanner is running for a different wallet, stop it first
  if (scannerInterval && currentKeypairPublicKey !== newPublicKey) {
    console.log('[Scanner] Wallet changed, restarting scanner for new wallet:', newPublicKey.slice(0, 8) + '...');
    stopScanner();
  }
  
  if (scannerInterval) {
    console.log('[Scanner] Already running for this wallet');
    return;
  }
  
  currentKeypairPublicKey = newPublicKey;
  onNewNoteCallback = onNewNote;
  
  console.log('[Scanner] Starting background scanner for wallet:', newPublicKey.slice(0, 8) + '...');
  
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
    currentKeypairPublicKey = null;
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
  const walletAddress = keypair.publicKey.toBase58();
  const registry = getLocalNoteRegistry(walletAddress); // Per-wallet registry
  
  try {
    console.log('[Scanner] Scanning for wallet:', walletAddress.slice(0, 8), '... since slot:', registry.lastScannedSlot);
    
    // Get recent signatures for the Noctura program
    const nocturaSigs = await connection.getSignaturesForAddress(
      PROGRAM_ID,
      { limit: MAX_SIGNATURES_PER_SCAN },
      'confirmed'
    );
    console.log('[Scanner] Noctura program signatures:', nocturaSigs.length);
    
    // Scan relayer fee payer for memo transactions with encrypted notes
    // This is needed because memo transactions are signed by the relayer, not the memo program
    console.log('[Scanner] Scanning relayer address:', RELAYER_FEE_PAYER.toBase58());
    const relayerSigs = await connection.getSignaturesForAddress(
      RELAYER_FEE_PAYER,
      { limit: MAX_SIGNATURES_PER_SCAN },
      'confirmed'
    );
    console.log('[Scanner] Relayer signatures:', relayerSigs.length);
    if (relayerSigs.length > 0) {
      console.log('[Scanner] First 5 relayer signatures:', relayerSigs.slice(0, 5).map(s => s.signature.slice(0, 20)));
    }
    
    // Combine and deduplicate signatures
    const allSignatures = [...nocturaSigs, ...relayerSigs];
    const signatureMap = new Map<string, typeof nocturaSigs[0]>();
    for (const sig of allSignatures) {
      if (!signatureMap.has(sig.signature)) {
        signatureMap.set(sig.signature, sig);
      }
    }
    const signatures = Array.from(signatureMap.values());
    
    if (signatures.length === 0) {
      console.log('[Scanner] No transactions found from either source');
      return { newNotesFound: 0, notesForMe: [], lastScannedSlot: registry.lastScannedSlot, scannedSignatures: 0 };
    }
    
    console.log('[Scanner] Total unique transactions from both sources:', signatures.length);
    console.log('[Scanner] Last scanned slot:', registry.lastScannedSlot);
    console.log('[Scanner] Latest tx slot:', Math.max(...signatures.map(s => s.slot)));
    
    // Filter to signatures we haven't seen
    const newSignatures = signatures.filter(sig => 
      sig.slot > registry.lastScannedSlot && !sig.err
    );
    
    console.log('[Scanner] Found', newSignatures.length, 'new transactions to check (after slot filter)');
    
    // Get ECDH private key for decryption
    const ecdhPrivateKey = getECDHPrivateKey(keypair);
    
    const notesForMe: DecryptedIncomingNote[] = [];
    let newNotesFound = 0;
    
    // Process each transaction
    for (const sigInfo of newSignatures) {
      try {
        console.log('[Scanner] Processing tx:', sigInfo.signature.slice(0, 20), '...');
        
        // Fetch transaction details
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx || !tx.meta) {
          continue;
        }
        
        // Look for encrypted notes in transaction logs/memos
        const encryptedNotes = extractEncryptedNotesFromTx(tx);
        
        for (const { commitment, encryptedData } of encryptedNotes) {
          newNotesFound++;
          
          // Try to decrypt
          console.log('[Scanner] Attempting to decrypt note...');
          const decryptedPayload = decryptNoteWithViewKey(encryptedData, ecdhPrivateKey);
          
          if (decryptedPayload) {
            console.log('[Scanner] 🎉 Found note for me! Amount:', decryptedPayload.amount, 'Token:', decryptedPayload.tokenType);
            
            const incoming: DecryptedIncomingNote = {
              notePayload: decryptedPayload,
              commitment,
              signature: sigInfo.signature,
              slot: sigInfo.slot,
            };
            
            notesForMe.push(incoming);
            
            // Add to registry (per-wallet)
            addNoteRegistryEntry({
              commitment,
              encryptedNote: encryptedData,
              slot: sigInfo.slot,
              signature: sigInfo.signature,
              createdAt: Date.now(),
            }, walletAddress);
            
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
    
    // Update last scanned slot (per-wallet)
    const maxSlot = Math.max(...signatures.map(s => s.slot));
    updateLastScannedSlot(maxSlot, walletAddress);
    
    console.log('[Scanner] Scan complete for wallet:', walletAddress.slice(0, 8), '... Found', notesForMe.length, 'notes for me out of', newNotesFound, 'total');
    
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
    // Format can be: noctura:<encryptedData> or noctura:<txRef>:<encryptedData>
    // Log format from memo: "Program log: Memo (len X): \"noctura:...\""
    if (log.includes('noctura:')) {
      console.log('[Scanner] Found log with noctura: prefix');
      console.log('[Scanner] Full log:', log);
      console.log('[Scanner] Full log length:', log.length);
      
      const dataStart = log.indexOf('noctura:') + 'noctura:'.length;
      let encryptedDataStr = log.slice(dataStart).trim();
      
      // Remove trailing escaped quote if present (from memo log format)
      if (encryptedDataStr.endsWith('\\"')) {
        encryptedDataStr = encryptedDataStr.slice(0, -2);
      } else if (encryptedDataStr.endsWith('"')) {
        encryptedDataStr = encryptedDataStr.slice(0, -1);
      }
      
      // Check if there's a transaction reference (20 char prefix before next colon)
      const colonIndex = encryptedDataStr.indexOf(':');
      if (colonIndex === 20) {
        // Has transaction reference, skip it
        encryptedDataStr = encryptedDataStr.slice(21);
      }
      
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
  const MEMO_PROGRAM_ID_STR = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  
  if (tx.transaction?.message?.instructions) {
    for (const ix of tx.transaction.message.instructions) {
      // Check if this is a memo instruction
      const programId = tx.transaction.message.accountKeys?.[ix.programIdIndex]?.toString?.();
      if (programId === MEMO_PROGRAM_ID_STR) {
        try {
          // Memo data is base58 encoded in instruction data
          const memoData = ix.data;
          if (typeof memoData === 'string') {
            // Decode base58 memo data
            const decoded = Buffer.from(memoData, 'base64').toString('utf-8');
            
            if (decoded.startsWith('noctura:')) {
              let encryptedDataStr = decoded.slice('noctura:'.length);
              
              // Check if there's a transaction reference (20 char prefix before next colon)
              const colonIndex = encryptedDataStr.indexOf(':');
              if (colonIndex === 20) {
                // Has transaction reference, skip it
                encryptedDataStr = encryptedDataStr.slice(21);
              }
              
              const encryptedData = deserializeEncryptedNote(encryptedDataStr);
              
              if (encryptedData) {
                results.push({ commitment: 'encrypted', encryptedData });
                console.log('[Scanner] Found encrypted note in memo instruction');
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
