/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { useWallet } from './hooks/useWallet';
import { useShieldedNotes } from './hooks/useShieldedNotes';
import { Dashboard } from './components/Dashboard';
import {
  getSolBalance,
  getTokenBalance,
  sendNoc,
  sendSol,
  estimateSolSendFee,
  estimateNocSendFee,
  estimateBaseTransactionFee,
} from './lib/solana';
import { ProverResponse, proveCircuit, requestNocAirdrop, relayTransfer, relayWithdraw } from './lib/prover';
import { submitShieldedWithdrawSol, relayConsolidate } from './lib/shieldProgram';
import { planStagedSend } from './lib/notePlanner';
import { parseNocAmount, prepareDeposit, snapshotNote, pubkeyToField, createNoteFromSecrets } from './lib/shield';
import { submitShieldedDeposit, fetchSpentNullifiers, PRIVACY_FEE_ATOMS } from './lib/shieldProgram';
import { buildMerkleProof } from './lib/merkle';
import { selectNotesForAmount } from './utils/noteSelection';
import { AmountDisplay } from './components/AmountDisplay';
import { FeeBreakdown } from './components/FeeBreakdown';
import { generateZKHashDisplay, generateSecureRandomness } from './utils/privacy';
import { serializeWithdrawWitness, serializeTransferWitness } from '@zk-witness/index';
import { serializeTransferMultiWitness } from '@zk-witness/builders/transfer-multi';
import { serializeConsolidateWitness } from '@zk-witness/builders/consolidate';
import type { Note } from '@zk-witness/index';
import { ShieldedNoteRecord } from './types/shield';
import { INITIAL_AIRDROP_AMOUNT, NOC_TOKEN_MINT, WSOL_MINT, ProverServiceUrl } from './lib/constants';
import { initializePrivateRelayer, getPrivateRelayer } from './lib/privateRelayer';
import { getObfuscatedFeeCollector } from './lib/feeObfuscation';
import { getTimingPrivacyManager } from './lib/timingPrivacy';
import { getAccountAnonymityManager } from './lib/accountAnonymity';
import { buildConsolidationWitness, partitionNotesForConsolidation } from './lib/consolidate';

const NOC_ATOMS = 1_000_000;
const SHIELDED_PRIVACY_FEE_NOC = 0.25; // Flat 0.25 NOC fee for ALL shielded transactions (deposits + withdrawals)
const DEFAULT_SOL_FEE = 0.000005;
const SOLANA_CLUSTER = import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet';

type ActionType = 'transparentSend' | 'shieldedSend' | 'shieldDeposit' | 'shieldWithdraw';

const ACTION_TABS: Array<{ id: ActionType; label: string; helper: string }> = [
  {
    id: 'transparentSend',
    label: 'Public Transfer',
    helper: 'Send SOL or $NOC transparently',
  },
  {
    id: 'shieldedSend',
    label: 'Shielded Transfer',
    helper: 'Private $NOC send to any address',
  },
  {
    id: 'shieldDeposit',
    label: 'Shield Funds',
    helper: 'Move $NOC into the privacy vault',
  },
  {
    id: 'shieldWithdraw',
    label: 'Unshield Funds',
    helper: 'Withdraw shielded $NOC back to you',
  },
];

const TOKEN_OPTIONS = ['SOL', 'NOC'] as const;
const IS_DEV_ENV = import.meta.env?.DEV ?? false;

function logProofPayload(context: string, payload: Record<string, unknown>) {
  if (!IS_DEV_ENV) return;
  try {
    // Avoid accidentally logging circular structures
    const safePayload = JSON.parse(JSON.stringify(payload));
    // eslint-disable-next-line no-console
    console.info(`[wallet:${context}]`, safePayload);
  } catch {
    // eslint-disable-next-line no-console
    console.info(`[wallet:${context}]`, payload);
  }
}

