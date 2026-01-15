import { PublicKey } from '@solana/web3.js';
import {
  createNote,
  serializeDepositPublicInputs,
  serializeDepositWitness,
  fieldToBytesBE,
  Note,
  DepositWitness,
} from '@zk-witness/index';
import { ShieldedNoteRecord } from '../types/shield';

const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const NOC_DECIMALS = 6;

function randomScalar(): bigint {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('Secure randomness unavailable in this environment');
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

export function pubkeyToField(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_MODULUS;
}

export function parseNocAmount(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  const fracPadded = (frac + '0'.repeat(NOC_DECIMALS)).slice(0, NOC_DECIMALS);
  const wholePart = BigInt(whole || '0') * 10n ** BigInt(NOC_DECIMALS);
  const fracPart = BigInt(fracPadded || '0');
  return wholePart + fracPart;
}

// Create a new note with random secrets for a given amount and token type
// For SOL: uses simple constant 1n for tokenMint field
// For NOC: uses poseidon hash of NOC_TOKEN_MINT
export function createNoteFromSecrets(amountAtoms: bigint, tokenType: 'SOL' | 'NOC'): Note {
  const tokenMintField = tokenType === 'SOL' ? 1n : BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
  return createNote({
    secret: randomScalar(),
    amount: amountAtoms,
    tokenMint: tokenMintField,
    blinding: randomScalar(),
    rho: randomScalar(),
  });
}

// Legacy function for backwards compatibility - converts PublicKey to tokenType
export function createNoteFromSecretsLegacy(amountAtoms: bigint, tokenMint: PublicKey): Note {
  return createNote({
    secret: randomScalar(),
    amount: amountAtoms,
    tokenMint: pubkeyToField(tokenMint),
    blinding: randomScalar(),
    rho: randomScalar(),
  });
}

export type PreparedDeposit = {
  note: Note;
  witness: DepositWitness;
  publicInputs: [bigint, bigint];
  publicInputsBytes: [Uint8Array, Uint8Array];
};

// Prepare deposit with token type (SOL or NOC)
// SOL uses simple constant 1n, NOC uses poseidon hash of mint
export function prepareDeposit(amountAtoms: bigint, tokenType: 'SOL' | 'NOC'): PreparedDeposit {
  const tokenMintField = tokenType === 'SOL' ? 1n : BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
  const note = createNote({
    secret: randomScalar(),
    amount: amountAtoms,
    tokenMint: tokenMintField,
    blinding: randomScalar(),
    rho: randomScalar(),
  });
  const witness = serializeDepositWitness({ note });
  const publicInputs = serializeDepositPublicInputs(note);
  const publicInputsBytes: [Uint8Array, Uint8Array] = [
    fieldToBytesBE(publicInputs[0]),
    fieldToBytesBE(publicInputs[1]),
  ];
  return { note, witness, publicInputs, publicInputsBytes };
}

export function snapshotNote(
  note: Note,
  owner: PublicKey,
  tokenType: 'SOL' | 'NOC',
  overrides?: Partial<ShieldedNoteRecord>,
): ShieldedNoteRecord {
  return {
    commitment: note.commitment.toString(),
    nullifier: note.nullifier.toString(),
    amount: note.amount.toString(),
    tokenMintField: note.tokenMint.toString(),
    tokenMintAddress: tokenType === 'SOL' ? 'NATIVE_SOL' : 'NOC_TOKEN',
    owner: owner.toBase58(),
    secret: note.secret.toString(),
    blinding: note.blinding.toString(),
    rho: note.rho.toString(),
    leafIndex: overrides?.leafIndex ?? 0,
    spent: overrides?.spent,
    createdAt: overrides?.createdAt ?? Date.now(),
    signature: overrides?.signature,
    tokenType: tokenType,  // SOL or NOC
  };
}

// Expected tokenMintField values for each token type
// SOL uses a simple constant (1n) for ZK circuits - no WSOL needed!
// NOC uses the poseidon hash of its mint address
export const EXPECTED_SOL_TOKEN_MINT_FIELD = '1'; // Simple constant for SOL
export const EXPECTED_NOC_TOKEN_MINT_FIELD = '10573237895933377819207813447621407372083533411926671627115170254672242817572';

/**
 * Get the ZK tokenMint field value for a given token type
 * SOL: Uses simple constant 1n
 * NOC: Uses poseidon hash of NOC_TOKEN_MINT
 */
export function getZkTokenMintField(tokenType: 'SOL' | 'NOC'): bigint {
  if (tokenType === 'SOL') {
    return 1n; // Simple constant for SOL
  } else {
    return BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
  }
}

/**
 * Check if a note is corrupted (tokenType doesn't match tokenMintField)
 * This can happen if notes were created before a bug fix where SOL deposits
 * incorrectly used NOC_TOKEN_MINT for the ZK note's tokenMint field.
 */
export function isNoteCorrupted(note: ShieldedNoteRecord): boolean {
  if (!note.tokenMintField) return true; // Missing field = corrupted
  
  if (note.tokenType === 'SOL') {
    // SOL notes should have simple constant '1'
    const isCorrect = note.tokenMintField === EXPECTED_SOL_TOKEN_MINT_FIELD;
    if (!isCorrect) {
      console.warn(`[isNoteCorrupted] SOL note has wrong tokenMintField:`, {
        nullifier: note.nullifier.slice(0, 16),
        expected: EXPECTED_SOL_TOKEN_MINT_FIELD,
        actual: note.tokenMintField.slice(0, 20) + '...',
      });
    }
    return !isCorrect;
  } else if (note.tokenType === 'NOC' || !note.tokenType) {
    // NOC notes should have NOC's tokenMintField
    const isCorrect = note.tokenMintField === EXPECTED_NOC_TOKEN_MINT_FIELD;
    if (!isCorrect) {
      console.warn(`[isNoteCorrupted] NOC note has wrong tokenMintField:`, {
        nullifier: note.nullifier.slice(0, 16),
        expected: EXPECTED_NOC_TOKEN_MINT_FIELD.slice(0, 20) + '...',
        actual: note.tokenMintField.slice(0, 20) + '...',
      });
    }
    return !isCorrect;
  }
  
  return false; // Unknown token type - assume not corrupted
}

/**
 * Filter out corrupted notes from a list
 */
export function filterCorruptedNotes(notes: ShieldedNoteRecord[]): ShieldedNoteRecord[] {
  const valid: ShieldedNoteRecord[] = [];
  const corrupted: ShieldedNoteRecord[] = [];
  
  for (const note of notes) {
    if (isNoteCorrupted(note)) {
      corrupted.push(note);
    } else {
      valid.push(note);
    }
  }
  
  if (corrupted.length > 0) {
    console.warn(`[filterCorruptedNotes] Found ${corrupted.length} corrupted notes (will be excluded):`, 
      corrupted.map(n => ({
        nullifier: n.nullifier.slice(0, 8),
        tokenType: n.tokenType,
        amount: n.amount,
      }))
    );
  }
  
  return valid;
}

/**
 * Permanently remove corrupted notes from localStorage
 * Returns the number of notes removed and a list of removed note summaries
 */
export function purgeCorruptedNotes(): { removed: number; notes: Array<{ nullifier: string; amount: string; tokenType?: string }> } {
  const STORAGE_KEY = 'noctura.shieldedNotes';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { removed: 0, notes: [] };
  
  try {
    const parsed = JSON.parse(raw);
    // Zustand persist format: { state: { notes: [...], ... }, version: 0 }
    const notes: ShieldedNoteRecord[] = parsed.state?.notes || parsed.notes || parsed;
    
    if (!Array.isArray(notes)) {
      console.warn('[purgeCorruptedNotes] Notes not found in expected format');
      return { removed: 0, notes: [] };
    }
    
    const validNotes = filterCorruptedNotes(notes);
    const removedCount = notes.length - validNotes.length;
    const removedNotes = notes.filter(n => isNoteCorrupted(n)).map(n => ({
      nullifier: n.nullifier.slice(0, 16),
      amount: n.amount,
      tokenType: n.tokenType,
    }));
    
    if (removedCount > 0) {
      // Preserve zustand persist format
      const newData = {
        state: {
          ...parsed.state,
          notes: validNotes,
        },
        version: parsed.version || 0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      console.log(`[purgeCorruptedNotes] ✅ Permanently removed ${removedCount} corrupted notes from localStorage`);
    }
    
    return { removed: removedCount, notes: removedNotes };
  } catch (err) {
    console.error('[purgeCorruptedNotes] Failed to parse/clean localStorage:', err);
    return { removed: 0, notes: [] };
  }
}

/**
 * Force sync shielded notes with on-chain nullifier state
 * Marks notes as spent if their nullifiers have been consumed on-chain
 */
export async function syncNotesWithOnChainState(
  fetchSpentNullifiers: () => Promise<string[]>
): Promise<{ synced: number; markedSpent: string[] }> {
  const STORAGE_KEY = 'noctura.shieldedNotes';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { synced: 0, markedSpent: [] };
  
  try {
    const spentNullifiers = await fetchSpentNullifiers();
    const spentSet = new Set(spentNullifiers);
    
    const parsed = JSON.parse(raw);
    const notes: ShieldedNoteRecord[] = parsed.state?.notes || [];
    
    const markedSpent: string[] = [];
    const updatedNotes = notes.map(note => {
      if (!note.spent && spentSet.has(note.nullifier)) {
        markedSpent.push(note.nullifier.slice(0, 16));
        return { ...note, spent: true };
      }
      return note;
    });
    
    if (markedSpent.length > 0) {
      const newData = {
        state: {
          ...parsed.state,
          notes: updatedNotes,
        },
        version: parsed.version || 0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      console.log(`[syncNotesWithOnChainState] ✅ Marked ${markedSpent.length} notes as spent`);
    }
    
    return { synced: notes.length, markedSpent };
  } catch (err) {
    console.error('[syncNotesWithOnChainState] Failed:', err);
    return { synced: 0, markedSpent: [] };
  }
}

/**
 * Create note payload for encryption to recipient
 * This contains all the data recipient needs to claim the note
 */
export function createNotePayloadForRecipient(
  note: Note,
  tokenType: 'SOL' | 'NOC',
  memo?: string
): {
  amount: string;
  tokenMint: string;
  secret: string;
  blinding: string;
  rho: string;
  commitment: string;
  tokenType: 'SOL' | 'NOC';
  memo?: string;
} {
  return {
    amount: note.amount.toString(),
    tokenMint: note.tokenMint.toString(),
    secret: note.secret.toString(),
    blinding: note.blinding.toString(),
    rho: note.rho.toString(),
    commitment: note.commitment.toString(),
    tokenType,
    memo,
  };
}

/**
 * Reconstruct a Note from decrypted payload
 */
export function reconstructNoteFromPayload(payload: {
  amount: string;
  tokenMint: string;
  secret: string;
  blinding: string;
  rho: string;
  commitment: string;
}): Note {
  return createNote({
    secret: BigInt(payload.secret),
    amount: BigInt(payload.amount),
    tokenMint: BigInt(payload.tokenMint),
    blinding: BigInt(payload.blinding),
    rho: BigInt(payload.rho),
  });
}