function buildExplorerUrl(signature: string) {
  const clusterSuffix = SOLANA_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${clusterSuffix}`;
}

// Encode note for sharing (base64 JSON)
function encodeSharedNote(note: Note, mintKey: PublicKey, tokenType: 'NOC' | 'SOL'): string {
  const noteData = {
    secret: note.secret.toString(),
    amount: note.amount.toString(),
    tokenMint: note.tokenMint.toString(),
    blinding: note.blinding.toString(),
    rho: note.rho.toString(),
    commitment: note.commitment.toString(),
    nullifier: note.nullifier.toString(),
    mintAddress: mintKey.toBase58(),
    tokenType,
  };
  return btoa(JSON.stringify(noteData));
}

// Decode shared note
function decodeSharedNote(encoded: string): ShieldedNoteRecord {
  const noteData = JSON.parse(atob(encoded));
  return {
    commitment: noteData.commitment,
    nullifier: noteData.nullifier,
    amount: noteData.amount,
    tokenMintField: noteData.tokenMint,
    tokenMintAddress: noteData.mintAddress,
    owner: '', // Will be set by importer
    secret: noteData.secret,
    blinding: noteData.blinding,
    rho: noteData.rho,
    leafIndex: -1, // Unknown until on-chain
    spent: false,
    createdAt: Date.now(),
    tokenType: noteData.tokenType,
  };
}

function formatSolDisplay(value: number, decimals = 6): string {
  if (!Number.isFinite(value)) {
    return '0.000000';
  }
  const factor = 10 ** decimals;
  const truncated = Math.trunc(value * factor) / factor;
  return truncated.toFixed(decimals);
}

async function computeZkHash(recipient: string, tokenType: 'NOC' | 'SOL', amount: bigint): Promise<string> {
  const recipientPk = new PublicKey(recipient).toBytes();
  const mint = new PublicKey(tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT).toBytes();
  const randomness = generateSecureRandomness();
  return generateZKHashDisplay(recipientPk, mint, amount, randomness);
}

type ShieldedTransferReview = {
  recipient: string;
  amount: number;
  atoms: bigint;
  feeNoc: number;
  isPartialSpend?: boolean;
  changeAmount?: number;
  tokenType?: 'NOC' | 'SOL';
  sharedNote?: string; // Base64 encoded note for sharing
  transparentPayout?: boolean;
  recipientZkHash?: string;
};

// Unified transaction confirmation type
type TransactionConfirmation = {
  type: 'transparentSend' | 'shieldedSend' | 'shieldDeposit' | 'shieldWithdraw';
  token: 'SOL' | 'NOC';
  amount: string;
  displayAmount: string;
  recipient?: string;
  fromLabel: string;
  toLabel: string;
  solFee: number;
  privacyFee?: number;
  changeAmount?: number;
  description: string;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cyber-border rounded-xl p-6 bg-surface/70">
      <header className="uppercase text-sm tracking-widest mb-4 text-neon">{title}</header>
      {children}
    </div>
  );
}

export default function App() {
  const keypair = useWallet((state) => state.keypair);
  const stored = useWallet((state) => state.stored);
  const mode = useWallet((state) => state.mode);
  const hasWallet = useWallet((state) => state.hasWallet);
  const initializeWallet = useWallet((state) => state.initialize);
  const setMode = useWallet((state) => state.setMode);
  const createWallet = useWallet((state) => state.createWallet);
  const importMnemonic = useWallet((state) => state.importMnemonic);
  const importSecret = useWallet((state) => state.importSecret);
  const markAirdrop = useWallet((state) => state.markAirdrop);
  const resetWallet = useWallet((state) => state.reset);
  const shieldedNotes = useShieldedNotes((state) => state.notes);
  const addShieldedNote = useShieldedNotes((state) => state.addNote);
  const markNoteSpent = useShieldedNotes((state) => state.markNoteSpent);
  const markMultipleSpent = useShieldedNotes((state) => state.markMultipleSpent);
  const manualLoadNotes = useShieldedNotes((state) => state.manualLoad);

  // Initialize privacy systems on mount
  useEffect(() => {
    const initializePrivacy = async () => {
      // Expose debug functions to window for development
      (window as any).__noctura_debug = {
        getShieldedNotes: () => {
          const notes = useShieldedNotes.getState().notes;
          const walletAddress = keypair?.publicKey.toBase58();
          
          const analysis = {
            totalNotes: notes.length,
            walletAddress,
            notes: notes.map(n => ({
              nullifier: n.nullifier.slice(0, 16),
              amount: n.amount,
              displayAmountNoc: (BigInt(n.amount) / BigInt(1_000_000)).toString(),
              displayAmountSol: (BigInt(n.amount) / BigInt(1_000_000_000)).toString(),
              tokenType: n.tokenType,
              owner: n.owner.slice(0, 16),
              isOwned: n.owner === walletAddress,
              spent: n.spent,
              leafIndex: n.leafIndex,
              createdAt: (n.createdAt !== undefined) ? new Date(n.createdAt).toISOString() : 'unknown',
            })),
            summary: {
              totalByType: notes.reduce((acc, n) => {
                const type = n.tokenType || 'UNKNOWN';
                if (!acc[type]) acc[type] = 0n;
                acc[type] += BigInt(n.amount);
                return acc;
              }, {} as Record<string, bigint>),
              ownedByWallet: notes.filter(n => n.owner === walletAddress).length,
              spentCount: notes.filter(n => n.spent).length,
              unspentCount: notes.filter(n => !n.spent).length,
            },
          };
          console.table(analysis.notes);
          console.log('[Debug] Summary:', analysis.summary);
          return analysis;
        },
        resyncShieldedNotes: async () => {
          if (!keypair) {
            console.error('No keypair');
            return;
          }
          try {
            console.log('[Debug] Resyncing shielded notes...');
            const spentNullifiers = await fetchSpentNullifiers(keypair);
            console.log('[Debug] Found spent nullifiers:', spentNullifiers);
            if (spentNullifiers.length > 0) {
              markMultipleSpent(spentNullifiers);
            }
            const walletAddress = keypair.publicKey.toBase58();
            const walletNotes = shieldedNotes.filter(n => n.owner === walletAddress);
            const unspent = walletNotes.filter(n => !n.spent);
            console.log('[Debug] Wallet notes:', walletNotes.length, 'Unspent:', unspent.length);
            return { spentNullifiers, walletNotes, unspent };
          } catch (err) {
            console.error('[Debug] Resync failed:', err);
            throw err;
          }
        },
        clearAllNotes: () => {
          console.warn('[Debug] Clearing ALL shielded notes from storage');
          const resetStore = useShieldedNotes.getState().reset;
          resetStore();
          console.log('[Debug] Notes cleared');
        },
        getBalance: () => {
          const notes = useShieldedNotes.getState().notes;
          const walletAddress = keypair?.publicKey.toBase58();
          
          const balanceByType = notes
            .filter(n => n.owner === walletAddress && !n.spent)
            .reduce((acc, n) => {
              const type = n.tokenType || 'UNDEFINED';
              if (!acc[type]) acc[type] = 0n;
              acc[type] += BigInt(n.amount);
              return acc;
            }, {} as Record<string, bigint>);
          
          const result = {
            raw: { shieldedSol: shieldedSolBalance, shieldedNoc: shieldedNocBalance },
            calculated: {
              nocAtoms: balanceByType['NOC']?.toString() || '0',
              solAtoms: balanceByType['SOL']?.toString() || '0',
              undefinedAtoms: balanceByType['UNDEFINED']?.toString() || '0',
            },
            displayable: {
              noc: (balanceByType['NOC'] ? Number(balanceByType['NOC']) / 1_000_000 : 0).toFixed(6),
              sol: (balanceByType['SOL'] ? Number(balanceByType['SOL']) / 1_000_000_000 : 0).toFixed(9),
              undefined: (balanceByType['UNDEFINED'] ? Number(balanceByType['UNDEFINED']) / 1_000_000 : 0).toFixed(6),
            },
            notes: {
              total: notes.length,
              ownedByWallet: notes.filter(n => n.owner === walletAddress).length,
              unspent: notes.filter(n => n.owner === walletAddress && !n.spent).length,
              withUndefinedType: notes.filter(n => n.owner === walletAddress && !n.tokenType).length,
            },
          };
          console.log('[Debug] Balance analysis:', result);
          return result;
        },
        fixUndefinedTokenTypes: () => {
          const notes = useShieldedNotes.getState().notes;
          const walletAddress = keypair?.publicKey.toBase58();
          
          console.log('[Debug] Analyzing notes with undefined tokenType...');
          const undefinedNotes = notes.filter(n => n.owner === walletAddress && !n.tokenType);
          
          if (undefinedNotes.length === 0) {
            console.log('[Debug] ✓ All notes have defined tokenType');
            return { fixed: 0, total: notes.length, status: 'CLEAN' };
          }
          
          console.log('[Debug] Found', undefinedNotes.length, 'notes with undefined tokenType');
          const amounts = undefinedNotes.map(n => ({
            nullifier: n.nullifier.slice(0, 16),
            amount: n.amount,
            displayAmount: (BigInt(n.amount) / BigInt(1_000_000)).toString() + ' NOC',
            spent: n.spent,
            createdAt: (n.createdAt !== undefined) ? new Date(n.createdAt).toISOString() : 'unknown',
          }));
          
          const total = undefinedNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
          console.table(amounts);
          console.log('[Debug] Total undefined: ' + (Number(total) / 1_000_000).toFixed(2) + ' NOC');
          console.log('[Debug] These are being treated as NOC in balance calculation');
          
          return {
            undefinedCount: undefinedNotes.length,
            totalAmount: (Number(total) / 1_000_000).toFixed(2) + ' NOC',
            status: 'HAS_LEGACY_NOTES',
            recommendation: 'If balance seems wrong, run: __noctura_debug.clearAllNotes() then re-deposit',
          };
        },
        auditShieldedDeposits: async () => {
          if (!keypair) {
            console.error('No keypair');
            return;
          }
          try {
            console.log('[Audit] === SHIELDED DEPOSIT AUDIT ===');
            console.log('[Audit] Fetching recent transactions...');
            
            const sigs = await fetchTransactions();
            console.log('[Audit] Found', sigs.length, 'recent transactions');
            
            const walletAddress = keypair.publicKey.toBase58();
            const notes = useShieldedNotes.getState().notes;
            const walletNotes = notes.filter(n => n.owner === walletAddress);
            
            // Map deposits by signature
            const depositsBySignature = walletNotes.reduce((acc, n) => {
              if (n.signature) {
                if (!acc[n.signature]) acc[n.signature] = [];
                acc[n.signature].push(n);
              }
              return acc;
            }, {} as Record<string, typeof walletNotes>);
            
            console.log('[Audit] Summary:');
            console.log('  Total transactions in Activity:', sigs.length);
            console.log('  Total shielded notes stored:', walletNotes.length);
            console.log('  Unique deposit signatures:', Object.keys(depositsBySignature).length);
            
            const unconfirmedTxs = sigs.filter(s => !depositsBySignature[s.signature]);
            console.log('  Transactions WITHOUT stored notes:', unconfirmedTxs.length);
            
            if (unconfirmedTxs.length > 0) {
              console.warn('[Audit] ⚠️  These transactions may have created shielded deposits but notes are missing:');
              console.table(unconfirmedTxs.slice(0, 5).map(s => ({
                signature: s.signature.slice(0, 16) + '...',
                timestamp: new Date(s.timestamp * 1000).toISOString(),
                status: s.err ? '❌ FAILED' : '✅ SUCCESS',
              })));
            }
            
            // Calculate expected vs actual balance
            const totalStoredNoc = walletNotes
              .filter(n => !n.spent && n.tokenType === 'NOC')
              .reduce((sum, n) => sum + BigInt(n.amount), 0n);
            const totalStoredSol = walletNotes
              .filter(n => !n.spent && n.tokenType === 'SOL')
              .reduce((sum, n) => sum + BigInt(n.amount), 0n);
            
            console.log('[Audit] Stored unspent balances:');
            console.log('  NOC:', (Number(totalStoredNoc) / 1_000_000).toFixed(6));
            console.log('  SOL:', (Number(totalStoredSol) / 1_000_000_000).toFixed(9));
            console.log('[Audit] Displayed balances:', { shieldedNoc: shieldedNocBalance, shieldedSol: shieldedSolBalance });
            
            return {
              activityTransactions: sigs.length,
              storedNotes: walletNotes.length,
              uniqueDepositSignatures: Object.keys(depositsBySignature).length,
              transactionsWithoutNotes: unconfirmedTxs.length,
              missingNoteSignatures: unconfirmedTxs.map(s => s.signature),
              storedBalances: {
                noc: (Number(totalStoredNoc) / 1_000_000).toFixed(6),
                sol: (Number(totalStoredSol) / 1_000_000_000).toFixed(9),
              },
              displayedBalances: {
                noc: shieldedNocBalance.toFixed(6),
                sol: shieldedSolBalance.toFixed(9),
              },
            };
          } catch (err) {
            console.error('[Audit] Error:', err);
            throw err;
          }
        },
        showDepositFlow: async (signature: string) => {
          const notes = useShieldedNotes.getState().notes;
          const walletAddress = keypair?.publicKey.toBase58();
          
          const relatedNotes = notes.filter(n => n.signature === signature && n.owner === walletAddress);
          console.log('[DepositFlow] Signature:', signature);
          console.log('[DepositFlow] Related stored notes:', relatedNotes.length);
          console.table(relatedNotes.map(n => ({
            nullifier: n.nullifier.slice(0, 16),
            amount: n.amount,
            tokenType: n.tokenType,
            leafIndex: n.leafIndex,
            spent: n.spent,
          })));
          
          return relatedNotes;
        },
        diagnosePersistence: () => {
          console.log('[Diagnosis] === PERSISTENCE DIAGNOSIS ===');
          
          // Check 1: In-memory state
          const inMemory = useShieldedNotes.getState().notes;
          console.log('[Diagnosis] In-memory notes:', inMemory.length);
          
          // Check 2: localStorage
          const storageKey = 'noctura.shieldedNotes';
          const rawStorage = localStorage.getItem(storageKey);
          console.log('[Diagnosis] localStorage has key:', !!rawStorage);
          
          let inStorage = 0;
          if (rawStorage) {
            try {
              const parsed = JSON.parse(rawStorage);
              inStorage = parsed.state?.notes?.length || 0;
              console.log('[Diagnosis] Storage contains:', inStorage, 'notes');
            } catch (err) {
              console.error('[Diagnosis] localStorage parse error:', err);
            }
          }
          
          // Check 3: Verify sync
          const isSynced = inMemory.length === inStorage;
          console.log('[Diagnosis] In-memory ↔ Storage SYNC:', isSynced ? '✅ SYNCED' : '❌ OUT OF SYNC');
          
          if (!isSynced) {
            console.error('[Diagnosis] CRITICAL: Notes in memory but not persisted!');
            console.log('[Diagnosis] Solution: Call __noctura_debug.fixPersistence()');
          }
          
          return {
            inMemory: inMemory.length,
            inStorage,
            isSynced,
            notes: inMemory.map(n => ({
              nullifier: n.nullifier.slice(0, 16),
              amount: n.amount,
              tokenType: n.tokenType,
            })),
          };
        },
        fixPersistence: () => {
          console.log('[Fix] === PERSISTENCE FIX ===');
          const store = useShieldedNotes.getState();
          
          console.log('[Fix] Current in-memory notes:', store.notes.length);
          
          // Manually save to localStorage
          store.manualSave();
          
          // Verify it was saved
          const saved = store.verifyPersistence();
          if (saved) {
            console.log('[Fix] ✅ Persistence fixed!');
          } else {
            console.error('[Fix] ❌ Persistence still failing - localStorage may be blocked');
          }
          
          return { fixed: saved, notesCount: store.notes.length };
        },
        inspectLocalStorage: () => {
          console.log('[Storage] === LOCAL STORAGE INSPECTION ===');
          const keys = Object.keys(localStorage);
          console.log('[Storage] All keys:', keys);
          
          const shieldKey = 'noctura.shieldedNotes';
          const shieldData = localStorage.getItem(shieldKey);
          
          if (!shieldData) {
            console.log('[Storage] ❌ No shielded notes data in localStorage!');
            return null;
          }
          
          try {
            const parsed = JSON.parse(shieldData);
            console.log('[Storage] Parsed data structure:');
            console.log('  - version:', parsed.version);
            console.log('  - state.notes count:', parsed.state?.notes?.length);
            console.log('  - state.nextLeafIndex:', parsed.state?.nextLeafIndex);
            
            if (parsed.state?.notes && parsed.state.notes.length > 0) {
              console.log('[Storage] First note sample:');
              const firstNote = parsed.state.notes[0];
              console.table({
                nullifier: firstNote.nullifier?.slice(0, 16) + '...',
                amount: firstNote.amount,
                tokenType: firstNote.tokenType,
                owner: firstNote.owner?.slice(0, 16) + '...',
                signature: firstNote.signature?.slice(0, 16) + '...',
              });
            }
            
            return parsed;
          } catch (err) {
            console.error('[Storage] Failed to parse localStorage data:', err);
            return null;
          }
        },
        loadFromStorage: () => {
          console.log('[Load] Attempting manual load from localStorage...');
          const store = useShieldedNotes.getState();
          const success = store.manualLoad();
          
          if (success) {
            console.log('[Load] ✅ Loaded successfully');
            return { success: true, notes: store.notes.length };
          } else {
            console.log('[Load] ❌ Failed to load from storage');
            return { success: false };
          }
        },
        reconstructMissingDeposits: async () => {
          console.log('[Reconstruct] === ATTEMPTING TO RECONSTRUCT DEPOSITS ===');
          if (!keypair) {
            console.error('[Reconstruct] No keypair available');
            return;
          }
          
          try {
            const walletAddress = keypair.publicKey.toBase58();
            console.log('[Reconstruct] Wallet address:', walletAddress);
            
            // Get all transactions
            const txs = await fetchTransactions();
            console.log('[Reconstruct] Found', txs.length, 'transactions');
            
            // Get stored notes
            const storedNotes = useShieldedNotes.getState().notes;
            const storedSigs = new Set(storedNotes.filter(n => n.signature).map(n => n.signature));
            console.log('[Reconstruct] Already stored:', storedNotes.length, 'notes');
            
            // Find missing deposits
            const missingDeposits: typeof txs = [];
            for (const tx of txs) {
              if (!storedSigs.has(tx.signature) && !tx.err) {
                missingDeposits.push(tx);
              }
            }
            
            console.log('[Reconstruct] Found', missingDeposits.length, 'transactions without stored notes');
            
            if (missingDeposits.length === 0) {
              console.log('[Reconstruct] No missing deposits found');
              return { missingCount: 0 };
            }
            
            console.log('[Reconstruct] These deposits may have notes that need recovery:');
            console.table(missingDeposits.slice(0, 5).map((tx, i) => ({
              index: i,
              signature: tx.signature.slice(0, 16) + '...',
              timestamp: new Date(tx.timestamp * 1000).toISOString(),
            })));
            
            console.log('[Reconstruct] ⚠️  MANUAL RECOVERY REQUIRED:');
            console.log('[Reconstruct] 1. Check browser console for errors during these deposit signatures');
            console.log('[Reconstruct] 2. For each missing signature, run: __noctura_debug.showDepositFlow("SIGNATURE")');
            console.log('[Reconstruct] 3. If note data exists on-chain, re-deposit with same amounts');
            
            return {
              missingCount: missingDeposits.length,
              missingSignatures: missingDeposits.map(tx => ({ signature: tx.signature, timestamp: tx.timestamp })),
              recommendation: 'Use showDepositFlow() to inspect each transaction, or re-deposit if notes lost',
            };
          } catch (err) {
            console.error('[Reconstruct] Recovery failed:', err);
            throw err;
          }
        },
        initializeShieldProgram: async () => {
          console.log('[Debug] === INITIALIZING SHIELD PROGRAM ===');
          if (!keypair) {
            console.error('[Debug] No keypair available');
            return { success: false, error: 'No keypair' };
          }
          
          try {
            const { initializeShieldProgram: initProgram, isShieldProgramInitialized } = await import('./lib/shieldProgram');
            
            // Check if already initialized
            const isInit = await isShieldProgramInitialized();
            if (isInit) {
              console.log('[Debug] ✅ Shield program already initialized');
              return { success: true, message: 'Already initialized' };
            }
            
            console.log('[Debug] Shield program not initialized, initializing now...');
            const signature = await initProgram(keypair, keypair.publicKey);
            console.log('[Debug] ✅ Initialization successful:', signature);
            
            // Wait for confirmation
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return {
              success: true,
              signature,
              message: 'Shield program initialized successfully! You can now make deposits.',
            };
          } catch (err) {
            console.error('[Debug] Initialization failed:', err);
            const errMsg = (err as Error).message || '';
            
            // Provide helpful guidance based on error
            let suggestion = 'Check console for details.';
            if (errMsg.includes('Vector capacity exceeded')) {
              suggestion = 'Tree height too large. The program needs a smaller merkle tree. Contact admin to re-initialize with smaller tree height.';
            } else if (errMsg.includes('Signer account must be transaction signer')) {
              suggestion = 'Your wallet is not authorized as admin. Only the program deployer can initialize.';
            }
            
            return {
              success: false,
              error: (err as Error).message,
              suggestion,
            };
          }
        },
        uploadVerifiers: async () => {
          console.log('[UploadVerifiers] === UPLOADING VERIFIER KEYS ===');
          if (!keypair) {
            console.error('[UploadVerifiers] No keypair available');
            return { success: false, error: 'No keypair' };
          }
          
          try {
            console.log('[UploadVerifiers] Loading verifier keys from public directory...');
            const [depositRes, withdrawRes, transferRes, transferMultiRes] = await Promise.all([
              fetch('/deposit.vkey.json'),
              fetch('/withdraw.vkey.json'),
              fetch('/transfer.vkey.json'),
              fetch('/transfer-multi.vkey.json'),
            ]);
            
            if (!depositRes.ok || !withdrawRes.ok || !transferRes.ok || !transferMultiRes.ok) {
              throw new Error('Failed to fetch verifier keys - make sure they are in public/ directory (deposit, withdraw, transfer, transfer-multi)');
            }
            
            const depositVkey = await depositRes.json();
            const withdrawVkey = await withdrawRes.json();
            const transferVkey = await transferRes.json();
            const transferMultiVkey = await transferMultiRes.json();
            console.log('[UploadVerifiers] transfer-multi vkey loaded (for multi-note circuit), not yet uploaded on-chain.');
            
            console.log('[UploadVerifiers] Verifier keys loaded, uploading to program...');
            const { uploadVerifierKeys } = await import('./lib/shieldProgram');
            const sigs = await uploadVerifierKeys(keypair, depositVkey, withdrawVkey, transferVkey);
            
            console.log('[UploadVerifiers] ✅ All verifiers uploaded successfully!');
            console.log('[UploadVerifiers] Deposit signature:', sigs.deposit);
            console.log('[UploadVerifiers] Withdraw signature:', sigs.withdraw);
            console.log('[UploadVerifiers] Transfer signature:', sigs.transfer);
            
            return {
              success: true,
              signatures: sigs,
              message: 'Verifier keys uploaded! You can now make shielded deposits.',
            };
          } catch (err) {
            console.error('[UploadVerifiers] Failed:', err);
            return {
              success: false,
              error: (err as Error).message,
            };
          }
        },
        checkFeeCollector: async () => {
          console.log('[CheckFeeCollector] === CHECKING FEE COLLECTOR ADDRESS ===');
          
          try {
            const { isShieldProgramInitialized } = await import('./lib/shieldProgram');
            const isInit = await isShieldProgramInitialized();
            
            if (!isInit) {
              return {
                success: false,
                error: 'Shield program not initialized. Initialize first.',
              };
            }

            const { getProgramForKeypair, deriveShieldPdas } = await import('./lib/anchorClient');
            const dummyKeypair = keypair || new (await import('@solana/web3.js')).Keypair();
            const program = getProgramForKeypair(dummyKeypair);
            const pdas = deriveShieldPdas();

            console.log('[CheckFeeCollector] Fetching global state...');
            const globalState = await program.account.globalState.fetch(pdas.globalState);
            const feeCollector = (globalState as any).feeCollector;

            console.log('[CheckFeeCollector] Fee collector:', feeCollector);

            return {
              success: true,
              feeCollector,
              explorerUrl: `https://explorer.solana.com/address/${feeCollector}?cluster=devnet`,
            };
          } catch (err) {
            console.error('[CheckFeeCollector] Failed:', err);
            return {
              success: false,
              error: (err as Error).message,
            };
          }
        },
        setShieldFees: async () => {
          console.log('[SetShieldFees] === SETTING SHIELD FEES TO 0 ===');
          if (!keypair) {
            console.error('[SetShieldFees] No keypair available');
            return { success: false, error: 'No keypair' };
          }
          
          try {
            const { setShieldFees: setFees } = await import('./lib/shieldProgram');
            console.log('[SetShieldFees] Calling setShieldFees with admin keypair...');
            const signature = await setFees(keypair);
            
            console.log('[SetShieldFees] ✅ Shield fees updated successfully!');
            console.log('[SetShieldFees] Signature:', signature);
            
            return {
              success: true,
              signature,
              message: '✅ Shield fees set to 0! Only 0.25 NOC privacy fee applies now.',
            };
          } catch (err) {
            console.error('[SetShieldFees] Failed:', err);
            const errMsg = (err as Error).message || '';
            
            let suggestion = 'Check console for details.';
            if (errMsg.includes('custom program error: 0x1')) {
              suggestion = 'You are not the program admin. Only the deployer can update fees.';
            } else if (errMsg.includes('Account update failed')) {
              suggestion = 'Shield program may not be initialized. Initialize first.';
            }
            
            return {
              success: false,
              error: errMsg,
              suggestion,
            };
          }
        },
        setFeeCollector: async (newAddress: string) => {
          console.log('[SetFeeCollector] === SETTING FEE COLLECTOR ===');
          if (!keypair) {
            console.error('[SetFeeCollector] No keypair available');
            return { success: false, error: 'No keypair' };
          }
          
          try {
            const { setFeeCollector: setCollector } = await import('./lib/shieldProgram');
            const newFeeCollectorPubkey = new PublicKey(newAddress);
            console.log('[SetFeeCollector] Calling setFeeCollector with new address:', newAddress);
            const signature = await setCollector(keypair, newFeeCollectorPubkey);
            
            console.log('[SetFeeCollector] ✅ Fee collector updated successfully!');
            console.log('[SetFeeCollector] Signature:', signature);
            console.log('[SetFeeCollector] New fee collector:', newAddress);
            
            return {
              success: true,
              signature,
              message: `✅ Fee collector updated to ${newAddress}`,
            };
          } catch (err) {
            console.error('[SetFeeCollector] Failed:', err);
            const errMsg = (err as Error).message || '';
            
            let suggestion = 'Check console for details.';
            if (errMsg.includes('invalid')) {
              suggestion = 'Invalid address format. Please provide a valid Solana address.';
            }
            
            return {
              success: false,
              error: errMsg,
              suggestion,
            };
          }
        },
      };
      
      try {
        console.log('[Privacy] Initializing privacy systems...');
        
        // Initialize relayer pool with 5 accounts
        await initializePrivateRelayer(5, {
          enabled: true,
          batchSize: 5,
          maxWaitMs: 30_000,
          minDelayMs: 1_000,
          maxDelayMs: 10_000,
        });
        console.log('[Privacy] ✓ Private relayer initialized');

        // Initialize fee obfuscation
        const feeCollector = getObfuscatedFeeCollector();
        console.log('[Privacy] ✓ Fee obfuscation active');

        // Expose to window for monitoring (development only)
        (window as any).__noctura = {
          relayer: getPrivateRelayer(),
          feeCollector,
        };

        // Expose minimal debug API to update and verify fee collector
        (window as any).debugApi = {
          async setFeeCollector(address: string) {
            console.log('setFeeCollector called with:', address);
            // Fee collector management would go here
            return { success: true, address };
          },
          async checkFeeCollector() {
            try {
              if (!keypair) throw new Error('No keypair');
              const { getProgramForKeypair, deriveShieldPdas } = await import('./lib/anchorClient');
              const program = getProgramForKeypair(keypair);
              const pdas = deriveShieldPdas();
              const globalState = await program.account.globalState.fetch(pdas.globalState);
              const feeCollectorAddr = (globalState as any).feeCollector as string;
              return {
                success: true,
                feeCollector: feeCollectorAddr,
                explorerUrl: `https://explorer.solana.com/address/${feeCollectorAddr}?cluster=devnet`,
              };
            } catch (err) {
              return { success: false, error: (err as Error).message };
            }
          },
        };

        console.log('[Privacy] ✅ All privacy systems initialized - 100% Privacy enabled');
      } catch (err) {
        console.error('[Privacy] Error initializing privacy systems:', err);
      }
    };

    initializePrivacy();
  }, [keypair]);
  const [solBalance, setSolBalance] = useState(0);
  const [nocBalance, setNocBalance] = useState(0);
  const shieldedSyncAttempted = useRef(false);

  // Calculate shielded balances from notes
  const { shieldedSolBalance, shieldedNocBalance } = useMemo(() => {
    const currentWalletAddress = keypair?.publicKey.toBase58();
    const walletNotes = shieldedNotes.filter((note) => note.owner === currentWalletAddress);
    
    // Filter by tokenType field (primary source of truth)
    const unspentSolNotes = walletNotes.filter((n) => !n.spent && n.tokenType === 'SOL');
    const unspentNocNotes = walletNotes.filter((n) => !n.spent && (n.tokenType === 'NOC' || !n.tokenType));
    
    const totalSol = unspentSolNotes.reduce((sum, n) => sum + Number(BigInt(n.amount)), 0) / LAMPORTS_PER_SOL;
    const totalNoc = unspentNocNotes.reduce((sum, n) => sum + Number(BigInt(n.amount)), 0) / 1_000_000;
    
    return { shieldedSolBalance: totalSol, shieldedNocBalance: totalNoc };
  }, [keypair, shieldedNotes]);

  const [status, setStatus] = useState<string | null>(null);
  const [airdropPending, setAirdropPending] = useState(false);
  const [airdropError, setAirdropError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [actionAmount, setActionAmount] = useState('1');
  const [selectedToken, setSelectedToken] = useState<'SOL' | 'NOC'>('SOL');
  const [actionType, setActionType] = useState<ActionType>('transparentSend');
  const [proofPreview, setProofPreview] = useState('');
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [mnemonicBackup, setMnemonicBackup] = useState<string | null>(null);
  const [copiedMnemonic, setCopiedMnemonic] = useState(false);
  const [transferReview, setTransferReview] = useState<ShieldedTransferReview | null>(null);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [pendingWithdrawalProof, setPendingWithdrawalProof] = useState<ProverResponse | null>(null);
  const [pendingWithdrawalNote, setPendingWithdrawalNote] = useState<ShieldedNoteRecord | null>(null);
  const [pendingRecipientAta, setPendingRecipientAta] = useState<string | null>(null);
  const [shieldedSendPending, setShieldedSendPending] = useState(false);
  const [shieldedSendError, setShieldedSendError] = useState<string | null>(null);
  const [networkFeeEstimate, setNetworkFeeEstimate] = useState(DEFAULT_SOL_FEE);
  const [feeEstimateError, setFeeEstimateError] = useState<string | null>(null);
  const [txConfirmation, setTxConfirmation] = useState<TransactionConfirmation | null>(null);
  const [txConfirmPending, setTxConfirmPending] = useState(false);
  const [txSuccess, setTxSuccess] = useState<{ signature: string; amount: string; recipient: string; token: 'SOL' | 'NOC' } | null>(null);
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [stagedSendPlan, setStagedSendPlan] = useState<{ recipient: PublicKey; amount: bigint; steps: number; fullCount: number; hasPartial: boolean; feeEstimate: number } | null>(null);
  const [transparentPayout, setTransparentPayout] = useState(true); // Default to true: most users expect recipient to receive tokens
  const [pendingSharedNote, setPendingSharedNote] = useState<string | null>(null);
  const [importNoteInput, setImportNoteInput] = useState('');
  const [showImportNote, setShowImportNote] = useState(false);
  const [autoAirdropRequested, setAutoAirdropRequested] = useState(false);
  // Allows viewing the welcome/onboarding flow even when a wallet already exists
  const [forceShowOnboarding, setForceShowOnboarding] = useState(false);

  const refreshBalances = useCallback(async () => {
    if (!keypair) return;
    try {
      console.log('Refreshing balances for:', keypair.publicKey.toBase58());
      const mintKey = new PublicKey(NOC_TOKEN_MINT);
      const [sol, noc] = await Promise.all([
        getSolBalance(keypair.publicKey),
        getTokenBalance(keypair.publicKey, mintKey),
      ]);
      console.log('Balances fetched - SOL:', sol, 'NOC:', noc);
      setSolBalance(sol);
      setNocBalance(noc);
    } catch (err) {
      console.error('Failed to refresh balances:', err);
      setStatus(`Balance refresh failed: ${(err as Error).message}`);
    }
  }, [keypair]);

  // Retry helper with exponential backoff
  const retryWithBackoff = useCallback(async <T,>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 1000,
    context = 'operation'
  ): Promise<T> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === maxRetries) throw err;
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[${context}] Attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms...`, err);
        setStatus(`${context} failed (attempt ${attempt}/${maxRetries}), retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(`${context} failed after ${maxRetries} attempts`);
  }, [setStatus]);

  // Execute a staged multi-note SOL transfer (transparent payout), single confirmation
  const executeStagedSolSend = useCallback(
    async (recipientKey: PublicKey, targetAtoms: bigint) => {
      if (!keypair) throw new Error('Wallet not initialized');
      const walletAddress = keypair.publicKey.toBase58();
      // Filter SOL notes owned by wallet and unspent
      const solNotes = shieldedNotes
        .filter((n) => !n.spent && n.owner === walletAddress && n.tokenType === 'SOL');

      const plan = planStagedSend(solNotes, targetAtoms);
      if (plan.totalToSend < targetAtoms) {
        throw new Error('Insufficient shielded SOL across notes to cover requested amount.');
      }

      // Work on a mutable view of available notes for Merkle proofs
      let available = shieldedNotes.filter((n) => !n.spent && n.owner === walletAddress);

      // Helper to locate a fresh view of a note by nullifier in available list
      const findLiveNote = (nullifier: string) => available.find((n) => n.nullifier === nullifier);

      let remaining = targetAtoms;
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        const current = findLiveNote(step.note.nullifier);
        if (!current) throw new Error('Planned note not available anymore. Resync and retry.');

        // Rebuild Merkle proof with current available notes snapshot
        setStatus(`Step ${i + 1}/${plan.steps.length}: Building Merkle proof…`);
        const merkleProof = buildMerkleProof(available, current);

        const inputNote: Note = {
          secret: BigInt(current.secret),
          amount: BigInt(current.amount),
          tokenMint: BigInt(current.tokenMintField),
          blinding: BigInt(current.blinding),
          rho: BigInt(current.rho),
          commitment: BigInt(current.commitment),
          nullifier: BigInt(current.nullifier),
        };

        if (step.kind === 'full') {
          // Full withdrawal of this note's entire amount to recipient
          const witness = serializeWithdrawWitness({
            inputNote,
            merkleProof,
            receiver: pubkeyToField(recipientKey),
          });
          setStatus(`Step ${i + 1}/${plan.steps.length}: Proving withdrawal (this may take 30-60s)…`);
          const proof = await retryWithBackoff(
            () => proveCircuit('withdraw', witness),
            3,
            2000,
            `Step ${i + 1} proof generation`
          );
          setStatus(`Step ${i + 1}/${plan.steps.length}: Submitting withdrawal to network…`);
          await retryWithBackoff(
            () => submitShieldedWithdrawSol({
              keypair,
              proof,
              amount: BigInt(current.amount),
              recipient: recipientKey,
              nullifier: BigInt(current.nullifier),
            }),
            2,
            1500,
            `Step ${i + 1} withdrawal submission`
          );
          // Mark spent and remove from available
          markNoteSpent(current.nullifier);
          available = available.filter((n) => n.nullifier !== current.nullifier);
          remaining -= BigInt(step.amount);
        } else {
          // Partial: split note into recipient portion and change, then withdraw recipient portion
          const feeAtoms = PRIVACY_FEE_ATOMS; // 0.25 NOC fee will be charged during withdrawal
          const recipientPortion = step.amount + feeAtoms; // add fee for withdraw circuit requirements
          if (recipientPortion > BigInt(current.amount)) {
            throw new Error('Planned partial exceeds available note amount after accounting for fee.');
          }
          const changeAmount = BigInt(current.amount) - recipientPortion;

          const mintKey = new PublicKey(WSOL_MINT);
          const changeNote = createNoteFromSecrets(changeAmount, mintKey);
          const recipientNote = createNoteFromSecrets(recipientPortion, mintKey);

          const transferWitness = serializeTransferWitness({
            inputNote,
            merkleProof,
            outputNote1: recipientNote,
            outputNote2: changeNote,
          });
          setStatus(`Step ${i + 1}/${plan.steps.length}: Proving note split (this may take 30-60s)…`);
          const splitProof = await retryWithBackoff(
            () => proveCircuit('transfer', transferWitness),
            3,
            2000,
            `Step ${i + 1} split proof`
          );
          setStatus(`Step ${i + 1}/${plan.steps.length}: Submitting split to relayer…`);
          const splitResult = await retryWithBackoff(
            () => relayTransfer({
              proof: splitProof,
              nullifier: current.nullifier,
              outputCommitment1: recipientNote.commitment.toString(),
              outputCommitment2: changeNote.commitment.toString(),
            }),
            2,
            1500,
            `Step ${i + 1} split submission`
          );

          // Update local state for spent and new change note
          markNoteSpent(current.nullifier);
          available = available.filter((n) => n.nullifier !== current.nullifier);
          const changeRecord = snapshotNote(
            changeNote,
            keypair.publicKey,
            mintKey,
            { signature: splitResult.signature, tokenType: 'SOL' }
          );
          addShieldedNote(changeRecord);
          available.push(changeRecord);

          // Now withdraw the recipient portion to transparent recipient
          // Build Merkle proof for recipient note (include change record)
          setStatus(`Step ${i + 1}/${plan.steps.length}: Building withdraw proof…`);
          const recipientRecord = snapshotNote(
            recipientNote,
            keypair.publicKey,
            mintKey,
            { signature: splitResult.signature, tokenType: 'SOL' }
          );
          const proofNotes = [...available, recipientRecord];
          const withdrawProofMerkle = buildMerkleProof(proofNotes, recipientRecord);
          const withdrawWitness = serializeWithdrawWitness({
            inputNote: recipientNote,
            merkleProof: withdrawProofMerkle,
            receiver: pubkeyToField(recipientKey),
          });
          setStatus(`Step ${i + 1}/${plan.steps.length}: Proving withdrawal (this may take 30-60s)…`);
          const withdrawProof = await retryWithBackoff(
            () => proveCircuit('withdraw', withdrawWitness),
            3,
            2000,
            `Step ${i + 1} partial withdrawal proof`
          );
          setStatus(`Step ${i + 1}/${plan.steps.length}: Submitting withdrawal to network…`);
          await retryWithBackoff(
            () => submitShieldedWithdrawSol({
              keypair,
              proof: withdrawProof,
              amount: step.amount,
              recipient: recipientKey,
              nullifier: BigInt(recipientNote.nullifier),
            }),
            2,
            1500,
            `Step ${i + 1} partial withdrawal submission`
          );

          // Recipient portion spent; no longer tracked as shielded
          remaining = 0n;
        }
      }

      setStatus(`✅ Staged send complete! ${plan.totalNotesUsed} note(s) used, ${(Number(targetAtoms) / 1_000_000_000).toFixed(4)} SOL sent.`);
      await refreshBalances();
    },
    [keypair, shieldedNotes, markNoteSpent, addShieldedNote, setStatus, refreshBalances, retryWithBackoff]
  );

  // Plan a staged send and show confirmation modal
  const planStagedSolSend = useCallback(
    async (recipientKey: PublicKey, targetAtoms: bigint) => {
      if (!keypair) throw new Error('Wallet not initialized');
      const walletAddress = keypair.publicKey.toBase58();
      const solNotes = shieldedNotes
        .filter((n) => !n.spent && n.owner === walletAddress && n.tokenType === 'SOL');

      const plan = planStagedSend(solNotes, targetAtoms);
      if (plan.totalToSend < targetAtoms) {
        throw new Error('Insufficient shielded SOL across notes to cover requested amount.');
      }

      const fullCount = plan.steps.filter((s) => s.kind === 'full').length;
      const hasPartial = plan.hasPartial;
      const feePerWithdrawNoc = 0.25; // NOC
      const feeSteps = fullCount + (hasPartial ? 1 : 0);
      const estimatedWithdrawFees = feeSteps * feePerWithdrawNoc;

      // Pre-check NOC transparent balance to cover all withdrawal fees
      try {
        const nocBalance = await getTokenBalance(keypair.publicKey, new PublicKey(NOC_TOKEN_MINT));
        if (nocBalance < estimatedWithdrawFees) {
          throw new Error(`Not enough NOC to cover privacy fees for ${feeSteps} withdrawal(s). Need ~${estimatedWithdrawFees.toFixed(2)} NOC; have ${nocBalance.toFixed(6)} NOC.`);
        }
      } catch (e) {
        if ((e as Error).message?.includes('Not enough NOC')) {
          throw e;
        }
        throw new Error('Unable to determine NOC balance for privacy fees. Ensure you hold NOC in your wallet.');
      }

      // Set staged send plan for modal confirmation
      setStagedSendPlan({
        recipient: recipientKey,
        amount: targetAtoms,
        steps: plan.totalNotesUsed,
        fullCount,
        hasPartial,
        feeEstimate: estimatedWithdrawFees,
      });
    },
    [keypair, shieldedNotes, setStagedSendPlan]
  );

  const needsAirdrop = useMemo(() => {
    // If faucet was marked but balance is still zero (cluster change or failure), allow retry
    const needs = !stored?.faucetGranted || nocBalance < 0.0001;
    console.log('[Airdrop Check]', { faucetGranted: stored?.faucetGranted, nocBalance, needsAirdrop: needs });
    return needs;
  }, [stored?.faucetGranted, nocBalance]);

  useEffect(() => {
    initializeWallet();
  }, [initializeWallet]);

  // Enable `?onboarding=1` to force-show the welcome screen for demos/screenshots
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('onboarding') === '1') {
      setForceShowOnboarding(true);
    }
  }, []);

  useEffect(() => {
    // Show intro only when user has no wallet (first-time experience)
    if (!hasWallet) {
      const seen = localStorage.getItem('noc:introSeen');
      if (!seen) {
        setShowIntroModal(true);
      }
    }
  }, [hasWallet]);

  const handleIntroAcknowledge = useCallback(() => {
    localStorage.setItem('noc:introSeen', '1');
    setShowIntroModal(false);
  }, []);

  const handleModeToggle = useCallback(
    (nextMode: 'transparent' | 'shielded') => {
      setStatus(null); // Clear previous transaction status when switching modes
      setTxConfirmation(null); // Reset confirmation modal
      if (nextMode === 'transparent') {
        setActionType('transparentSend');
        setSelectedToken('SOL');
      } else {
        setActionType('shieldedSend');
        setSelectedToken('NOC');
        setTransparentPayout(true); // Reset to transparent payout when entering shielded mode
      }
    },
    [setActionType, setSelectedToken],
  );

  const resetPendingShieldedTransfer = useCallback(() => {
    setPendingWithdrawalProof(null);
    setPendingWithdrawalNote(null);
    setPendingRecipientAta(null);
    setShieldedSendError(null);
    setShieldedSendPending(false);
  }, []);

  useEffect(() => {
    if (actionType !== 'transparentSend') {
      setNetworkFeeEstimate(DEFAULT_SOL_FEE);
    }
  }, [actionType]);

  useEffect(() => {
    if (!keypair) return;
    const run = () => {
      refreshBalances().catch((err) => console.warn('Balance refresh failed', err));
    };
    run();
    const interval = window.setInterval(run, 10_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [keypair, refreshBalances]);

  // Sync shielded notes with on-chain state - mark any spent nullifiers
  // Run only once when keypair changes, not on every note change
  useEffect(() => {
    if (!keypair) return;
    
    const syncNotes = async () => {
      try {
        console.log('Syncing shielded notes with on-chain state...');
        const spentNullifiers = await fetchSpentNullifiers(keypair);
        console.log('On-chain spent nullifiers:', spentNullifiers.length);
        
        if (spentNullifiers.length > 0) {
          markMultipleSpent(spentNullifiers);
        }
      } catch (err) {
        console.warn('Failed to sync notes with on-chain state:', err);
      }
    };
    
    syncNotes();
    const interval = window.setInterval(syncNotes, 15_000); // keep shielded balances fresh
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypair]); // Only run when keypair changes, not on shieldedNotes changes

  // When switching into shielded mode, hydrate notes if missing and re-sync spent status
  useEffect(() => {
    if (!keypair) return;
    if (mode !== 'shielded') return;

    const hasNotes = shieldedNotes.length > 0;

    // Always attempt to hydrate if store is empty (helps after browser reloads)
    if (!hasNotes) {
      const loaded = manualLoadNotes();
      if (loaded) {
        console.log('[Shielded Sync] Store hydrated from localStorage');
      } else {
        console.warn('[Shielded Sync] No shielded notes found to hydrate');
      }
    }

    // Avoid refetching nullifiers repeatedly; one per wallet per session is enough
    if (!shieldedSyncAttempted.current) {
      shieldedSyncAttempted.current = true;

      fetchSpentNullifiers(keypair)
        .then((nullifiers) => {
          console.log('[Shielded Sync] Spent nullifiers on entry:', nullifiers.length, 'notes:', shieldedNotes.length);
          if (nullifiers.length > 0) {
            markMultipleSpent(nullifiers);
          }
          if (shieldedNotes.length === 0) {
            console.warn('[Shielded Sync] No shielded notes owned by this wallet. Deposit or import a shared note to see shielded balances.');
          }
        })
        .catch((err) => console.warn('[Shielded Sync] Failed to sync nullifiers on entry:', err));
    }
  }, [keypair, mode, shieldedNotes.length, manualLoadNotes, markMultipleSpent, shieldedNotes]);

  // Reset one-time sync flag when wallet changes
  useEffect(() => {
    shieldedSyncAttempted.current = false;
  }, [keypair]);

  useEffect(() => {
    if (!keypair) {
      return;
    }
    if (actionType !== 'transparentSend') {
      return;
    }

    let cancelled = false;

    const quoteFee = async () => {
      const trimmedRecipient = recipient.trim();
      const parsedAmount = Number(actionAmount);
      if (!trimmedRecipient || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setNetworkFeeEstimate(DEFAULT_SOL_FEE);
        setFeeEstimateError(null);
        return;
      }

      try {
        const target = new PublicKey(trimmedRecipient);
        let nextEstimate = DEFAULT_SOL_FEE;
        if (selectedToken === 'SOL') {
          nextEstimate = await estimateSolSendFee(keypair.publicKey, target, parsedAmount);
        } else {
          const atoms = parseNocAmount(actionAmount);
          if (atoms <= 0n) {
            setNetworkFeeEstimate(DEFAULT_SOL_FEE);
            return;
          }
          nextEstimate = await estimateNocSendFee(keypair.publicKey, target, atoms);
        }
        if (!cancelled) {
          setFeeEstimateError(null);
          setNetworkFeeEstimate(Number.isFinite(nextEstimate) ? nextEstimate : DEFAULT_SOL_FEE);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to estimate Solana fee', err);
          setNetworkFeeEstimate(DEFAULT_SOL_FEE);
          setFeeEstimateError('Live network fee unavailable; using default.');
        }
      }
    };

    quoteFee();

    return () => {
      cancelled = true;
    };
  }, [keypair, actionType, selectedToken, recipient, actionAmount]);

  useEffect(() => {
    if (!keypair) return;
    if (actionType === 'transparentSend') return;

    let cancelled = false;

    const quoteShieldedFee = async () => {
      try {
        const nextEstimate = await estimateBaseTransactionFee(keypair.publicKey);
        if (!cancelled) {
          setNetworkFeeEstimate(Number.isFinite(nextEstimate) ? nextEstimate : DEFAULT_SOL_FEE);
          setFeeEstimateError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to estimate shielded fee', err);
          setNetworkFeeEstimate(DEFAULT_SOL_FEE);
          setFeeEstimateError('Unable to refresh network fee; retry later.');
        }
      }
    };

    quoteShieldedFee();

    return () => {
      cancelled = true;
    };
  }, [keypair, actionType]);

  useEffect(() => {
    const desiredMode = actionType === 'transparentSend' ? 'transparent' : 'shielded';
    if (mode !== desiredMode) {
      setMode(desiredMode);
    }
  }, [actionType, mode, setMode]);

  const startShieldedTransfer = useCallback(
    async (destination: string, amountInput: string, tokenType: 'NOC' | 'SOL' = 'NOC') => {
      console.log('=== startShieldedTransfer START ===', { destination, amountInput, tokenType });
      setStatus(`Starting ${tokenType} shielded transfer...`);
      
      if (!keypair) throw new Error('Wallet not ready.');
      const trimmedRecipient = destination.trim();
      if (!trimmedRecipient) {
        throw new Error('Enter a recipient address.');
      }
      const parsedAmount = Number(amountInput);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Enter a positive amount.');
      }
      
      // Handle different decimals: NOC has 6, SOL has 9
      const decimals = tokenType === 'SOL' ? 9 : 6;
      const atoms = BigInt(Math.floor(parsedAmount * Math.pow(10, decimals)));
      if (atoms <= 0n) {
        throw new Error('Shielded amount must be positive.');
      }

      resetPendingShieldedTransfer();
      setTransferReview(null);
      setShieldedSendError(null);
      setShieldedSendPending(true);
      setStatus(`Preparing ${tokenType} shielded transfer (${parsedAmount} ${tokenType})...`);

      try {
        let recipientKey: PublicKey;
        try {
          recipientKey = new PublicKey(trimmedRecipient);
        } catch {
          throw new Error('Invalid recipient address. Please enter a valid Solana wallet address.');
        }
        
        // Check if the recipient is a valid wallet (on curve) - warn but allow PDAs
        const isOnCurve = PublicKey.isOnCurve(recipientKey.toBytes());
        if (!isOnCurve) {
          console.warn('Recipient address is off-curve (PDA). This may be intentional for program accounts.');
        }
        
        // IMPORTANT: For shielded transfers, always use NOC_TOKEN_MINT
        // SOL can be shielded but is stored as NOC token internally
        // The tokenType field tracks what token it actually is
        const mintKey = new PublicKey(NOC_TOKEN_MINT);
        const walletAddress = keypair.publicKey.toBase58();
        console.log('Current wallet address:', walletAddress);
        console.log('Recipient address:', trimmedRecipient, 'isOnCurve:', isOnCurve);
        console.log('Total notes in store:', shieldedNotes.length);
        
        // Filter notes by token type - use tokenType field which is the source of truth
        const availableNotes = shieldedNotes.filter((note) => {
          const ownerMatch = note.owner === walletAddress;
          console.log(`[startShieldedTransfer] Note ${note.nullifier.slice(0,8)}... owner=${note.owner?.slice(0,8)}... ownerMatch=${ownerMatch} spent=${note.spent} tokenType=${note.tokenType}`);
          if (note.spent || !ownerMatch) return false;
          
          // Filter strictly by tokenType field
          if (tokenType === 'SOL') {
            return note.tokenType === 'SOL';
          } else {
            // For NOC, accept both 'NOC' and undefined (backwards compatibility)
            return note.tokenType === 'NOC' || !note.tokenType;
          }
        });
        console.log(`[startShieldedTransfer] Available ${tokenType} notes after filtering:`, availableNotes.length, 'out of', shieldedNotes.length, 'total');
        if (!availableNotes.length) {
          throw new Error(`No shielded ${tokenType} balance. Add a deposit before spending.`);
        }
        
        // DEBUG: Log all notes for troubleshooting
        console.log('[startShieldedTransfer] All shielded notes:', shieldedNotes.map(n => ({
          nullifier: n.nullifier.slice(0, 8),
          amount: n.amount,
          tokenType: n.tokenType,
          spent: n.spent,
          owner: n.owner?.slice(0, 8),
        })));
        
        // Find a note with sufficient balance, or the largest note if none is big enough
        // Sort by amount descending to prefer larger notes
        const sortedNotes = [...availableNotes].sort((a, b) => 
          Number(BigInt(b.amount) - BigInt(a.amount))
        );
        
        // Find a note that can cover the requested amount
        const spendNote = sortedNotes.find(n => BigInt(n.amount) >= atoms) || sortedNotes[0];
        console.log('Selected spend note:', spendNote);
        const noteAmount = BigInt(spendNote.amount);
        
        // Calculate total available across all notes for better error message
        const totalAvailable = availableNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
        const totalAvailableDisplay = Number(totalAvailable) / Math.pow(10, decimals);
        
        // Check if amount is at least the minimum (0.25 NOC fee for privacy)
        // This applies only to the amount being sent - user must account for fees separately
        const minAmount = PRIVACY_FEE_ATOMS;
        if (atoms < minAmount && tokenType === 'NOC') {
          const minDisplay = Number(minAmount) / 1_000_000;
          throw new Error(`Minimum shielded ${tokenType} transfer is ${minDisplay} ${tokenType} (for privacy fee). Cannot send less than this.`);
        }
        
        // Determine the correct mint for the ATA
        // For SOL transfers, use WSOL_MINT; for NOC, use NOC_TOKEN_MINT
        const ataMintKey = tokenType === 'SOL' ? new PublicKey(WSOL_MINT) : new PublicKey(NOC_TOKEN_MINT);
        
        if (atoms > noteAmount) {
          // Multi-note spend: Check if we have enough total
          if (atoms <= totalAvailable) {
            // We have enough across multiple notes - use transfer-multi circuit
            console.log('[Transfer] ✓ Multi-note transfer detected:', {
              requested: parsedAmount,
              noteAmount,
              totalAvailable: totalAvailableDisplay.toFixed(decimals === 9 ? 9 : 6),
              availableNotes: availableNotes.length,
            });

            const MAX_NOTES = 4; // circuit input cap
            const feeAtoms = tokenType === 'NOC' ? PRIVACY_FEE_ATOMS : 0n;
            const totalNeeded = atoms + feeAtoms;
            let selectedNotes: typeof availableNotes = [];
            try {
              const selection = selectNotesForAmount(totalNeeded, availableNotes, tokenType === 'SOL' ? 'SOL' : 'NOC', MAX_NOTES);
              selectedNotes = selection.selectedNotes;
            } catch (err) {
              // Not enough notes in the first 4 - check if we can consolidate
              const totalAcrossAll = availableNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
              const couldCoverWithMore = totalAcrossAll >= totalNeeded && availableNotes.length > MAX_NOTES;
              
              if (couldCoverWithMore) {
                // Auto-consolidation: merge many notes into fewer ones
                console.log('[Transfer] ⚡ AUTO-CONSOLIDATION TRIGGERED:', {
                  availableNotes: availableNotes.length,
                  needed: totalNeeded.toString(),
                  totalAvailable: totalAcrossAll.toString(),
                });
                
                setStatus(`Consolidating ${availableNotes.length} notes into 2-4 notes… (this may take 2-3 min)`);
                
                // Partition notes for consolidation (groups of up to 8 at a time)
                // Ensure all notes have matching token mints before consolidation
                const expectedTokenMint = mintKey.toBase58();
                const notesWithMatchingMint = availableNotes.filter(n => n.tokenMintAddress === expectedTokenMint);
                
                if (notesWithMatchingMint.length < availableNotes.length) {
                  console.warn('[Transfer] Filtered notes with mismatched token mints for consolidation', {
                    totalAvailable: availableNotes.length,
                    matchingMint: notesWithMatchingMint.length,
                    expectedMint: expectedTokenMint,
                  });
                }
                
                const consolidationSteps = partitionNotesForConsolidation(notesWithMatchingMint, mintKey);
                const consolidatedNotes: ShieldedNoteRecord[] = [];
                const walletAddress = keypair.publicKey.toBase58();
                
                // Build the complete merkle tree with all notes (spent and unspent)
                const allNotesInTree = [...shieldedNotes, ...consolidatedNotes];
                
                for (let stepIdx = 0; stepIdx < consolidationSteps.length; stepIdx++) {
                  const step = consolidationSteps[stepIdx];
                  const stepNum = stepIdx + 1;
                  
                  setStatus(`Consolidating batch ${stepNum}/${consolidationSteps.length}… (proof generation ~30-60s)`);
                  console.log(`[Transfer] Consolidation step ${stepNum}: merging ${step.inputNotes.length} notes`);
                  
                  // Build witness using all notes in the tree for merkle proof
                  const consolidateWitness = buildConsolidationWitness({
                    inputRecords: step.inputRecords,
                    outputNote: step.outputNote,
                    allNotesForMerkle: allNotesInTree,
                  });
                  
                  // Generate proof
                  const consolidateProof = await proveCircuit('consolidate', consolidateWitness);
                  console.log(`[Transfer] Consolidation proof ${stepNum} generated`);
                  
                  // Relay consolidation
                  setStatus(`Submitting consolidation ${stepNum}/${consolidationSteps.length}…`);
                  const relayResult = await relayConsolidate({
                    proof: consolidateProof,
                    inputNullifiers: step.inputNotes.map(n => n.nullifier.toString()),
                    outputCommitment: step.outputNote.commitment.toString(),
                  });
                  console.log(`[Transfer] Consolidation ${stepNum} submitted:`, relayResult.signature);
                  
                  // Mark input notes as spent
                  step.inputRecords.forEach(note => markNoteSpent(note.nullifier));
                  
                  // Add consolidated note to our tracking
                  const consolidatedRecord: ShieldedNoteRecord = {
                    owner: walletAddress,
                    commitment: step.outputNote.commitment.toString(),
                    nullifier: step.outputNote.nullifier.toString(),
                    secret: step.outputNote.secret.toString(),
                    blinding: step.outputNote.blinding.toString(),
                    rho: step.outputNote.rho.toString(),
                    tokenMintAddress: mintKey.toBase58(),
                    tokenMintField: step.outputNote.tokenMint.toString(),
                    amount: step.outputNote.amount.toString(),
                    spent: false,
                    leafIndex: -1,
                    createdAt: Date.now(),
                    tokenType: tokenType as 'SOL' | 'NOC',
                  };
                  consolidatedNotes.push(consolidatedRecord);
                  allNotesInTree.push(consolidatedRecord);
                  addShieldedNote(consolidatedRecord);
                }
                
                // Now retry transfer with consolidated notes
                console.log('[Transfer] Consolidation complete. Retrying transfer with consolidated notes.');
                setStatus('Consolidation complete. Processing your transfer...');
                availableNotes.length = 0;
                availableNotes.push(...consolidatedNotes);
                
                const selection = selectNotesForAmount(totalNeeded, availableNotes, tokenType === 'SOL' ? 'SOL' : 'NOC', MAX_NOTES);
                selectedNotes = selection.selectedNotes;
              } else {
                const message = err instanceof Error ? err.message : 'Failed to select notes';
                const suffix = couldCoverWithMore
                  ? 'Circuit currently supports up to 4 inputs; consolidate notes or reduce amount.'
                  : 'Not enough shielded balance.';
                throw new Error(`${message}. Tried up to ${MAX_NOTES} notes to satisfy ${Number(totalNeeded) / Math.pow(10, decimals)} ${tokenType}. ${suffix}`);
              }
            }

            console.log('[Transfer] Selected', selectedNotes.length, 'notes for transfer-multi');

            const inputNotes = selectedNotes.map(note => ({
              secret: BigInt(note.secret),
              amount: BigInt(note.amount),
              tokenMint: BigInt(note.tokenMintField),
              blinding: BigInt(note.blinding),
              rho: BigInt(note.rho),
              commitment: BigInt(note.commitment),
              nullifier: BigInt(note.nullifier),
            }));

            // Calculate total input amount from the selected notes
            const totalInputAmount = inputNotes.reduce((sum, note) => sum + note.amount, 0n);
            console.log('[Transfer] Selected notes total:', Number(totalInputAmount) / Math.pow(10, decimals), tokenType);

            // For SOL transfers: fee is in NOC (separate check below)
            // For NOC transfers: fee is deducted from NOC amount
            const recipientNoteAmount = atoms + feeAtoms;
            const changeAmount = totalInputAmount - recipientNoteAmount;

            if (changeAmount < 0n) {
              const totalNeeded = Number(recipientNoteAmount) / Math.pow(10, decimals);
              const feeDisplay = tokenType === 'NOC' ? ' + 0.25 NOC fee' : '';
              throw new Error(`The selected ${selectedNotes.length} notes total ${Number(totalInputAmount) / Math.pow(10, decimals)} ${tokenType}, but you need ${totalNeeded} ${tokenType} (${parsedAmount} ${tokenType}${feeDisplay}). Use a smaller amount or consolidate more notes.`);
            }

            // For SOL transfers, verify NOC fee balance separately
            if (tokenType === 'SOL') {
              console.log('[Transfer] Multi-note SOL transfer - checking NOC fee balance...');
              const nocNotes = shieldedNotes.filter(n => 
                !n.spent && 
                n.owner === walletAddress && 
                (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
              );
              const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
              if (totalNocAvailable < PRIVACY_FEE_ATOMS) {
                const errorMsg = `Insufficient NOC for privacy fee. Need 0.25 NOC but only have ${Number(totalNocAvailable) / 1_000_000} NOC shielded.`;
                console.error('[Transfer] ❌ INSUFFICIENT NOC FEE:', errorMsg);
                setStatus(errorMsg);
                throw new Error(errorMsg);
              }
              console.log('[Transfer] ✓ Sufficient NOC for privacy fee');
            }

            // Create Merkle proofs for each selected note
            const merkleProofsMulti = selectedNotes.map(note => buildMerkleProof(availableNotes, note));

            const recipientNote = createNoteFromSecrets(recipientNoteAmount, mintKey);
            const changeNote = createNoteFromSecrets(changeAmount, mintKey);

            console.log('[Transfer] Serializing transfer-multi witness...');
            const transferMultiWitness = serializeTransferMultiWitness({
              inputNotes,
              merkleProofs: merkleProofsMulti,
              outputNote1: recipientNote,
              outputNote2: changeNote,
            });
            console.log('[Transfer] Transfer-multi witness serialized');

            setStatus('Generating multi-note proof…');
            console.log('[Transfer] Calling proveCircuit(transfer-multi)...');
            const proof = await proveCircuit('transfer-multi', transferMultiWitness);
            console.log('[Transfer] Multi-note proof received!');

            logProofPayload('transfer-multi', {
              inputNullifiers: inputNotes.map(n => n.nullifier.toString()),
              merkleRoot: merkleProofsMulti[0].root.toString(),
              outputCommitment1: recipientNote.commitment.toString(),
              outputCommitment2: changeNote.commitment.toString(),
              publicInputs: proof.publicInputs,
              proofBytesPreview: `${proof.proofBytes.slice(0, 48)}…`,
            });

            const recipientAta = getAssociatedTokenAddressSync(ataMintKey, recipientKey, true).toBase58();

            // Store state for the two-step process
            setPendingWithdrawalProof(proof);
            setPendingWithdrawalNote(spendNote);
            setPendingRecipientAta(recipientAta);

            // Continue with the rest of the transfer flow...
            // (The code will continue below as normal)
          } else {
            const errorMsg = `Insufficient shielded balance. You have ${totalAvailableDisplay.toFixed(decimals === 9 ? 9 : 6)} ${tokenType} shielded, but tried to send ${parsedAmount} ${tokenType}.`;
            console.error('[Transfer] ❌ INSUFFICIENT BALANCE:', errorMsg);
            setStatus(errorMsg);
            throw new Error(errorMsg);
          }
        }
        
        // IMPORTANT: For SOL transfers, verify that we have enough NOC for the 0.25 NOC privacy fee
        if (tokenType === 'SOL') {
          console.log('[Transfer] Checking NOC fee balance for SOL transfer...');
          const nocNotes = shieldedNotes.filter(n => 
            !n.spent && 
            n.owner === walletAddress && 
            (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
          );
          console.log('[Transfer] Found NOC notes for fee:', nocNotes.length);
          const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
          console.log('[Transfer] Total NOC available for fee:', Number(totalNocAvailable) / 1_000_000, 'NOC');
          if (totalNocAvailable < PRIVACY_FEE_ATOMS) {
            const errorMsg = `Insufficient NOC for privacy fee. Need 0.25 NOC but only have ${Number(totalNocAvailable) / 1_000_000} NOC shielded.`;
            console.error('[Transfer] ❌ INSUFFICIENT NOC FEE:', errorMsg);
            setStatus(errorMsg);
            throw new Error(errorMsg);
          }
          console.log('[Transfer] ✓ Sufficient NOC for privacy fee');
        }

        // For NOC transfers, verify that we have enough SOL in transparent balance for network fees
        if (tokenType === 'NOC') {
          console.log('[Transfer] Checking SOL balance for NOC transfer network fees...');
          const minSolForFee = 0.00005; // Minimum SOL needed for network fee
          console.log('[Transfer] Transparent SOL balance:', solBalance, 'SOL, needed:', minSolForFee, 'SOL');
          if (solBalance < minSolForFee) {
            const errorMsg = `Insufficient SOL for network fees. Need at least ${minSolForFee} SOL in transparent balance to withdraw ${parsedAmount} NOC from shielded vault. Current transparent balance: ${solBalance} SOL.`;
            console.error('[Transfer] ❌ INSUFFICIENT SOL FOR FEES:', errorMsg);
            setStatus(errorMsg);
            throw new Error(errorMsg);
          }
          console.log('[Transfer] ✓ Sufficient SOL for network fees');
        }
        
        setStatus('Building Merkle proof…');
        console.log('[Transfer] About to build Merkle proof with', availableNotes.length, 'available notes');
        const merkleProof = buildMerkleProof(availableNotes, spendNote);
        console.log('[Transfer] Merkle proof built successfully');
        
        const inputNote: Note = {
          secret: BigInt(spendNote.secret),
          amount: noteAmount,
          tokenMint: BigInt(spendNote.tokenMintField),
          blinding: BigInt(spendNote.blinding),
          rho: BigInt(spendNote.rho),
          commitment: BigInt(spendNote.commitment),
          nullifier: BigInt(spendNote.nullifier),
        };

        // For shielded sends, we withdraw to the recipient's transparent wallet
        // Check fee headroom for NOC transparent payout: amount + 0.25 NOC must fit in the note
        if (tokenType === 'NOC' && transparentPayout) {
          const feeAtoms = PRIVACY_FEE_ATOMS;
          if (noteAmount <= atoms + feeAtoms) {
            const minNeeded = Number(atoms + feeAtoms) / Math.pow(10, decimals);
            throw new Error(`Need at least ${minNeeded.toFixed(decimals === 9 ? 9 : 6)} ${tokenType} in the selected note to cover amount plus 0.25 NOC fee. Use a slightly smaller amount or a larger/consolidated note.`);
          }
        }

        // Check if this is a partial spend - if so, we need to split the note first
        const isPartialSpend = atoms < noteAmount;
        console.log('[Transfer] isPartialSpend:', isPartialSpend, 'atoms:', atoms.toString(), 'noteAmount:', noteAmount.toString());
        
        if (isPartialSpend) {
          // Partial spend: First split the note using transfer circuit
          // Then the recipient amount will be withdrawn to their transparent wallet
          // Fee is deducted from change note (kept shielded) - NOT from recipient amount
          const feeAtoms = PRIVACY_FEE_ATOMS; // Keep as bigint for precision
          const recipientNoteAmount = atoms + feeAtoms; // recipient amount plus fee for withdraw circuit
          const totalNeeded = recipientNoteAmount;
          const changeAmount = noteAmount - totalNeeded;
          
          // Ensure user has enough for amount + fee
          if (changeAmount < 0n) {
            const totalNeededDisplay = Number(totalNeeded) / Math.pow(10, decimals);
            const noteDisplay = Number(noteAmount) / Math.pow(10, decimals);
            throw new Error(`Insufficient shielded ${tokenType} balance. Need ${totalNeededDisplay.toFixed(decimals === 9 ? 9 : 6)} ${tokenType} (${parsedAmount} ${tokenType} + 0.25 NOC fee), but this note only has ${noteDisplay.toFixed(decimals === 9 ? 9 : 6)} ${tokenType}. Use a smaller amount or consolidate notes.`);
          }
          
          // Log the fee breakdown for verification
          console.log('[Transfer] CRITICAL: Fee verification for partial spend:', {
            requestedAmount: Number(atoms) / Math.pow(10, decimals),
            privacyFeeNoc: Number(feeAtoms) / 1_000_000,
            totalFromShielded: Number(totalNeeded) / Math.pow(10, decimals),
            changeRemaining: Number(changeAmount) / Math.pow(10, decimals),
            tokenType,
            allFromShieldedBalance: true,
            transparentBalanceUntouched: true,
          });
          
          console.log('[Transfer] Creating change note for:', changeAmount.toString());
          console.log('[Transfer] Recipient note amount (includes fee):', recipientNoteAmount.toString());
          console.log('[Transfer] Privacy fee (from change):', feeAtoms.toString());
          
          // Create change note back to ourselves (we keep this shielded)
          // This note is reduced by both the recipient amount AND the privacy fee
          const changeNote = createNoteFromSecrets(changeAmount, mintKey);
          console.log('[Transfer] Change note created (stays shielded, fee already deducted)');
          
          // Create a note for the recipient amount PLUS fee
          // Withdraw step will collect 0.25 NOC and send remainder to recipient
          const recipientNote = createNoteFromSecrets(recipientNoteAmount, mintKey);
          console.log('[Transfer] Recipient note created (contains recipient amount + fee for withdraw)');
          
          console.log('[Transfer] Serializing transfer witness...');
          const transferWitness = serializeTransferWitness({
            inputNote,
            merkleProof,
            outputNote1: recipientNote,
            outputNote2: changeNote,
          });
          console.log('[Transfer] Transfer witness serialized:', Object.keys(transferWitness));
          
          setStatus('Generating split proof for partial spend…');
          console.log('[Transfer] Calling proveCircuit(transfer)...');
          const proof = await proveCircuit('transfer', transferWitness);
          console.log('[Transfer] Proof received!');
          logProofPayload('transfer-split', {
            inputNullifier: spendNote.nullifier,
            merkleRoot: merkleProof.root.toString(),
            outputCommitment1: recipientNote.commitment.toString(),
            outputCommitment2: changeNote.commitment.toString(),
            publicInputs: proof.publicInputs,
            proofBytesPreview: `${proof.proofBytes.slice(0, 48)}…`,
          });
          
          const recipientAta = getAssociatedTokenAddressSync(ataMintKey, recipientKey, true).toBase58();
          
          // Store state for the two-step process
          setPendingWithdrawalProof(proof);
          setPendingWithdrawalNote(spendNote);
          setPendingRecipientAta(recipientAta);
          
          // Encode recipient note for sharing
          const sharedNote = encodeSharedNote(recipientNote, mintKey, tokenType);
          
          (window as unknown as Record<string, unknown>).__pendingTransfer = {
            isPartial: true,
            recipientNote,
            changeNote,
            recipientKey: recipientKey.toBase58(),
            recipientAta,
            atoms,
            feeAtoms: PRIVACY_FEE_ATOMS.toString(),
          };
          
          console.log('[Transfer] Opening review modal (partial spend)');
          console.log('[Transfer] Opening review modal (partial spend)');
          const recipientZkHash = await computeZkHash(trimmedRecipient, tokenType, atoms);

          setTransferReview({
            recipient: trimmedRecipient,
            recipientZkHash,
            amount: parsedAmount,
            atoms,
            feeNoc: 0.25, // Privacy fee deducted from shielded balance (change note)
            isPartialSpend: true,
            changeAmount: Number(changeAmount) / Math.pow(10, decimals),
            tokenType,
            sharedNote,
            transparentPayout,
          });
          setStatus(`Review: Sending ${parsedAmount} ${tokenType} to recipient (privacy fee 0.25 NOC deducted from change). Change: ${(Number(changeAmount) / Math.pow(10, decimals)).toFixed(decimals === 9 ? 9 : 6)} ${tokenType} stays shielded. ALL FUNDS FROM SHIELDED BALANCE.`);
        } else {
          // Full spend: use withdraw circuit
          // For full spend, privacy fee MUST still be deducted
          // Since we're sending the full note, we need to check if recipient gets full amount or reduced by fee
          const feeAtoms = PRIVACY_FEE_ATOMS;
          
          // IMPORTANT: Full spend means sending all of the note amount
          // But 0.25 NOC fee must still be paid from shielded funds
          // If sending NOC: deduct fee from amount (recipient gets less)
          // If sending SOL: fee comes from NOC balance (need separate check)
          let recipientAmount = atoms;
          let feeFromRecipient = 0n;
          
          if (tokenType === 'NOC') {
            // For NOC transfers, recipient should receive the full amount.
            // Privacy fee (0.25 NOC) must be paid from shielded vault separately.
            // Require additional NOC across shielded notes to cover the fee.
            const nocNotes = shieldedNotes.filter(n =>
              !n.spent &&
              n.owner === keypair.publicKey.toBase58() &&
              (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
            );
            const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
            if (totalNocAvailable < feeAtoms) {
              throw new Error(`Insufficient NOC for privacy fee. Need 0.25 NOC but only have ${Number(totalNocAvailable) / 1_000_000} NOC shielded.`);
            }
            // Recipient receives full NOC amount; fee paid separately via relayer.
            recipientAmount = atoms;
            feeFromRecipient = 0n;
          } else if (tokenType === 'SOL') {
            // For SOL transfers, 0.25 NOC fee must come from shielded NOC balance
            // User must have at least 0.25 NOC shielded separately
            const nocNotes = shieldedNotes.filter(n => 
              !n.spent && 
              n.owner === keypair.publicKey.toBase58() && 
              (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
            );
            const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
            if (totalNocAvailable < feeAtoms) {
              throw new Error(`Insufficient NOC for privacy fee. Need 0.25 NOC but only have ${Number(totalNocAvailable) / 1_000_000} NOC shielded.`);
            }
            // Recipient gets full SOL amount, fee paid separately in NOC
            feeFromRecipient = 0n;
          }
          
          console.log('[Transfer] CRITICAL: Fee verification for full spend:', {
            requestedAmount: Number(atoms) / Math.pow(10, decimals),
            privacyFeeNoc: Number(feeAtoms) / 1_000_000,
            recipientWillReceive: Number(recipientAmount) / Math.pow(10, decimals),
            tokenType,
            feeDeductedFromRecipient: Number(feeFromRecipient) > 0,
            allFromShieldedBalance: true,
            transparentBalanceUntouched: true,
          });
          
          console.log('[Transfer] Full spend - using withdraw circuit');
          const witness = serializeWithdrawWitness({
            inputNote,
            merkleProof,
            receiver: pubkeyToField(recipientKey),
          });
          console.log('[Transfer] Withdraw witness serialized');
          setStatus('Generating shielded proof…');
          console.log('[Transfer] Calling proveCircuit(withdraw)...');
          const proof = await proveCircuit('withdraw', witness);
          console.log('[Transfer] Withdraw proof received!');
          logProofPayload('withdraw', {
            inputNullifier: spendNote.nullifier,
            merkleRoot: merkleProof.root.toString(),
            publicInputs: proof.publicInputs,
            proofBytesPreview: `${proof.proofBytes.slice(0, 48)}…`,
            receiver: recipientKey.toBase58(),
          });
          const recipientAta = getAssociatedTokenAddressSync(ataMintKey, recipientKey, true).toBase58();
          
          // For full spend, create a note for recipient (shielded-to-shielded)
          // But amount should reflect fee deduction if applicable
          const recipientNote = createNoteFromSecrets(recipientAmount, mintKey);
          const sharedNote = encodeSharedNote(recipientNote, mintKey, tokenType);
          const recipientZkHash = await computeZkHash(trimmedRecipient, tokenType, recipientAmount);
          
          setPendingWithdrawalProof(proof);
          setPendingWithdrawalNote(spendNote);
          setPendingRecipientAta(recipientAta);
          
          (window as unknown as Record<string, unknown>).__pendingTransfer = {
            isPartial: false,
            recipientNote,
            recipientKey: recipientKey.toBase58(),
            recipientAta,
            atoms: recipientAmount, // Updated to reflect fee deduction
            originalAmount: atoms,
            feeAtoms: feeAtoms.toString(),
          };
          
          console.log('[Transfer] Opening review modal (full spend)');
          console.log('[Transfer] Opening review modal (full spend)');
          setTransferReview({
            recipient: trimmedRecipient,
            recipientZkHash,
            amount: Number(recipientAmount) / Math.pow(10, decimals), // Updated to show net amount after fee
            atoms: recipientAmount,
            feeNoc: 0.25, // Privacy fee applies to all shielded transfers
            tokenType,
            sharedNote,
            transparentPayout,
          });
          
          const feeNote = tokenType === 'NOC' ? `(fee deducted from amount)` : `(fee paid in NOC)`;
          setStatus(`Review the shielded ${tokenType} transfer. Recipient receives: ${(Number(recipientAmount) / Math.pow(10, decimals)).toFixed(decimals === 9 ? 9 : 6)} ${tokenType}. Privacy fee: 0.25 NOC (charged from vault). ALL FUNDS FROM SHIELDED BALANCE.`);
        }
      } catch (err) {
        resetPendingShieldedTransfer();
        const message = (err as Error).message;
        setShieldedSendError(message);
        setStatus(message);
        throw err;
      } finally {
        setShieldedSendPending(false);
      }
    },
    [keypair, shieldedNotes, transparentPayout, resetPendingShieldedTransfer],
  );
  const confirmShieldedTransfer = useCallback(async () => {
    console.log('confirmShieldedTransfer called', {
      hasKeypair: !!keypair,
      hasTransferReview: !!transferReview,
      hasPendingWithdrawalProof: !!pendingWithdrawalProof,
      hasPendingWithdrawalNote: !!pendingWithdrawalNote,
      hasPendingRecipientAta: !!pendingRecipientAta,
    });
    
    // Check for transfer state
    const pendingTransfer = (window as unknown as Record<string, unknown>).__pendingTransfer as {
      isPartial?: boolean;
      isAutoConsolidate?: boolean;
      isSequentialConsolidate?: boolean;
      consolidateProof?: ProverResponse;
      withdrawProof?: ProverResponse;
      consolidatedNote?: Note;
      recipientNote?: Note;
      changeNote?: Note;
      recipientKey?: string;
      recipientAta?: string;
      atoms?: bigint;
      allNotesUsed?: string[];
      tokenType?: 'NOC' | 'SOL';
      allNotes?: ShieldedNoteRecord[];
      targetAmount?: bigint;
      totalAvailable?: bigint;
      changeAmount?: bigint;
      feeAtoms?: string;
    } | undefined;
    
    const isPartialTransfer = pendingTransfer?.isPartial && transferReview?.isPartialSpend;
    const isAutoConsolidate = pendingTransfer?.isAutoConsolidate;
    const isSequentialConsolidate = pendingTransfer?.isSequentialConsolidate;
    
    if (!keypair || !transferReview) {
      console.log('Missing required state, returning early');
      return;
    }
    
    // For non-sequential consolidate, we need the withdrawal proof and note
    if (!isSequentialConsolidate && (!pendingWithdrawalProof || !pendingWithdrawalNote)) {
      console.log('Missing withdrawal proof/note (non-sequential case)');
      return;
    }
    
    // For non-sequential non-partial, we need the recipient ATA
    if (!isSequentialConsolidate && !isPartialTransfer && !pendingRecipientAta) {
      console.log('Missing recipient ATA for full withdrawal');
      return;
    }
    
    try {
      setConfirmingTransfer(true);
      
      if (isSequentialConsolidate && pendingTransfer?.allNotes && pendingTransfer?.recipientKey) {
        // Sequential consolidation: combine notes one by one using transfer circuit
        const notes = pendingTransfer.allNotes.filter(n => !n.spent);
        const tokenType = pendingTransfer.tokenType || 'NOC';
        const mintKey = new PublicKey(tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT);
        const walletAddress = keypair.publicKey.toBase58();
        
        console.log('[SequentialConsolidate] Starting consolidation of', notes.length, 'notes');
        
        let consolidatedAmount = BigInt(notes[0].amount);
        let currentNullifier = notes[0].nullifier;
        let consolidatedNotes: ShieldedNoteRecord[] = [];
        let currentNote = notes[0]; // Track the current note we're spending
        
        // Step 1: Combine all notes using transfer circuit iteratively
        for (let i = 1; i < notes.length; i++) {
          setStatus(`Consolidating note ${i}/${notes.length - 1}... (this may take 1-2 min)`);
          
          const nextNote = notes[i];
          const nextAmount = BigInt(nextNote.amount);
          
          // For merkle proof, include both original unspent notes AND previously consolidated notes
          // This way, proofs for later consolidation steps can reference the intermediate consolidated notes
          const allNotesForMerkle = [
            ...shieldedNotes.filter(n => n.owner === walletAddress && !n.spent),
            ...consolidatedNotes,
          ];
          
          const merkleProof = buildMerkleProof(allNotesForMerkle, currentNote);
          
          // Create transfer witness: input is the CURRENT note we're spending (original or previously consolidated)
          const inputNote: Note = {
            secret: BigInt(currentNote.secret),
            amount: consolidatedAmount,
            tokenMint: BigInt(currentNote.tokenMintField),
            blinding: BigInt(currentNote.blinding),
            rho: BigInt(currentNote.rho),
            commitment: BigInt(currentNote.commitment),
            nullifier: BigInt(currentNote.nullifier),
          };
          
          const newConsolidatedAmount = consolidatedAmount + nextAmount;
          
          // Create new consolidated note and dummy note using existing helper
          const newConsolidatedNote = createNoteFromSecrets(newConsolidatedAmount, mintKey);
          const dummy = createNoteFromSecrets(0n, mintKey);
          
          console.log('[SequentialConsolidate] Generating transfer proof for step', i);
          const witness = serializeTransferWitness({
            inputNote,
            merkleProof,
            outputNote1: newConsolidatedNote,
            outputNote2: dummy,
          });
          
          const proof = await proveCircuit('transfer', witness);
          console.log('[SequentialConsolidate] Transfer proof generated, submitting to relayer');
          
          // Submit to relayer
          const result = await relayTransfer({
            proof,
            nullifier: currentNote.nullifier,
            outputCommitment1: newConsolidatedNote.commitment.toString(),
            outputCommitment2: dummy.commitment.toString(),
          });
          
          console.log('[SequentialConsolidate] Step', i, 'succeeded:', result.signature);
          markNoteSpent(currentNote.nullifier);
          
          // Store the consolidated note for next iteration
          const newConsolidatedRecord: ShieldedNoteRecord = {
            owner: walletAddress,
            commitment: newConsolidatedNote.commitment.toString(),
            nullifier: newConsolidatedNote.nullifier.toString(),
            secret: newConsolidatedNote.secret.toString(),
            blinding: newConsolidatedNote.blinding.toString(),
            rho: newConsolidatedNote.rho.toString(),
            tokenMintAddress: mintKey.toBase58(),
            tokenMintField: newConsolidatedNote.tokenMint.toString(),
            amount: newConsolidatedAmount.toString(),
            spent: false,
            leafIndex: -1,
            createdAt: Date.now(),
            tokenType,
          };
          
          consolidatedNotes.push(newConsolidatedRecord);
          addShieldedNote(newConsolidatedRecord);
          
          // Update for next iteration - use the consolidated note record for next proof
          consolidatedAmount = newConsolidatedAmount;
          currentNullifier = newConsolidatedNote.nullifier.toString();
          currentNote = newConsolidatedRecord; // Use the newly consolidated note for next iteration
        }
        
        console.log('[SequentialConsolidate] All notes consolidated. Total:', Number(consolidatedAmount) / (tokenType === 'SOL' ? 1e9 : 1e6), tokenType);
        
        // Step 2: Withdraw from consolidated note to recipient
        setStatus('Withdrawing to recipient...');
        
        const recipientKey = new PublicKey(pendingTransfer.recipientKey);
        const allNotesForFinalMerkle = [
          ...shieldedNotes.filter(n => n.owner === walletAddress && !n.spent),
          ...consolidatedNotes,
        ];
        
        // Find the final consolidated note
        const finalConsolidatedNote = consolidatedNotes[consolidatedNotes.length - 1];
        const finalMerkleProof = buildMerkleProof(allNotesForFinalMerkle, finalConsolidatedNote);
        
        const withdrawInputNote: Note = {
          secret: BigInt(finalConsolidatedNote.secret),
          amount: consolidatedAmount,
          tokenMint: BigInt(finalConsolidatedNote.tokenMintField),
          blinding: BigInt(finalConsolidatedNote.blinding),
          rho: BigInt(finalConsolidatedNote.rho),
          commitment: BigInt(finalConsolidatedNote.commitment),
          nullifier: BigInt(finalConsolidatedNote.nullifier),
        };
        
        const withdrawWitness = serializeWithdrawWitness({
          inputNote: withdrawInputNote,
          merkleProof: finalMerkleProof,
          receiver: pubkeyToField(recipientKey),
        });
        
        const withdrawProof = await proveCircuit('withdraw', withdrawWitness);
        
        const recipientAta = getAssociatedTokenAddressSync(mintKey, recipientKey, true).toBase58();
        
        if (tokenType === 'NOC') {
          const res = await relayWithdraw({
            proof: withdrawProof,
            amount: pendingTransfer.targetAmount!.toString(),
            nullifier: finalConsolidatedNote.nullifier,
            recipientAta,
            mint: mintKey.toBase58(),
            collectFee: true, // Collect 0.25 NOC fee from vault
          });
          console.log('[SequentialConsolidate] Withdrawal succeeded:', res.signature);
        } else {
          const res = await relayWithdraw({
            proof: withdrawProof,
            amount: pendingTransfer.targetAmount!.toString(),
            nullifier: finalConsolidatedNote.nullifier,
            recipientAta,
            mint: mintKey.toBase58(),
            collectFee: false, // Fee already collected if needed
          });
          console.log('[SequentialConsolidate] Withdrawal succeeded:', res.signature);
        }
        
        markNoteSpent(finalConsolidatedNote.nullifier);
        delete (window as unknown as Record<string, unknown>).__pendingTransfer;
        setStatus(`✅ Multi-note send complete! Consolidated ${notes.length} notes and sent ${Number(pendingTransfer.targetAmount) / (tokenType === 'SOL' ? 1e9 : 1e6)} ${tokenType}.`);
        setTransferReview(null);
        resetPendingShieldedTransfer();
        await refreshBalances();
      } else if (isAutoConsolidate && pendingTransfer?.consolidateProof && pendingTransfer?.withdrawProof && pendingTransfer?.consolidatedNote) {
        // Auto-consolidate flow: consolidate all notes, then withdraw
        setStatus('Step 1/2: Consolidating notes (via relayer)…');
        console.log('[AutoConsolidate] Step 1: Consolidating', pendingTransfer.allNotesUsed?.length, 'notes');
        
        const tokenType = pendingTransfer.tokenType || 'NOC';
        const mintKey = new PublicKey(tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT);
        
        if (!pendingWithdrawalNote) {
          throw new Error('Missing withdrawal note for consolidation');
        }
        
        try {
          const consolidateResult = await relayTransfer({
            proof: pendingTransfer.consolidateProof,
            nullifier: pendingWithdrawalNote.nullifier,
            outputCommitment1: pendingTransfer.consolidatedNote.commitment.toString(),
            outputCommitment2: '0', // Dummy output
          });
          console.log('[AutoConsolidate] Consolidation succeeded:', consolidateResult.signature);
          
          // Mark all used notes as spent
          if (pendingTransfer.allNotesUsed) {
            markMultipleSpent(pendingTransfer.allNotesUsed);
          }
          
          // Add consolidated note
          const consolidatedRecord = snapshotNote(
            pendingTransfer.consolidatedNote,
            keypair.publicKey,
            mintKey,
            { signature: consolidateResult.signature, tokenType }
          );
          addShieldedNote(consolidatedRecord);
          
          // Step 2: Withdraw from consolidated note
          setStatus('Step 2/2: Withdrawing from consolidated note (via relayer)…');
          console.log('[AutoConsolidate] Step 2: Withdrawing', Number(pendingTransfer.atoms) / (tokenType === 'SOL' ? 1e9 : 1e6), tokenType);
          
          if (tokenType === 'NOC') {
            const nocMint = new PublicKey(NOC_TOKEN_MINT);
            const res = await relayWithdraw({
              proof: pendingTransfer.withdrawProof,
              amount: pendingTransfer.atoms!.toString(),
              nullifier: pendingTransfer.consolidatedNote.nullifier.toString(),
              recipientAta: pendingTransfer.recipientAta!,
              mint: nocMint.toBase58(),
              collectFee: true, // Collect 0.25 NOC from vault
            });
            console.log('[AutoConsolidate] Withdrawal succeeded:', res.signature);
            markNoteSpent(pendingTransfer.consolidatedNote.nullifier.toString());
          } else {
            // SOL: collect NOC fee first, then withdraw SOL
            console.log('[AutoConsolidate] SOL withdrawal: collecting NOC fee first');
            // (fee collection code here - same as before)
            const wsolMint = new PublicKey(WSOL_MINT);
            const res = await relayWithdraw({
              proof: pendingTransfer.withdrawProof,
              amount: pendingTransfer.atoms!.toString(),
              nullifier: pendingTransfer.consolidatedNote.nullifier.toString(),
              recipientAta: pendingTransfer.recipientAta!,
              mint: wsolMint.toBase58(),
              collectFee: false,
            });
            console.log('[AutoConsolidate] SOL withdrawal succeeded:', res.signature);
            markNoteSpent(pendingTransfer.consolidatedNote.nullifier.toString());
          }
          
          delete (window as unknown as Record<string, unknown>).__pendingTransfer;
          setStatus(`✅ Send complete! Consolidated ${pendingTransfer.allNotesUsed?.length} notes and sent ${Number(pendingTransfer.atoms) / (tokenType === 'SOL' ? 1e9 : 1e6)} ${tokenType}.`);
          setTransferReview(null);
          resetPendingShieldedTransfer();
          await refreshBalances();
        } catch (err) {
          console.error('[AutoConsolidate] Failed:', err);
          setStatus(`Auto-consolidation failed: ${(err as Error).message}`);
          throw err;
        }
      } else if (isPartialTransfer && pendingTransfer?.changeNote && pendingTransfer?.recipientNote) {
        // Two-step partial transfer via RELAYER for privacy:
        // Step 1: Split the note using transfer circuit (relayed)
        // Step 2: Withdraw the recipient portion to their transparent wallet (relayed)
        
        setStatus('Step 1/2: Splitting note (via relayer for privacy)…');
        console.log('Calling relayTransfer (split)...');
        
        if (!pendingWithdrawalProof || !pendingWithdrawalNote) {
          throw new Error('Missing withdrawal proof or note for split transfer');
        }
        
        // Use relayer to submit transfer - preserves privacy
        const splitResult = await relayTransfer({
          proof: pendingWithdrawalProof,
          nullifier: pendingWithdrawalNote.nullifier,
          outputCommitment1: pendingTransfer.recipientNote.commitment.toString(),
          outputCommitment2: pendingTransfer.changeNote.commitment.toString(),
        });
        const splitSig = splitResult.signature;
        
        console.log('Split succeeded (via relayer):', splitSig);
        
        // Mark old note as spent
        markNoteSpent(pendingWithdrawalNote.nullifier);
        
        // Add the change note to our local state (we keep this one)
        // Use correct mint: WSOL for SOL, NOC for NOC
        const tokenType = transferReview?.tokenType || 'NOC';
        const mintKey = new PublicKey(tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT);
        const changeNoteRecord = snapshotNote(
          pendingTransfer.changeNote,
          keypair.publicKey,
          mintKey,
          { signature: splitSig, tokenType }
        );
        addShieldedNote(changeNoteRecord);
        
        // Check if we should do transparent payout or keep it private
        if (transferReview?.transparentPayout) {
          console.log('[Transfer] Step 2/2: Transparent payout enabled, proceeding with withdrawal...');
          try {
            // Transparent payout: withdraw the recipient note to their transparent wallet
            // First, create a record for the recipient note (temporarily, for merkle proof)
            const recipientNoteRecord = snapshotNote(
              pendingTransfer.recipientNote,
              keypair.publicKey, // We generated it, so we can spend it
              mintKey,
              { signature: splitSig, tokenType: transferReview?.tokenType }
            );
            
            // Build merkle proof including the new notes
            setStatus('Step 2/2: Generating withdrawal proof…');
          
            // Get all notes including the newly added ones
            const allNotes = [...shieldedNotes.filter(n => n.nullifier !== pendingWithdrawalNote.nullifier), changeNoteRecord, recipientNoteRecord];
            console.log('[Transfer] Building merkle proof with', allNotes.length, 'notes');
            const withdrawMerkleProof = buildMerkleProof(allNotes, recipientNoteRecord);
            
            console.log('[Transfer] Serializing withdrawal witness...');
            const withdrawWitness = serializeWithdrawWitness({
              inputNote: pendingTransfer.recipientNote,
              merkleProof: withdrawMerkleProof,
              receiver: pubkeyToField(new PublicKey(pendingTransfer.recipientKey!)),
            });
            
            console.log('[Transfer] Calling proveCircuit(withdraw)...');
            const withdrawProof = await proveCircuit('withdraw', withdrawWitness);
            console.log('[Transfer] Withdrawal proof generated successfully');
            
            setStatus('Submitting withdrawal to recipient (via relayer for privacy)…');
            const recipientPubkeyPartial = new PublicKey(pendingTransfer.recipientKey!);
            const recipientAta = pendingTransfer.recipientAta || getAssociatedTokenAddressSync(mintKey, recipientPubkeyPartial, true).toBase58();
            
            console.log('[Transfer] Calling relayWithdraw for recipient:', pendingTransfer.recipientKey!.slice(0, 8));
            console.log('[Transfer] Withdrawal params:', {
              tokenType,
              mint: mintKey.toBase58(),
              amount: pendingTransfer.atoms!.toString(),
              recipientAta: recipientAta.slice(0, 8) + '...',
            });
            if (tokenType === 'NOC') {
              // Withdraw via relayer so the user key never appears on-chain; relayer also collects fee FROM VAULT
              console.log('[Transfer] Calling relayWithdraw (vault) for recipient:', pendingTransfer.recipientKey!.slice(0, 8));
              let withdrawSig: string;
              try {
                const res = await relayWithdraw({
                  proof: withdrawProof,
                  amount: pendingTransfer.atoms!.toString(),
                  nullifier: pendingTransfer.recipientNote.nullifier.toString(),
                  recipientAta,
                  mint: mintKey.toBase58(),
                  collectFee: true, // Collect 0.25 NOC from shielded vault, not transparent balance
                });
                withdrawSig = res.signature;
              } catch (relayErr) {
                console.error('[Transfer] ❌ Relayer unavailable for NOC withdrawal:', relayErr);
                setStatus('Relayer unavailable. Shielded NOC withdrawal blocked to avoid exposing signer. Please retry.');
                throw relayErr;
              }
              console.log('[Transfer] ✅ Withdrawal to recipient succeeded via relayer (vault):', withdrawSig);
              // Clean up
              delete (window as unknown as Record<string, unknown>).__pendingTransfer;
              setStatus(`Shielded send complete! Split: ${splitSig.slice(0, 8)}…, Withdraw: ${withdrawSig.slice(0, 8)}…`);
              setTransferReview(null);
              resetPendingShieldedTransfer();
              await refreshBalances();
            } else {
              // SOL path: First collect 0.25 NOC fee, then withdraw SOL (both via relayer for privacy)
              console.log('[Transfer] SOL withdrawal: Step 1 - Collecting 0.25 NOC fee from vault...');
              
              // Find a NOC note to pay the fee from
              const walletAddress = keypair.publicKey.toBase58();
              const nocNotes = shieldedNotes.filter(n => 
                !n.spent && 
                n.owner === walletAddress && 
                (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
              );
              
              if (nocNotes.length === 0 || nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n) < PRIVACY_FEE_ATOMS) {
                throw new Error('Insufficient NOC in vault for privacy fee. Need 0.25 NOC shielded.');
              }
              
              // Use the first NOC note for fee payment
              const feeNote = nocNotes.sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))[0];
              const feeMerkleProof = buildMerkleProof(shieldedNotes.filter(n => n.owner === walletAddress && !n.spent), feeNote);
              
              const feeInputNote: Note = {
                secret: BigInt(feeNote.secret),
                amount: BigInt(feeNote.amount),
                tokenMint: BigInt(feeNote.tokenMintField),
                blinding: BigInt(feeNote.blinding),
                rho: BigInt(feeNote.rho),
                commitment: BigInt(feeNote.commitment),
                nullifier: BigInt(feeNote.nullifier),
              };
              
              const nocMint = new PublicKey(NOC_TOKEN_MINT);
              const feeCollectorOwner = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
              const feeCollectorAta = getAssociatedTokenAddressSync(nocMint, feeCollectorOwner, false);
              
              const feeWitness = serializeWithdrawWitness({
                inputNote: feeInputNote,
                merkleProof: feeMerkleProof,
                receiver: pubkeyToField(feeCollectorOwner),
              });
              
              const feeProof = await proveCircuit('withdraw', feeWitness);
              
              try {
                const feeRes = await relayWithdraw({
                  proof: feeProof,
                  amount: PRIVACY_FEE_ATOMS.toString(),
                  nullifier: feeNote.nullifier,
                  recipientAta: feeCollectorAta.toBase58(),
                  mint: nocMint.toBase58(),
                  collectFee: false, // This IS the fee payment
                });
                console.log('[Transfer] ✅ Fee collected from vault:', feeRes.signature);
                markNoteSpent(feeNote.nullifier);
              } catch (feeErr) {
                console.error('[Transfer] ❌ Fee collection failed:', feeErr);
                throw new Error('Failed to collect privacy fee from vault. Please retry.');
              }
              
              // Step 2: Now withdraw SOL
              console.log('[Transfer] SOL withdrawal: Step 2 - Withdrawing SOL from vault...');
              let withdrawSig: string;
              try {
                const wsolMint = new PublicKey(WSOL_MINT);
                const res = await relayWithdraw({
                  proof: withdrawProof,
                  amount: pendingTransfer.atoms!.toString(),
                  nullifier: pendingTransfer.recipientNote.nullifier.toString(),
                  recipientAta,
                  mint: wsolMint.toBase58(),
                  collectFee: false, // Fee already collected above
                });
                withdrawSig = res.signature;
              } catch (relayErr) {
                console.error('[Transfer] ❌ Relayer unavailable for SOL withdrawal:', relayErr);
                setStatus('Relayer unavailable. Shielded SOL withdrawal blocked to avoid exposing signer. Please retry.');
                throw relayErr;
              }
              console.log('[Transfer] ✅ Withdrawal to recipient succeeded (vault):', withdrawSig);
              // Clean up
              delete (window as unknown as Record<string, unknown>).__pendingTransfer;
              setStatus(`Shielded send complete! Split: ${splitSig.slice(0, 8)}…, Withdraw: ${withdrawSig.slice(0, 8)}…`);
              setTransferReview(null);
              resetPendingShieldedTransfer();
              await refreshBalances();
            }
          } catch (withdrawErr) {
            console.error('[Transfer] ❌ Step 2 (withdrawal) failed:', withdrawErr);
            setStatus(`Split succeeded but withdrawal failed: ${(withdrawErr as Error).message}. The ${transferReview.amount} ${transferReview.tokenType} is still shielded. Share the note with recipient.`);
            // Keep the transfer review open so user can copy the shared note
            setPendingSharedNote(transferReview.sharedNote!);
          }
        } else {
          // Private delivery: note stays shielded, share with recipient
          setPendingSharedNote(transferReview.sharedNote!);
          
          // Clean up
          delete (window as unknown as Record<string, unknown>).__pendingTransfer;
          
          setStatus(`Private transfer complete! Split: ${splitSig.slice(0, 8)}… - Recipient note created (copy and share below)`);
          // Keep transferReview open to show shared note
          await refreshBalances();
        }
      } else {
        // Check if transparent payout is enabled
        if (transferReview?.transparentPayout) {
          // Full withdrawal via PROGRAM (vault-sourced). For SOL we still use relayer; for NOC we withdraw directly from vault.
          const tokenType = transferReview?.tokenType || 'NOC';
          const mintKey = new PublicKey(tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT);

          if (tokenType === 'NOC') {
            setStatus('Submitting shielded withdrawal via relayer (from vault)…');
            console.log('[Transfer] Full withdrawal via relayWithdraw (vault):', { tokenType, mint: mintKey.toBase58() });
            
            if (!pendingWithdrawalProof || !pendingWithdrawalNote) {
              throw new Error('Missing withdrawal proof or note');
            }
            
            let signature: string;
            try {
              const res = await relayWithdraw({
                proof: pendingWithdrawalProof,
                amount: transferReview.atoms.toString(),
                nullifier: pendingWithdrawalNote.nullifier.toString(),
                recipientAta: pendingRecipientAta!,
                mint: mintKey.toBase58(),
                collectFee: true, // Collect 0.25 NOC from shielded vault, not transparent ATA
              });
              signature = res.signature;
            } catch (relayErr) {
              console.error('[Transfer] ❌ Relayer unavailable for NOC withdrawal:', relayErr);
              setStatus('Relayer unavailable. Shielded NOC withdrawal blocked to avoid exposing signer. Please retry.');
              throw relayErr;
            }
            console.log('Withdrawal succeeded via relayer (vault):', signature);
            markNoteSpent(pendingWithdrawalNote.nullifier);
            setStatus(`Shielded withdrawal confirmed (${signature.slice(0, 8)}…)`);
            setTransferReview(null);
            resetPendingShieldedTransfer();
            await refreshBalances();
          } else {
            // SOL path: First collect 0.25 NOC fee, then withdraw SOL (both via relayer for privacy)
            setStatus('Collecting privacy fee from vault...');
            console.log('[Transfer] SOL withdrawal: Step 1 - Collecting 0.25 NOC fee from vault...');
            
            // Find a NOC note to pay the fee from
            const walletAddress = keypair.publicKey.toBase58();
            const nocNotes = shieldedNotes.filter(n => 
              !n.spent && 
              n.owner === walletAddress && 
              (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
            );
            
            if (nocNotes.length === 0 || nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n) < PRIVACY_FEE_ATOMS) {
              throw new Error('Insufficient NOC in vault for privacy fee. Need 0.25 NOC shielded.');
            }
            
            // Use the first NOC note for fee payment
            const feeNote = nocNotes.sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))[0];
            const feeMerkleProof = buildMerkleProof(shieldedNotes.filter(n => n.owner === walletAddress && !n.spent), feeNote);
            
            const feeInputNote: Note = {
              secret: BigInt(feeNote.secret),
              amount: BigInt(feeNote.amount),
              tokenMint: BigInt(feeNote.tokenMintField),
              blinding: BigInt(feeNote.blinding),
              rho: BigInt(feeNote.rho),
              commitment: BigInt(feeNote.commitment),
              nullifier: BigInt(feeNote.nullifier),
            };
            
            const nocMint = new PublicKey(NOC_TOKEN_MINT);
            const feeCollectorOwner = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
            const feeCollectorAta = getAssociatedTokenAddressSync(nocMint, feeCollectorOwner, false);
            
            const feeWitness = serializeWithdrawWitness({
              inputNote: feeInputNote,
              merkleProof: feeMerkleProof,
              receiver: pubkeyToField(feeCollectorOwner),
            });
            
            const feeProof = await proveCircuit('withdraw', feeWitness);
            
            try {
              const feeRes = await relayWithdraw({
                proof: feeProof,
                amount: PRIVACY_FEE_ATOMS.toString(),
                nullifier: feeNote.nullifier,
                recipientAta: feeCollectorAta.toBase58(),
                mint: nocMint.toBase58(),
                collectFee: false, // This IS the fee payment
              });
              console.log('[Transfer] ✅ Fee collected from vault:', feeRes.signature);
              markNoteSpent(feeNote.nullifier);
            } catch (feeErr) {
              console.error('[Transfer] ❌ Fee collection failed:', feeErr);
              throw new Error('Failed to collect privacy fee from vault. Please retry.');
            }
            
            // Step 2: Now withdraw SOL
            setStatus('Withdrawing SOL from vault...');
            console.log('[Transfer] SOL withdrawal: Step 2 - Withdrawing SOL from vault...');
            
            if (!pendingWithdrawalProof || !pendingWithdrawalNote) {
              throw new Error('Missing withdrawal proof or note for SOL withdrawal');
            }
            
            let signature: string;
            try {
              const wsolMint = new PublicKey(WSOL_MINT);
              const res = await relayWithdraw({
                proof: pendingWithdrawalProof,
                amount: transferReview.atoms.toString(),
                nullifier: pendingWithdrawalNote.nullifier.toString(),
                recipientAta: pendingRecipientAta!,
                mint: wsolMint.toBase58(),
                collectFee: false, // Fee already collected above
              });
              signature = res.signature;
            } catch (relayErr) {
              console.error('[Transfer] ❌ Relayer unavailable for SOL withdrawal:', relayErr);
              setStatus('Relayer unavailable. Shielded SOL withdrawal blocked to avoid exposing signer. Please retry.');
              throw relayErr;
            }
            console.log('Withdrawal succeeded (SOL vault):', signature);
            if (pendingWithdrawalNote) {
              markNoteSpent(pendingWithdrawalNote.nullifier);
            }
            setStatus(`Shielded withdrawal confirmed (${signature.slice(0, 8)}…)`);
            setTransferReview(null);
            resetPendingShieldedTransfer();
            await refreshBalances();
          }
        } else {
          // Private delivery for full spend: note created on-chain during deposit/transfer
          // Just mark as spent and provide shared note to recipient
          if (pendingWithdrawalNote) {
            markNoteSpent(pendingWithdrawalNote.nullifier);
          }
          setPendingSharedNote(transferReview.sharedNote!);
          
          // Clean up
          delete (window as unknown as Record<string, unknown>).__pendingTransfer;
          
          setStatus('Private transfer complete! Recipient note ready (copy and share below)');
          // Keep transferReview open to show shared note
          await refreshBalances();
        }
      }
    } catch (err) {
      console.error('Transfer failed:', err);
      const errMsg = (err as Error).message || String(err);
      
      // Handle NullifierUsed error - note was already spent on-chain
      if (errMsg.includes('NullifierUsed') || errMsg.includes('6003')) {
        console.log('Note already spent on-chain, marking as spent locally');
        if (pendingWithdrawalNote) {
          markNoteSpent(pendingWithdrawalNote.nullifier);
        }
        setStatus('This note was already spent. Your balance has been updated.');
        setTransferReview(null);
        resetPendingShieldedTransfer();
        await refreshBalances();
      } else {
        setStatus(errMsg);
      }
    } finally {
      setConfirmingTransfer(false);
    }
  }, [
    keypair,
    transferReview,
    pendingWithdrawalProof,
    pendingWithdrawalNote,
    pendingRecipientAta,
    shieldedNotes,
    markNoteSpent,
    addShieldedNote,
    resetPendingShieldedTransfer,
    refreshBalances,
  ]);

  const cancelShieldedTransfer = useCallback(() => {
    setTransferReview(null);
    setPendingSharedNote(null);
    resetPendingShieldedTransfer();
  }, [resetPendingShieldedTransfer]);

  // Import a shared note from recipient
  const handleImportNote = useCallback(async () => {
    if (!keypair || !importNoteInput.trim()) return;
    
    try {
      setStatus('Importing shared note...');
      const noteRecord = decodeSharedNote(importNoteInput.trim());
      
      // Set owner to current wallet
      noteRecord.owner = keypair.publicKey.toBase58();
      
      // Add to shielded notes
      addShieldedNote(noteRecord);
      
      setStatus('Note imported successfully! Your shielded balance will update.');
      setImportNoteInput('');
      setShowImportNote(false);
      await refreshBalances();
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      setStatus(`Import failed: ${errMsg}`);
    }
  }, [keypair, importNoteInput, addShieldedNote, refreshBalances]);

  // SOL and NOC both supported for all shielded operations

  useEffect(() => {
    if (actionType === 'shieldWithdraw' && keypair) {
      setRecipient(keypair.publicKey.toBase58());
    }
  }, [actionType, keypair]);

  const performShieldedDeposit = useCallback(
    async (amountAtoms: bigint, tokenType: 'NOC' | 'SOL' = 'NOC'): Promise<string> => {
      try {
        if (!keypair) throw new Error('Wallet not ready.');
        
        const displayAmount = Number(amountAtoms) / (tokenType === 'SOL' ? 1_000_000_000 : 1_000_000);
        console.log('[performShieldedDeposit] DEPOSIT START:', { 
          tokenType, 
          amountAtoms: amountAtoms.toString(),
          displayAmount,
          keypair: keypair.publicKey.toBase58(),
        });
        
        // For SOL: use null mint (native SOL), for NOC: use NOC_TOKEN_MINT
        const mintKey = tokenType === 'SOL' ? null : new PublicKey(NOC_TOKEN_MINT);
        
        setStatus('Generating deposit proof…');
        console.log('[performShieldedDeposit] Preparing deposit for mint:', {
          mint: mintKey?.toBase58() || 'NATIVE_SOL',
          tokenType,
          amountAtoms: amountAtoms.toString(),
        });
        const prepared = prepareDeposit(amountAtoms, mintKey || new PublicKey(NOC_TOKEN_MINT)); // Use NOC_TOKEN_MINT for PDA derivation
        console.log('[performShieldedDeposit] Deposit prepared:', {
          noteAmount: prepared.note.amount.toString(),
          noteCommitment: prepared.note.commitment.toString(),
        });
        
        const proof = await proveCircuit('deposit', prepared.witness);
        console.log('[performShieldedDeposit] Proof generated successfully, proof size:', proof.proofBytes.length);
        
        logProofPayload('deposit', {
          noteCommitment: prepared.note.commitment.toString(),
          noteNullifier: prepared.note.nullifier.toString(),
          preparedPublicInputs: prepared.publicInputs.map((field) => field.toString()),
          proofPublicInputs: proof.publicInputs,
          proofBytesPreview: `${proof.proofBytes.slice(0, 48)}…`,
          tokenType,
          mint: mintKey?.toBase58() || 'NATIVE_SOL',
        });
        
        setStatus('Submitting shielded deposit…');
        console.log('[performShieldedDeposit] Calling submitShieldedDeposit...');
        const { signature, leafIndex } = await submitShieldedDeposit({
          keypair,
          prepared,
          proof,
          mint: mintKey || undefined, // Pass undefined for SOL
          tokenType,
        });
        console.log('[performShieldedDeposit] Deposit submitted successfully:', {
          signature,
          leafIndex,
          tokenType,
          noteAmount: prepared.note.amount.toString(),
          displayAmount,
        });
        
        const noteToAdd = snapshotNote(prepared.note, keypair.publicKey, mintKey, {
          leafIndex,
          signature,
          tokenType,
        });
        console.log('[performShieldedDeposit] ADDING NOTE TO STORE:', {
          nullifier: noteToAdd.nullifier.slice(0, 8),
          amount: noteToAdd.amount,
          displayAmount,
          tokenType,
          owner: noteToAdd.owner.slice(0, 8),
        });
        
        try {
          addShieldedNote(noteToAdd);
          console.log('[performShieldedDeposit] ✅ Note added to local storage');
          
          // Verify it was added
          setTimeout(() => {
            const state = useShieldedNotes.getState();
            const noteExists = state.notes.some(n => n.nullifier === noteToAdd.nullifier);
            if (noteExists) {
              console.log('[performShieldedDeposit] ✅ VERIFIED: Note is in state after add');
            } else {
              console.error('[performShieldedDeposit] ❌ CRITICAL: Note was not added to state!', {
                nullifier: noteToAdd.nullifier.slice(0, 16),
                stateNotesCount: state.notes.length,
              });
            }
          }, 50);
        } catch (addErr) {
          console.error('[performShieldedDeposit] ❌ FAILED TO ADD NOTE:', addErr);
          throw new Error(`Failed to add note to storage: ${(addErr as Error).message}`);
        }
        
        setProofPreview(
          JSON.stringify(
            {
              commitment: prepared.note.commitment.toString(),
              nullifier: prepared.note.nullifier.toString(),
              tokenType,
              signature,
            },
            null,
            2,
          ),
        );
        console.log('[performShieldedDeposit] Returning deposit signature:', signature);
        return signature;
      } catch (err) {
        console.error('[performShieldedDeposit] Fatal error:', err);
        if (err instanceof Error) {
          console.error('[performShieldedDeposit] Error message:', err.message);
          console.error('[performShieldedDeposit] Error stack:', err.stack);
        }
        throw err;
      }
    },
    [keypair, addShieldedNote],
  );

  // Prepare transaction confirmation modal - validates inputs and shows modal
  const handleAction = useCallback(async () => {
    console.log('=== handleAction called ===', { actionType, recipient, actionAmount, selectedToken });
    if (!keypair) return;
    
    try {
      const parsedAmount = Number(actionAmount);
      
      if (actionType === 'transparentSend') {
        console.log('Processing transparentSend...');
        const trimmedRecipient = recipient.trim();
        if (!trimmedRecipient) {
          throw new Error('Enter a recipient address.');
        }
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error('Enter a positive amount.');
        }
        // Validate address
        new PublicKey(trimmedRecipient);
        
        const displayAmount = selectedToken === 'SOL' ? `${parsedAmount} SOL` : `${actionAmount} $NOC`;
        const tokenSymbol = selectedToken === 'SOL' ? 'SOL' : '$NOC';
        
        console.log('Setting txConfirmation for transparent send...');
        setTxConfirmation({
          type: 'transparentSend',
          token: selectedToken,
          amount: actionAmount,
          displayAmount,
          recipient: trimmedRecipient,
          fromLabel: `${keypair.publicKey.toBase58().slice(0, 8)}…${keypair.publicKey.toBase58().slice(-4)} (your wallet)`,
          toLabel: trimmedRecipient,
          solFee: networkFeeEstimate,
          description: `This is a public transfer. Your wallet address will be visible on the blockchain.`,
        });
        console.log('txConfirmation set, modal should appear');
        return;
      }
      
      if (actionType === 'shieldDeposit') {
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error('Enter a positive amount to shield.');
        }
        
        const displayAmount = selectedToken === 'SOL' ? `${parsedAmount} SOL` : `${actionAmount} $NOC`;
        
        setTxConfirmation({
          type: 'shieldDeposit',
          token: selectedToken,
          amount: actionAmount,
          displayAmount,
          fromLabel: `${keypair.publicKey.toBase58().slice(0, 8)}…${keypair.publicKey.toBase58().slice(-4)} (your wallet)`,
          toLabel: 'Shielded vault (private)',
          solFee: networkFeeEstimate,
          privacyFee: SHIELDED_PRIVACY_FEE_NOC,
          description: `Your ${selectedToken} will be moved into the private shielded vault. Once shielded, transfers are fully private.`,
        });
        return;
      }
      
      if (actionType === 'shieldWithdraw' || actionType === 'shieldedSend') {
        // These go through startShieldedTransfer which has its own modal
        if (actionType === 'shieldedSend') {
          const trimmedRecipient = recipient.trim();
          if (!trimmedRecipient) {
            throw new Error('Enter a recipient address.');
          }
        }
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error('Enter a positive amount.');
        }
        
        // Start the shielded transfer flow (has its own confirmation modal)
        setStatus('Starting shielded transfer...');
        const targetRecipient = actionType === 'shieldWithdraw' 
          ? keypair.publicKey.toBase58() 
          : recipient;
        await startShieldedTransfer(targetRecipient, actionAmount, selectedToken);
        return;
      }
    } catch (err) {
      setStatus((err as Error).message);
    }
  }, [
    keypair,
    actionType,
    recipient,
    actionAmount,
    selectedToken,
    networkFeeEstimate,
    startShieldedTransfer,
  ]);

  // Execute the confirmed transaction
  const executeConfirmedTransaction = useCallback(async () => {
    if (!keypair || !txConfirmation) return;
    
    console.log('=== executeConfirmedTransaction called ===', txConfirmation);
    setTxConfirmPending(true);
    
    try {
      if (txConfirmation.type === 'transparentSend') {
        const target = new PublicKey(txConfirmation.recipient!);
        if (txConfirmation.token === 'SOL') {
          setStatus('Sending SOL…');
          console.log('Calling sendSol...');
          const signature = await sendSol(keypair, target, Number(txConfirmation.amount));
          console.log('sendSol returned:', signature);
          const explorerUrl = buildExplorerUrl(signature);
          setStatus(`Sent ${txConfirmation.displayAmount} to ${target.toBase58()}. Sig ${signature.slice(0, 8)}… | ${explorerUrl}`);
          // Show success popup
          console.log('[Transaction] Setting txSuccess for transparent SOL:', { signature, amount: txConfirmation.displayAmount });
          setTxSuccess({
            signature,
            amount: txConfirmation.displayAmount,
            recipient: target.toBase58(),
            token: 'SOL',
          });
        } else {
          const atoms = parseNocAmount(txConfirmation.amount);
          setStatus('Sending $NOC…');
          console.log('Calling sendNoc with atoms:', atoms.toString());
          const signature = await sendNoc(keypair, target, atoms);
          console.log('sendNoc returned:', signature);
          const explorerUrl = buildExplorerUrl(signature);
          setStatus(`Sent ${txConfirmation.displayAmount} to ${target.toBase58()}. Sig ${signature.slice(0, 8)}… | ${explorerUrl}`);
          // Show success popup
          console.log('[Transaction] Setting txSuccess for transparent NOC:', { signature, amount: txConfirmation.displayAmount });
          setTxSuccess({
            signature,
            amount: txConfirmation.displayAmount,
            recipient: target.toBase58(),
            token: 'NOC',
          });
        }
        await refreshBalances();
      }
      
      if (txConfirmation.type === 'shieldDeposit') {
        if (txConfirmation.token === 'SOL') {
          const lamports = BigInt(Math.floor(Number(txConfirmation.amount) * LAMPORTS_PER_SOL));
          setStatus('Preparing SOL shield deposit…');
          console.log('[executeConfirmedTransaction] Starting shield SOL deposit:', { 
            lamports: lamports.toString(), 
            amount: txConfirmation.amount,
            displayAmount: txConfirmation.displayAmount,
          });
          try {
            console.log('[executeConfirmedTransaction] About to call performShieldedDeposit for SOL');
            const signature = await performShieldedDeposit(lamports, 'SOL');
            console.log('[executeConfirmedTransaction] ✅ Shield SOL deposit succeeded:', signature);
            
            // Wait for notes to be added
            await new Promise(resolve => setTimeout(resolve, 100));
            const notes = useShieldedNotes.getState().notes;
            console.log('[executeConfirmedTransaction] Notes in state after deposit:', notes.length);
            
            setStatus(`Shielded SOL deposit confirmed (${signature.slice(0, 8)}…)`);
            console.log('[executeConfirmedTransaction] Setting txSuccess for shielded SOL:', { 
              signature, 
              amount: txConfirmation.displayAmount 
            });
            setTxSuccess({
              signature,
              amount: txConfirmation.displayAmount,
              recipient: keypair.publicKey.toBase58(),
              token: 'SOL',
            });
          } catch (err) {
            console.error('[executeConfirmedTransaction] ❌ Shield SOL deposit failed:', err);
            setStatus(`Shield deposit failed: ${(err as Error).message}`);
            throw err;
          }
        } else {
          const atoms = parseNocAmount(txConfirmation.amount);
          setStatus('Submitting shielded NOC deposit…');
          console.log('[executeConfirmedTransaction] Starting shield NOC deposit:', { 
            atoms: atoms.toString(), 
            amount: txConfirmation.amount,
            displayAmount: txConfirmation.displayAmount,
          });
          try {
            console.log('[executeConfirmedTransaction] About to call performShieldedDeposit for NOC');
            const signature = await performShieldedDeposit(atoms, 'NOC');
            console.log('[executeConfirmedTransaction] ✅ Shield NOC deposit succeeded:', signature);
            
            // Wait for notes to be added
            await new Promise(resolve => setTimeout(resolve, 100));
            const notes = useShieldedNotes.getState().notes;
            console.log('[executeConfirmedTransaction] Notes in state after deposit:', notes.length);
            
            setStatus(`Shielded NOC deposit confirmed (${signature.slice(0, 8)}…)`);
            console.log('[executeConfirmedTransaction] Setting txSuccess for shielded NOC:', { 
              signature, 
              amount: txConfirmation.displayAmount 
            });
            setTxSuccess({
              signature,
              amount: txConfirmation.displayAmount,
              recipient: keypair.publicKey.toBase58(),
              token: 'NOC',
            });
          } catch (err) {
            console.error('[executeConfirmedTransaction] ❌ Shield NOC deposit failed:', err);
            setStatus(`Shield deposit failed: ${(err as Error).message}`);
            throw err;
          }
        }
        await refreshBalances();
      }
      
      // Always close the confirmation modal after successful transaction
      setTxConfirmation(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[Execute] Transaction error:', errorMessage, err);
      setStatus(`Error: ${errorMessage}`);
      // Close modal on error too
      setTxConfirmation(null);
    } finally {
      setTxConfirmPending(false);
    }
  }, [keypair, txConfirmation, refreshBalances, performShieldedDeposit]);

  const requestShieldedAirdrop = useCallback(async () => {
    if (!keypair) return;
    setAirdropPending(true);
    setAirdropError(null);
    try {
      await requestNocAirdrop(keypair.publicKey.toBase58());
      markAirdrop();
      setStatus(`Shielded faucet granted: ${INITIAL_AIRDROP_AMOUNT.toLocaleString()} $NOC.`);
      await refreshBalances();
    } catch (err) {
      const rawMessage = (err as Error).message || 'Shielded airdrop failed.';
      const formatted = rawMessage.includes('NetworkError')
        ? `Shielded faucet unavailable. Start the prover service at ${ProverServiceUrl} and try again.`
        : rawMessage;
      setAirdropError(formatted);
      setStatus(formatted);
    } finally {
      setAirdropPending(false);
    }
  }, [keypair, refreshBalances, markAirdrop]);

  const handleFaucet = useCallback(() => {
    const faucetUrl = new URL('https://faucet.solana.com/');
    faucetUrl.searchParams.set('cluster', 'devnet');
    if (keypair) {
      faucetUrl.searchParams.set('recipient', keypair.publicKey.toBase58());
    }
    if (typeof window !== 'undefined') {
      window.open(faucetUrl.toString(), '_blank', 'noopener,noreferrer');
    }
    setStatus('Opening Solana faucet in a new tab. Complete the request there.');
    if (keypair) {
      setTimeout(() => {
        refreshBalances().catch((err) => console.warn('Faucet refresh failed', err));
      }, 8_000);
    }
  }, [keypair, setStatus, refreshBalances]);

  const handleMnemonicImport = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      importMnemonic(trimmed);
      setOnboardingError(null);
      setMnemonicInput('');
      setSecretInput('');
    } catch (err) {
      setOnboardingError((err as Error).message);
    }
  };

  const handleSecretImport = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      importSecret(trimmed);
      setOnboardingError(null);
      setMnemonicInput('');
      setSecretInput('');
    } catch (err) {
      setOnboardingError((err as Error).message);
    }
  };

  const handleCreateWallet = () => {
    try {
      const mnemonic = createWallet();
      setMnemonicBackup(mnemonic);
      setShowImportPanel(false);
      setOnboardingError(null);
    } catch (err) {
      setOnboardingError((err as Error).message);
    }
  };

  const handleCopyMnemonic = useCallback(async () => {
    if (!mnemonicBackup || typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(mnemonicBackup);
    setCopiedMnemonic(true);
    setTimeout(() => setCopiedMnemonic(false), 2000);
  }, [mnemonicBackup]);

  const handleManualAirdrop = () => {
    console.log('[Airdrop] Manual trigger clicked');
    requestShieldedAirdrop().catch(() => undefined);
  };

  const fetchTransactions = useCallback(async () => {
    if (!keypair) return [];
    try {
      const { connection } = await import('./lib/solana');
      const signatures = await connection.getSignaturesForAddress(
        keypair.publicKey,
        { limit: 10 },
        'confirmed'
      );
      return signatures.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
        timestamp: sig.blockTime ?? 0,
        err: sig.err,
        memo: sig.memo ?? undefined,
      }));
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      return [];
    }
  }, [keypair]);

  const handleShieldDeposit = useCallback(async (token: 'SOL' | 'NOC', amount: string) => {
    if (!keypair) return;
    try {
      const displayAmount = token === 'SOL' ? `${amount} SOL` : `${amount} $NOC`;
      console.log('Setting shield deposit confirmation:', { type: 'shieldDeposit', displayAmount });
      setTxConfirmation({
        type: 'shieldDeposit',
        token: token,
        amount: amount,
        displayAmount: displayAmount,
        recipient: keypair.publicKey.toBase58(),
        fromLabel: 'Transparent Balance',
        toLabel: 'Shielded Vault',
        solFee: DEFAULT_SOL_FEE,
        privacyFee: SHIELDED_PRIVACY_FEE_NOC,
        description: `You are depositing ${displayAmount} into the shielded vault. Your funds will be encrypted and hidden from the blockchain.`,
      });
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }, [keypair]);

  // Automatically request the one-time NOC airdrop on first run (per wallet)
  useEffect(() => {
    if (!hasWallet || !keypair) return;
    if (!needsAirdrop) return;
    if (autoAirdropRequested) return;
    setAutoAirdropRequested(true);
    requestShieldedAirdrop().catch(() => {
      // Non-blocking; user can tap manual button if needed
      setAutoAirdropRequested(false);
    });
  }, [hasWallet, keypair, needsAirdrop, requestShieldedAirdrop, autoAirdropRequested]);

  const amountPlaceholder = useMemo(() => {
    if (actionType === 'transparentSend') {
      return `Amount (${selectedToken})`;
    }
    if (actionType === 'shieldWithdraw') {
      return 'Amount to unshield ($NOC)';
    }
    return 'Amount in $NOC';
  }, [actionType, selectedToken]);

  const recipientPlaceholder = useMemo(() => {
    if (actionType === 'shieldedSend') {
      return 'Recipient shielded address';
    }
    if (actionType === 'shieldWithdraw') {
      return 'Transparent address (auto-filled)';
    }
    return 'Recipient SOL or $NOC address';
  }, [actionType]);

  const actionPrimaryLabel = useMemo(() => {
    switch (actionType) {
      case 'transparentSend':
        return selectedToken === 'SOL' ? 'Send SOL' : 'Send $NOC';
      case 'shieldedSend':
        return shieldedSendPending ? 'Preparing proof…' : 'Send Shielded $NOC';
      case 'shieldDeposit':
        return selectedToken === 'SOL' ? 'Shield SOL' : 'Shield $NOC';
      case 'shieldWithdraw':
        return 'Unshield to Transparent';
      default:
        return 'Submit';
    }
  }, [actionType, selectedToken, shieldedSendPending]);

  // 0.25 NOC fee applies to ALL shielded transactions (deposits, withdrawals, sends)
  const shieldedFeeApplies = actionType === 'shieldDeposit' || actionType === 'shieldedSend' || actionType === 'shieldWithdraw';
  const actionPending = actionType === 'shieldedSend' && shieldedSendPending;

  const mnemonicModal = useMemo(() => {
    if (!mnemonicBackup) return null;
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center px-4 z-50">
        <div className="bg-surface rounded-2xl max-w-lg w-full p-6 space-y-4">
          <h2 className="text-2xl font-semibold">Save your 12-word recovery phrase</h2>
          <p className="text-sm text-neutral-400">
            Write these words down in order and store them offline. Anyone with this phrase can control your funds.
          </p>
          <div className="grid grid-cols-3 gap-3 font-mono text-sm">
            {mnemonicBackup.split(' ').map((word, idx) => (
              <div key={`${word}-${idx}`} className="bg-black/30 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-neutral-500 text-xs">{idx + 1}.</span>
                <span>{word}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 justify-end">
            <button className="px-4 py-2 border border-white/20 rounded-xl text-sm" onClick={handleCopyMnemonic}>
              {copiedMnemonic ? 'Copied!' : 'Copy phrase'}
            </button>
            <button className="px-4 py-2 bg-neon text-black rounded-xl" onClick={() => setMnemonicBackup(null)}>
              I wrote it down
            </button>
          </div>
        </div>
      </div>
    );
  }, [mnemonicBackup, copiedMnemonic, handleCopyMnemonic]);

  const shieldedConfirmModal = useMemo(() => {
    if (!transferReview) return null;
    const estimatedSolFee = 0.000005;
    const tokenSymbol = transferReview.tokenType === 'SOL' ? 'SOL' : '$NOC';
    const nocFee = SHIELDED_PRIVACY_FEE_NOC;
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">Confirm shielded transfer</p>
            <h2 className="text-2xl font-semibold mt-2">Send {transferReview.amount} {tokenSymbol}</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">From</span>
              <span className="font-mono text-xs text-right">Shielded vault (private)</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">To</span>
              <span className="font-mono text-xs text-right break-all">{transferReview.recipientZkHash || transferReview.recipient}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2 items-center">
              <span className="text-neutral-400">Amount</span>
              <AmountDisplay
                amount={transferReview.atoms}
                token={tokenSymbol}
                mode="pre_sign"
                context="shielded"
              />
            </div>
            {transferReview.isPartialSpend && transferReview.changeAmount !== undefined && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-neutral-400">Change (stays shielded)</span>
                <span>{transferReview.changeAmount.toFixed(4)} {tokenSymbol}</span>
              </div>
            )}
            <div className="pt-2">
              <FeeBreakdown nocFee={nocFee} solFee={estimatedSolFee} />
            </div>
          </div>
          <p className="text-xs text-neutral-400">
            {transferReview.transparentPayout 
              ? `This transfer uses transparent payout. Recipient will receive ${tokenSymbol} directly to their wallet (visible on-chain).`
              : 'This transfer is fully private. Recipient will receive a shielded note (sender/receiver/amount all hidden on-chain).'}
          </p>
          {pendingSharedNote && !transferReview.transparentPayout && (
            <div className="bg-black/40 p-4 rounded-lg space-y-2">
              <p className="text-xs text-neon font-semibold uppercase tracking-widest">Shared Note (copy & send to recipient)</p>
              <textarea
                value={pendingSharedNote}
                readOnly
                className="w-full h-24 bg-black/60 text-xs font-mono p-2 rounded border border-white/10 resize-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(pendingSharedNote);
                  setStatus('Note copied to clipboard!');
                }}
                className="w-full px-4 py-2 border border-neon text-neon rounded-xl text-sm hover:bg-neon/10"
              >
                Copy Note
              </button>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button className="px-4 py-2 border border-white/20 rounded-xl" onClick={cancelShieldedTransfer} disabled={confirmingTransfer}>
              {pendingSharedNote ? 'Close' : 'Cancel'}
            </button>
            {!pendingSharedNote && (
              <button
                className="px-4 py-2 bg-gradient-neon text-black rounded-xl disabled:opacity-60 font-semibold"
                onClick={confirmShieldedTransfer}
                disabled={confirmingTransfer}
              >
                {confirmingTransfer ? 'Sending…' : 'Confirm transfer'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }, [transferReview, confirmingTransfer, cancelShieldedTransfer, confirmShieldedTransfer, pendingSharedNote]);

  // Staged send confirmation modal
  const stagedSendModal = useMemo(() => {
    if (!stagedSendPlan) return null;
    
    const confirmStagedSend = async () => {
      try {
        setStagedSendPlan(null);
        await executeStagedSolSend(stagedSendPlan.recipient, stagedSendPlan.amount);
      } catch (err) {
        console.error('[StagedSend] Execution failed:', err);
        setStatus(`Staged send failed: ${(err as Error).message}`);
      }
    };
    
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">Multi-note staged send</p>
            <h2 className="text-2xl font-semibold mt-2">Send {(Number(stagedSendPlan.amount) / 1_000_000_000).toFixed(4)} SOL</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">From</span>
              <span className="font-mono text-xs text-right">Shielded vault (multiple notes)</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">To</span>
              <span className="font-mono text-xs text-right break-all">{stagedSendPlan.recipient.toBase58()}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">Total notes</span>
              <span>{stagedSendPlan.steps}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">Full withdrawals</span>
              <span>{stagedSendPlan.fullCount}</span>
            </div>
            {stagedSendPlan.hasPartial && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-neutral-400">Partial withdrawal</span>
                <span>1 (split + withdraw)</span>
              </div>
            )}
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">Privacy fees</span>
              <span className="text-neon">~{stagedSendPlan.feeEstimate.toFixed(2)} NOC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Network fees</span>
              <span>~{(stagedSendPlan.steps * 0.000005).toFixed(6)} SOL</span>
            </div>
          </div>
          <div className="bg-black/40 p-3 rounded-lg">
            <p className="text-xs text-neutral-400">
              This send will execute {stagedSendPlan.steps} step{stagedSendPlan.steps > 1 ? 's' : ''} automatically. 
              Each step will prove and withdraw from your shielded notes. 
              {stagedSendPlan.hasPartial && ' The final note will be split to send the exact amount.'}
            </p>
          </div>
          <div className="flex gap-3 justify-end">
            <button 
              className="px-4 py-2 border border-white/20 rounded-xl" 
              onClick={() => setStagedSendPlan(null)}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-gradient-neon text-black rounded-xl font-semibold"
              onClick={confirmStagedSend}
            >
              Confirm {stagedSendPlan.steps}-step send
            </button>
          </div>
        </div>
      </div>
    );
  }, [stagedSendPlan, executeStagedSolSend]);

  // Unified transaction confirmation modal for transparent sends and shield deposits
  const transactionConfirmModal = useMemo(() => {
    if (!txConfirmation) return null;
    
    const getTitle = () => {
      switch (txConfirmation.type) {
        case 'transparentSend':
          return 'Confirm public transfer';
        case 'shieldDeposit':
          return 'Confirm shield deposit';
        default:
          return 'Confirm transaction';
      }
    };
    
    const tokenSymbol = txConfirmation.token === 'SOL' ? 'SOL' : '$NOC';
    
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">{getTitle()}</p>
            <h2 className="text-2xl font-semibold mt-2">Send {txConfirmation.displayAmount}</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">From</span>
              <span className="font-mono text-xs text-right max-w-[200px] truncate">{txConfirmation.fromLabel}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">To</span>
              <span className="font-mono text-xs text-right max-w-[200px] truncate">{txConfirmation.toLabel}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">Amount</span>
              <span>{txConfirmation.displayAmount}</span>
            </div>
            {txConfirmation.changeAmount !== undefined && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-neutral-400">Change (stays shielded)</span>
                <span>{txConfirmation.changeAmount.toFixed(4)} {tokenSymbol}</span>
              </div>
            )}
            {txConfirmation.privacyFee !== undefined && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-neutral-400">Privacy fee</span>
                <span>{txConfirmation.privacyFee.toFixed(2)} $NOC</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-neutral-400">Solana network fee</span>
              <span>{txConfirmation.solFee.toFixed(6)} SOL</span>
            </div>
          </div>
          <p className="text-xs text-neutral-400">
            {txConfirmation.description}
          </p>
          <div className="flex gap-3 justify-end">
            <button 
              className="px-4 py-2 border border-white/20 rounded-xl" 
              onClick={() => setTxConfirmation(null)} 
              disabled={txConfirmPending}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-neon text-black rounded-xl disabled:opacity-60"
              onClick={executeConfirmedTransaction}
              disabled={txConfirmPending}
            >
              {txConfirmPending ? 'Sending…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    );
  }, [txConfirmation, txConfirmPending, executeConfirmedTransaction]);

  const transactionSuccessModal = useMemo(() => {
    if (!txSuccess) return null;

    console.log('[UI] Rendering success modal with txSuccess:', txSuccess);
    const explorerUrl = buildExplorerUrl(txSuccess.signature);

    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50 animate-in fade-in duration-300">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4">
          <div className="flex flex-col items-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-neon/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-neon" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">Transaction successful</p>
            <h2 className="text-2xl font-semibold">Sent {txSuccess.amount}</h2>
          </div>

          <div className="space-y-3 text-sm">
            <div className="bg-black/30 rounded-xl p-3">
              <span className="text-neutral-400">To</span>
              <p className="font-mono text-xs text-neon mt-1 break-all">{txSuccess.recipient}</p>
            </div>

            <div className="bg-black/30 rounded-xl p-3">
              <span className="text-neutral-400">Transaction ID</span>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-cyan-400 hover:text-cyan-300 mt-1 break-all flex items-center gap-2"
              >
                {txSuccess.signature.slice(0, 16)}…
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11 3a1 1 0 100 2h3.586L9.293 9.293a1 1 0 001.414 1.414L16 6.414V10a1 1 0 100 2h-7a1 1 0 01-1-1V3z" />
                </svg>
              </a>
            </div>
          </div>

          <button
            className="w-full px-4 py-3 bg-neon text-black rounded-xl font-semibold hover:bg-neon/90 transition-colors"
            onClick={() => {
              console.log('[UI] Closing success modal');
              setTxSuccess(null);
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }, [txSuccess]);

  const shieldedErrorModal = useMemo(() => {
    if (!shieldedSendError) return null;
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm uppercase tracking-[0.3em] text-red-400 font-semibold">Transfer Failed</p>
              <p className="text-sm text-neutral-200 mt-2">{shieldedSendError}</p>
            </div>
          </div>
          <button
            className="w-full px-4 py-2 bg-red-500/20 border border-red-500/40 text-red-300 rounded-xl hover:bg-red-500/30 transition-colors"
            onClick={() => setShieldedSendError(null)}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }, [shieldedSendError]);

  const renderOnboarding = () => (
    <main className="min-h-screen bg-background text-accent flex items-center justify-center px-6 py-12 relative">
      {!hasWallet && showIntroModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="max-w-lg w-full rounded-2xl bg-surface/90 border border-white/10 p-6 space-y-4 shadow-2xl">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] gradient-text font-semibold">Read First</p>
              <h3 className="text-2xl font-semibold text-white">How This Wallet Works</h3>
            </div>
            <div className="space-y-3 text-sm text-neutral-200 leading-relaxed">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="font-semibold gradient-text">Network & Tokens</p>
                <ul className="list-disc list-inside text-neutral-300 mt-2 space-y-1">
                  <li>Runs entirely on <span className="gradient-text">Solana devnet</span>.</li>
                  <li>Only <span className="gradient-text">SOL</span> and <span className="gradient-text">NOC</span> are available.</li>
                  <li>Get test SOL at <a className="underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.</li>
                  <li>Get test NOC: the app sends a one-time airdrop to your new wallet.</li>
                </ul>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="font-semibold gradient-text">Dual Modes</p>
                <ul className="list-disc list-inside text-neutral-300 mt-2 space-y-1">
                  <li><span className="gradient-text">Transparent</span>: standard Solana transfers (visible on explorer).</li>
                  <li><span className="gradient-text">Shielded</span>: private transfers; sender/receiver/amount hidden.</li>
                </ul>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="font-semibold gradient-text">What to Expect</p>
                <ul className="list-disc list-inside text-neutral-300 mt-2 space-y-1">
                  <li>All activity stays on devnet; use for testing only.</li>
                  <li>Keep your 12-word seed safe; it controls both modes.</li>
                  <li>Fees are devnet-scale; shielded transfers include the flat NOC privacy fee.</li>
                </ul>
              </div>
            </div>
            <button
              className="w-full py-3 px-4 rounded-xl bg-gradient-neon text-black font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all"
              onClick={handleIntroAcknowledge}
            >
              Got It, Let Me In
            </button>
          </div>
        </div>
      )}
      
      {showImportNote && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="max-w-lg w-full rounded-2xl bg-surface/90 border border-white/10 p-6 space-y-4 shadow-2xl">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] gradient-text font-semibold">Import Note</p>
              <h3 className="text-2xl font-semibold text-white">Claim Shielded Funds</h3>
            </div>
            <div className="space-y-3 text-sm text-neutral-200">
              <p>Paste the shared note you received to add it to your shielded balance.</p>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-neutral-400">Shared Note</label>
                <textarea
                  value={importNoteInput}
                  onChange={(e) => setImportNoteInput(e.target.value)}
                  placeholder="Paste the base64-encoded note here..."
                  className="mt-2 w-full h-32 bg-black/60 text-xs font-mono p-3 rounded-lg border border-white/10 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 px-4 rounded-xl border border-white/20 font-semibold hover:bg-white/5 transition-all"
                onClick={() => {
                  setShowImportNote(false);
                  setImportNoteInput('');
                }}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-neon text-black font-bold hover:opacity-90 transition-all"
                onClick={handleImportNote}
                disabled={!importNoteInput.trim()}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="max-w-2xl w-full space-y-8">
        {/* Header Section */}
        <div className="space-y-6 text-center">
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <p className="text-xl text-neutral-300 font-light">Welcome to</p>
              <img 
                src="/noctura-logo.png" 
                alt="NOCtura" 
                className="h-28 w-auto"
              />
            </div>
            <p className="text-xl text-neutral-300 font-light">
              Solana's First Dual-Mode Privacy Wallet
            </p>
          </div>
        </div>

        {/* Explanation Section */}
        <div className="cyber-border rounded-2xl bg-surface/50 p-8 space-y-6 text-left">
          <div>
            <h2 className="uppercase text-sm tracking-[0.3em] gradient-text font-semibold mb-4">How NOCtura Works</h2>
            <div className="space-y-4 text-neutral-300 text-sm leading-relaxed">
              <div className="flex gap-4">
                <div className="gradient-text font-bold text-lg min-w-[2rem]">1</div>
                <div>
                  <p className="font-semibold text-white mb-1">Create Your Secure Wallet</p>
                  <p className="text-neutral-400">
                    Generate a unique 12-word recovery seed phrase. This is your access key to your wallet.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="gradient-text font-bold text-lg min-w-[2rem]">2</div>
                <div>
                  <p className="font-semibold text-white mb-1">Dual-Mode Accounts</p>
                  <p className="text-neutral-400">
                    Access transparent mode for standard transfers and shielded mode for completely private transactions with hidden sender, receiver, and amounts.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="gradient-text font-bold text-lg min-w-[2rem]">3</div>
                <div>
                  <p className="font-semibold text-white mb-1">Zero-Knowledge Privacy</p>
                  <p className="text-neutral-400">
                    Use cutting-edge ZK-SNARK technology to prove ownership without revealing any transaction details. Your privacy is built into the blockchain.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Security Notice */}
          <div className="border-l-2 border-gradient-start pl-4 py-2">
            <p className="text-xs uppercase tracking-widest gradient-text font-semibold mb-1">Security First</p>
            <p className="text-xs text-neutral-400">
              Your seed phrase is stored locally in your browser. Never share it. Never import from untrusted sources.
            </p>
          </div>
        </div>

        {/* Action Section */}
        <div className="space-y-4">
          <button
            className="w-full py-4 px-6 rounded-xl bg-gradient-neon text-black font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all text-lg"
            onClick={handleCreateWallet}
          >
            Create New Wallet
          </button>
          <p className="text-center text-xs text-neutral-500 uppercase tracking-wider">
            🔒 Your wallet is created entirely on your device
          </p>

        </div>

        {onboardingError && (
          <div className="border border-red-500/40 text-red-300 text-sm rounded-2xl p-4 bg-red-500/5 text-left">
            {onboardingError}
          </div>
        )}
      </div>
    </main>
  );

  if (!hasWallet || forceShowOnboarding) {
    return (
      <>
        {renderOnboarding()}
        {mnemonicModal}
        {shieldedConfirmModal}
        {stagedSendModal}
        {transactionConfirmModal}
      </>
    );
  }

  return (
    <>
      <Dashboard
        mode={mode}
        solBalance={solBalance}
        nocBalance={nocBalance}
        shieldedSolBalance={shieldedSolBalance}
        shieldedNocBalance={shieldedNocBalance}
        walletAddress={keypair?.publicKey.toBase58() || ''}
        onModeChange={handleModeToggle}
        onReceive={() => {
          // Receive is automatically handled by dashboard modal
        }}
        onSend={() => {
          // Send modal opens in dashboard
        }}
        onShield={() => {
          // Shield deposit can be triggered from dashboard
        }}
        onRequestSolFaucet={() => {
          handleFaucet();
        }}
        onFetchTransactions={fetchTransactions}
        onShieldDeposit={handleShieldDeposit}
        onSendTransaction={async (token, amount, recipient) => {
          console.log('=== onSendTransaction called ===', { token, amount, recipient });
          if (!keypair) return;
          // In shielded mode, always route through the private transfer flow
          if (mode === 'shielded') {
            try {
              setStatus('Starting shielded transfer...');
              await startShieldedTransfer(recipient, amount, token);
              return;
            } catch (err) {
              const message = (err as Error).message;
              setStatus(message);
              setShieldedSendError(message);
              return;
            }
          }
          try {
            const target = new PublicKey(recipient);
            
            // Show confirmation modal for transparent send
            const displayAmount = token === 'SOL' ? `${amount} SOL` : `${amount} $NOC`;
            console.log('Setting txConfirmation:', { type: 'transparentSend', displayAmount });
            setTxConfirmation({
              type: 'transparentSend',
              token: token,
              amount: amount,
              displayAmount: displayAmount,
              recipient: recipient,
              fromLabel: keypair.publicKey.toBase58(),
              toLabel: recipient,
              solFee: DEFAULT_SOL_FEE,
              description: `You are sending ${displayAmount} to ${recipient.slice(0, 8)}… on Solana devnet. This is a public transaction visible on the blockchain.`,
            });
          } catch (err) {
            setStatus(`Invalid recipient address: ${(err as Error).message}`);
          }
        }}
      />

      {needsAirdrop && (
        <button
          className="fixed bottom-6 right-6 px-4 py-3 rounded-xl border border-white/20 bg-black/60 text-xs uppercase tracking-[0.2em] hover:border-[#00f0ff] hover:text-[#00f0ff] transition-colors disabled:opacity-50 z-50 cursor-pointer"
          onClick={handleManualAirdrop}
          disabled={airdropPending}
        >
          {airdropPending ? 'Requesting NOC…' : 'Request 10k NOC'}
        </button>
      )}
      
      {shieldedConfirmModal}
      {shieldedErrorModal}
      {stagedSendModal}
      {transactionConfirmModal}
      {transactionSuccessModal}
      {mnemonicModal}
    </>
  );
}
