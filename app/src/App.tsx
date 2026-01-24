/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { useWallet } from './hooks/useWallet';
import { useShieldedNotes } from './hooks/useShieldedNotes';
import { useTransactionHistory, getTransactionDisplayInfo, type TransactionRecord, type TransactionType } from './hooks/useTransactionHistory';
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
import { ProverResponse, proveCircuit, requestNocAirdrop, relayTransfer, relayWithdraw, sendEncryptedMemo } from './lib/prover';
import { submitShieldedWithdrawSol, relayConsolidate } from './lib/shieldProgram';
import { planStagedSend } from './lib/notePlanner';
import { parseNocAmount, prepareDeposit, snapshotNote, pubkeyToField, createNoteFromSecrets, filterCorruptedNotes, isNoteCorrupted, purgeCorruptedNotes, createNotePayloadForRecipient, reconstructNoteFromPayload, EXPECTED_NOC_TOKEN_MINT_FIELD } from './lib/shield';
import { deriveShieldedKeys, encodeShieldedAddress, decodeShieldedAddress, isValidShieldedAddress, type ShieldedKeyPair, getECDHPrivateKey } from './lib/shieldedKeys';
import { startScanner, stopScanner, triggerManualScan, type DecryptedIncomingNote } from './lib/walletScanner';
import { submitShieldedDeposit, fetchSpentNullifiers, PRIVACY_FEE_ATOMS } from './lib/shieldProgram';
import { buildMerkleProof } from './lib/merkle';
import { selectNotesForAmount } from './utils/noteSelection';
import { AmountDisplay } from './components/AmountDisplay';
import { FeeBreakdown } from './components/FeeBreakdown';
import { generateZKHashDisplay, generateSecureRandomness } from './utils/privacy';
import { serializeWithdrawWitness, serializeTransferWitness } from '@zk-witness/index';
import { encryptNoteToRecipient, serializeEncryptedNote, type NotePayload } from './lib/ecdhEncryption';
import { serializeTransferMultiWitness } from '@zk-witness/builders/transfer-multi';
import { serializeConsolidateWitness } from '@zk-witness/builders/consolidate';
import type { Note } from '@zk-witness/index';
import { ShieldedNoteRecord } from './types/shield';
import { INITIAL_AIRDROP_AMOUNT, NOC_TOKEN_MINT, WSOL_MINT, ProverServiceUrl, RELAYER_ENDPOINTS } from './lib/constants';
import { initializePrivateRelayer, getPrivateRelayer } from './lib/privateRelayer';
import { getObfuscatedFeeCollector } from './lib/feeObfuscation';
import { getTimingPrivacyManager } from './lib/timingPrivacy';
import { getAccountAnonymityManager } from './lib/accountAnonymity';
import { buildConsolidationWitness, partitionNotesForConsolidation } from './lib/consolidate';

const NOC_ATOMS = 1_000_000;
const SHIELDED_PRIVACY_FEE_NOC = 0.25; // Flat 0.25 NOC fee for ALL shielded transactions (deposits + withdrawals)
const DEFAULT_SOL_FEE = 0.000005;
const SOLANA_CLUSTER = import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet';

// Helper to get the correct tokenMint for a note (handles legacy corrupted values)
const getCorrectTokenMint = (note: { tokenType?: string; tokenMintField?: string }): bigint => {
  // For SOL notes, tokenMint is 1
  if (note.tokenType === 'SOL') return 1n;
  // For NOC notes, always use the correct expected value (handles corrupted "2" values)
  return BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
};

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
function encodeSharedNote(note: Note, tokenType: 'NOC' | 'SOL'): string {
  const noteData = {
    secret: note.secret.toString(),
    amount: note.amount.toString(),
    tokenMint: note.tokenMint.toString(),
    blinding: note.blinding.toString(),
    rho: note.rho.toString(),
    commitment: note.commitment.toString(),
    nullifier: note.nullifier.toString(),
    mintAddress: tokenType === 'SOL' ? 'NATIVE_SOL' : NOC_TOKEN_MINT,
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
  isFullyPrivate?: boolean; // True for noctura1 addresses (shielded-to-shielded)
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
  relayerPaysGas?: boolean; // True when relayer covers the SOL network fee
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

  // Transaction history hooks
  const allTransactions = useTransactionHistory((state) => state.transactions);
  const addTransaction = useTransactionHistory((state) => state.addTransaction);
  const getWalletTransactions = useTransactionHistory((state) => state.getTransactionsForWallet);

  // Log relayer endpoints once to debug banner state
  useEffect(() => {
    console.log('[RelayerDebug] RELAYER_ENDPOINTS:', RELAYER_ENDPOINTS);
  }, []);

  const isMockRelayer = useMemo(() => {
    // If no relayer endpoints configured, show warning
    if (!RELAYER_ENDPOINTS.length) return true;
    // localhost:8787 is a real prover service, not a mock - don't show warning
    return false;
  }, []);

  const mockRelayerBanner = useMemo(() => {
    if (!isMockRelayer) return null;
    const configured = RELAYER_ENDPOINTS.join(', ') || 'None';
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500/15 border border-amber-400/40 text-amber-100 px-4 py-3 rounded-xl shadow-lg backdrop-blur">
        <p className="text-sm font-semibold">Mock relayer active</p>
        <p className="text-xs text-amber-100/80">Transactions are simulated only; funds do not move on-chain. Set VITE_RELAYER_ENDPOINTS to a real relayer. Current: {configured}</p>
      </div>
    );
  }, [isMockRelayer]);

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
          // Note management utilities
          purgeCorruptedNotes() {
            const result = purgeCorruptedNotes();
            console.log('[debugApi.purgeCorruptedNotes]', result);
            return result;
          },
          getShieldedNotes() {
            const stored = localStorage.getItem('noctura.shieldedNotes');
            if (!stored) return { notes: [], count: 0 };
            try {
              const parsed = JSON.parse(stored);
              const notes = parsed.state?.notes || [];
              return { 
                notes, 
                count: notes.length,
                unspent: notes.filter((n: any) => !n.spent).length,
                sol: notes.filter((n: any) => n.tokenType === 'SOL' && !n.spent),
                noc: notes.filter((n: any) => n.tokenType === 'NOC' && !n.spent),
              };
            } catch (err) {
              return { error: (err as Error).message };
            }
          },
          getShieldedBalance() {
            const stored = localStorage.getItem('noctura.shieldedNotes');
            if (!stored) return { sol: 0, noc: 0 };
            try {
              const parsed = JSON.parse(stored);
              const notes = parsed.state?.notes || [];
              const unspentSol = notes.filter((n: any) => n.tokenType === 'SOL' && !n.spent);
              const unspentNoc = notes.filter((n: any) => n.tokenType === 'NOC' && !n.spent);
              const solAtoms = unspentSol.reduce((sum: bigint, n: any) => sum + BigInt(n.amount || 0), 0n);
              const nocAtoms = unspentNoc.reduce((sum: bigint, n: any) => sum + BigInt(n.amount || 0), 0n);
              return {
                sol: Number(solAtoms) / 1e9,
                noc: Number(nocAtoms) / 1e6,
                solAtoms: solAtoms.toString(),
                nocAtoms: nocAtoms.toString(),
                solNotes: unspentSol.length,
                nocNotes: unspentNoc.length,
              };
            } catch (err) {
              return { error: (err as Error).message };
            }
          },
          markNoteSpent(nullifierPrefix: string) {
            const stored = localStorage.getItem('noctura.shieldedNotes');
            if (!stored) return { error: 'No notes found' };
            try {
              const parsed = JSON.parse(stored);
              const notes = parsed.state?.notes || [];
              const matchingNote = notes.find((n: any) => n.nullifier.startsWith(nullifierPrefix));
              if (!matchingNote) return { error: `No note found with nullifier starting with ${nullifierPrefix}` };
              matchingNote.spent = true;
              localStorage.setItem('noctura.shieldedNotes', JSON.stringify(parsed));
              console.log('[debugApi.markNoteSpent] Marked as spent:', matchingNote.nullifier.slice(0, 16));
              return { success: true, nullifier: matchingNote.nullifier };
            } catch (err) {
              return { error: (err as Error).message };
            }
          },
          forceRefreshNotes() {
            // Trigger a localStorage re-read by dispatching storage event
            window.dispatchEvent(new StorageEvent('storage', { key: 'noctura.shieldedNotes' }));
            console.log('[debugApi.forceRefreshNotes] Dispatched storage event');
            return { success: true };
          },
          async scanForNotes() {
            if (!keypair) return { error: 'No keypair available' };
            console.log('[debugApi.scanForNotes] Triggering manual scan...');
            try {
              const result = await triggerManualScan(keypair);
              console.log('[debugApi.scanForNotes] Scan result:', result);
              return {
                success: true,
                newNotesFound: result.newNotesFound,
                notesForMe: result.notesForMe.length,
                scannedSignatures: result.scannedSignatures,
              };
            } catch (err) {
              console.error('[debugApi.scanForNotes] Error:', err);
              return { error: (err as Error).message };
            }
          },
          resetScanSlot() {
            // Reset the last scanned slot to re-process all transactions
            const stored = localStorage.getItem('noctura.noteRegistry');
            if (!stored) {
              localStorage.setItem('noctura.noteRegistry', JSON.stringify({
                version: 1,
                lastScannedSlot: 0,
                entries: [],
              }));
              console.log('[debugApi.resetScanSlot] Created new registry with slot 0');
              return { success: true, newSlot: 0 };
            }
            try {
              const parsed = JSON.parse(stored);
              const oldSlot = parsed.lastScannedSlot || 0;
              parsed.lastScannedSlot = 0;
              localStorage.setItem('noctura.noteRegistry', JSON.stringify(parsed));
              console.log('[debugApi.resetScanSlot] Reset slot from', oldSlot, 'to 0');
              return { success: true, oldSlot, newSlot: 0 };
            } catch (err) {
              return { error: (err as Error).message };
            }
          },
          async checkMemoTx(signature: string) {
            // Directly fetch and check a specific memo transaction
            if (!keypair) return { error: 'No keypair available' };
            const { Connection } = await import('@solana/web3.js');
            const { getECDHPrivateKey, deriveShieldedKeys } = await import('./lib/shieldedKeys');
            const { deserializeEncryptedNote, decryptNoteWithViewKey } = await import('./lib/ecdhEncryption');
            
            // Show recipient's shielded address for comparison
            const keys = deriveShieldedKeys(keypair);
            console.log('[debugApi.checkMemoTx] This wallet shielded address:', keys.shieldedAddress);
            
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
            console.log('[debugApi.checkMemoTx] Fetching tx:', signature);
            
            try {
              const tx = await connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
              });
              
              if (!tx) return { error: 'Transaction not found' };
              
              const logs = tx.meta?.logMessages || [];
              console.log('[debugApi.checkMemoTx] Logs:', logs);
              
              // Look for noctura: prefix
              for (const log of logs) {
                if (log.includes('noctura:')) {
                  console.log('[debugApi.checkMemoTx] Found noctura log:', log.slice(0, 200));
                  
                  // Extract and parse
                  const dataStart = log.indexOf('noctura:') + 'noctura:'.length;
                  let encryptedDataStr = log.slice(dataStart).trim();
                  
                  // Remove trailing quote
                  if (encryptedDataStr.endsWith('"')) {
                    encryptedDataStr = encryptedDataStr.slice(0, -1);
                  }
                  
                  // Check for tx reference
                  const colonIndex = encryptedDataStr.indexOf(':');
                  if (colonIndex === 20) {
                    encryptedDataStr = encryptedDataStr.slice(21);
                  }
                  
                  console.log('[debugApi.checkMemoTx] Encrypted data:', encryptedDataStr.slice(0, 100));
                  
                  const encryptedData = deserializeEncryptedNote(encryptedDataStr);
                  if (!encryptedData) {
                    return { error: 'Failed to deserialize encrypted note' };
                  }
                  
                  console.log('[debugApi.checkMemoTx] Deserialized, attempting decrypt...');
                  const ecdhPrivateKey = getECDHPrivateKey(keypair);
                  const decrypted = decryptNoteWithViewKey(encryptedData, ecdhPrivateKey);
                  
                  if (decrypted) {
                    return { success: true, decrypted, message: 'Note decrypted successfully!' };
                  } else {
                    return { 
                      success: false, 
                      message: 'Decryption failed - note not for this wallet',
                      thisWalletAddress: keys.shieldedAddress,
                      hint: 'Check if sender used correct shielded address'
                    };
                  }
                }
              }
              
              return { error: 'No noctura: prefix found in logs' };
            } catch (err) {
              return { error: (err as Error).message };
            }
          },
          async getMyShieldedAddress() {
            if (!keypair) return { error: 'No keypair available' };
            const { deriveShieldedKeys } = await import('./lib/shieldedKeys');
            const keys = deriveShieldedKeys(keypair);
            return {
              shieldedAddress: keys.shieldedAddress,
              publicKeyHex: Array.from(keys.shieldedPublicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
            };
          },
          
          // Debug: verify that the private key and public key are a valid pair
          async verifyKeyPair() {
            if (!keypair) return { error: 'No keypair available' };
            const { deriveShieldedKeys, getECDHPrivateKey } = await import('./lib/shieldedKeys');
            const secp256k1 = await import('@noble/secp256k1');
            const keys = deriveShieldedKeys(keypair);
            const ecdhPrivKey = getECDHPrivateKey(keypair);
            
            // Derive public key from private key
            const derivedPubKey = secp256k1.getPublicKey(ecdhPrivKey, true);
            
            // Convert both to hex for comparison
            const storedPubHex = Array.from(keys.shieldedPublicKey).map(b => b.toString(16).padStart(2, '0')).join('');
            const derivedPubHex = Array.from(derivedPubKey).map(b => b.toString(16).padStart(2, '0')).join('');
            
            const match = storedPubHex === derivedPubHex;
            
            return {
              ecdhPrivKeyLength: ecdhPrivKey.length,
              ecdhPrivKeyFirstBytes: Array.from(ecdhPrivKey.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(''),
              storedPublicKey: storedPubHex,
              derivedPublicKey: derivedPubHex,
              keysMatch: match,
              shieldedAddress: keys.shieldedAddress,
            };
          },
          
          // Debug: test encryption/decryption with own keys (round trip)
          async testSelfEncrypt() {
            if (!keypair) return { error: 'No keypair available' };
            const { deriveShieldedKeys, getECDHPrivateKey } = await import('./lib/shieldedKeys');
            const { encryptNoteToRecipient, decryptNoteWithViewKey, serializeEncryptedNote, deserializeEncryptedNote } = await import('./lib/ecdhEncryption');
            
            const keys = deriveShieldedKeys(keypair);
            const ecdhPrivKey = getECDHPrivateKey(keypair);
            
            // Create test payload
            const testPayload = {
              amount: '1000000',
              tokenMint: '11111111111111111111111111111111',
              secret: '12345',
              blinding: '67890',
              rho: '11111',
              commitment: '22222',
              tokenType: 'SOL' as const,
            };
            
            // Encrypt to own public key
            const encrypted = encryptNoteToRecipient(keys.shieldedPublicKey, testPayload);
            const serialized = serializeEncryptedNote(encrypted);
            console.log('[testSelfEncrypt] Encrypted and serialized, length:', serialized.length);
            
            // Try to decrypt
            const deserialized = deserializeEncryptedNote(serialized);
            if (!deserialized) return { error: 'Failed to deserialize' };
            
            const decrypted = decryptNoteWithViewKey(deserialized, ecdhPrivKey);
            
            if (decrypted) {
              return {
                success: true,
                original: testPayload,
                decrypted: decrypted,
                match: decrypted.amount === testPayload.amount,
              };
            } else {
              return {
                success: false,
                error: 'Decryption failed even for self-encryption!',
                pubKeyUsed: Array.from(keys.shieldedPublicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
              };
            }
          },
          
          // Debug: test decrypting with a specific address to verify address decoding
          async testAddressDecryption(address: string) {
            if (!keypair) return { error: 'No keypair available' };
            const { deriveShieldedKeys, getECDHPrivateKey, decodeShieldedAddress, isValidShieldedAddress } = await import('./lib/shieldedKeys');
            const { encryptNoteToRecipient, decryptNoteWithViewKey, serializeEncryptedNote, deserializeEncryptedNote } = await import('./lib/ecdhEncryption');
            
            // Validate address
            if (!isValidShieldedAddress(address)) {
              return { error: 'Invalid shielded address' };
            }
            
            // Get my keys
            const keys = deriveShieldedKeys(keypair);
            const ecdhPrivKey = getECDHPrivateKey(keypair);
            
            // Decode the provided address
            const decodedPubKey = decodeShieldedAddress(address);
            const decodedPubKeyHex = Array.from(decodedPubKey).map(b => b.toString(16).padStart(2, '0')).join('');
            const myPubKeyHex = Array.from(keys.shieldedPublicKey).map(b => b.toString(16).padStart(2, '0')).join('');
            
            // Check if this address is mine
            const isMyAddress = address === keys.shieldedAddress;
            const pubKeysMatch = decodedPubKeyHex === myPubKeyHex;
            
            // Create test payload
            const testPayload = {
              amount: '999888',
              tokenMint: '11111111111111111111111111111111',
              secret: '12345',
              blinding: '67890',
              rho: '11111',
              commitment: '22222',
              tokenType: 'NOC' as const,
            };
            
            // Encrypt using the decoded public key (simulating what sender does)
            const encrypted = encryptNoteToRecipient(decodedPubKey, testPayload);
            const serialized = serializeEncryptedNote(encrypted);
            
            // Try to decrypt with my private key
            const deserialized = deserializeEncryptedNote(serialized);
            if (!deserialized) return { error: 'Failed to deserialize' };
            
            const decrypted = decryptNoteWithViewKey(deserialized, ecdhPrivKey);
            
            return {
              providedAddress: address,
              myAddress: keys.shieldedAddress,
              isMyAddress: isMyAddress,
              decodedPubKey: decodedPubKeyHex,
              myPublicKey: myPubKeyHex,
              pubKeysMatch: pubKeysMatch,
              decryptionResult: decrypted ? 'SUCCESS' : 'FAILED',
              decryptedAmount: decrypted?.amount || null,
            };
          },
          
          // Debug: Extract raw memo data from a transaction without decrypting
          async extractMemoData(signature: string) {
            const { Connection } = await import('@solana/web3.js');
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
            
            console.log('[extractMemoData] Fetching tx:', signature);
            const tx = await connection.getTransaction(signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });
            
            if (!tx) return { error: 'Transaction not found' };
            
            const logs = tx.meta?.logMessages || [];
            console.log('[extractMemoData] All logs:');
            logs.forEach((log, i) => console.log(`  [${i}] ${log}`));
            
            // Find noctura: log
            for (const log of logs) {
              if (log.includes('noctura:')) {
                console.log('[extractMemoData] Found noctura log');
                
                // Extract everything after noctura:
                const dataStart = log.indexOf('noctura:') + 'noctura:'.length;
                let rawData = log.slice(dataStart).trim();
                console.log('[extractMemoData] Raw after "noctura:":', rawData.slice(0, 100) + '...');
                
                // Check for trailing quotes
                if (rawData.endsWith('\\"')) {
                  rawData = rawData.slice(0, -2);
                  console.log('[extractMemoData] Removed trailing \\"');
                } else if (rawData.endsWith('"')) {
                  rawData = rawData.slice(0, -1);
                  console.log('[extractMemoData] Removed trailing "');
                }
                
                // Check for tx reference (20 chars before colon)
                const colonIdx = rawData.indexOf(':');
                console.log('[extractMemoData] First colon at index:', colonIdx);
                
                let encryptedData = rawData;
                if (colonIdx === 20) {
                  const txRef = rawData.slice(0, 20);
                  encryptedData = rawData.slice(21);
                  console.log('[extractMemoData] TX reference:', txRef);
                }
                
                console.log('[extractMemoData] Encrypted data start:', encryptedData.slice(0, 80));
                console.log('[extractMemoData] Encrypted data length:', encryptedData.length);
                
                // Split into parts
                const parts = encryptedData.split('|');
                console.log('[extractMemoData] Parts count:', parts.length);
                
                if (parts.length === 3) {
                  return {
                    success: true,
                    ephemeralPubkey: parts[0],
                    ephemeralPubkeyLength: parts[0].length,
                    nonce: parts[1],
                    nonceLength: parts[1].length,
                    ciphertext: parts[2],
                    ciphertextLength: parts[2].length,
                    totalLength: encryptedData.length,
                    // Expected lengths: ephemeralPubkey=66, nonce=24, ciphertext=356
                    isValidFormat: parts[0].length === 66 && parts[1].length === 24 && parts[2].length === 356,
                  };
                } else {
                  return {
                    error: 'Invalid format - expected 3 parts separated by |',
                    partsCount: parts.length,
                    rawData: encryptedData.slice(0, 200),
                  };
                }
              }
            }
            
            return { error: 'No noctura: prefix found in logs' };
          },
          
          // Debug: Compare sent vs received data
          // Run this on SENDER after transfer to see what was sent
          getLastSentMemo() {
            const pending = (window as any).__lastSentMemo;
            if (!pending) return { error: 'No memo data stored. Do a transfer first.' };
            return pending;
          },
          
          // Debug: Extract memo from last sent transfer (use memoSignature from getLastSentMemo)
          async extractLastMemo() {
            const lastMemo = (window as any).__lastSentMemo;
            if (!lastMemo || !lastMemo.memoSignature) {
              return { error: 'No memo signature stored. Do a transfer first, then call this.' };
            }
            // Call extractMemoData with the stored signature
            return await (window as any).debugApi.extractMemoData(lastMemo.memoSignature);
          },
          
          // Debug: Try to decrypt a specific encrypted note string directly
          // Use this to test if the encrypted data can be decrypted
          async tryDecrypt(encryptedNoteString: string) {
            if (!keypair) return { error: 'No keypair available' };
            const { getECDHPrivateKey, deriveShieldedKeys } = await import('./lib/shieldedKeys');
            const { deserializeEncryptedNote, decryptNoteWithViewKey } = await import('./lib/ecdhEncryption');
            
            const keys = deriveShieldedKeys(keypair);
            const ecdhPrivKey = getECDHPrivateKey(keypair);
            
            console.log('[tryDecrypt] My shielded address:', keys.shieldedAddress);
            console.log('[tryDecrypt] Encrypted data length:', encryptedNoteString.length);
            
            const encryptedData = deserializeEncryptedNote(encryptedNoteString);
            if (!encryptedData) {
              return { error: 'Failed to deserialize encrypted note string' };
            }
            
            console.log('[tryDecrypt] Deserialized - ephemeralPubkey:', encryptedData.ephemeralPubkey.slice(0, 20));
            console.log('[tryDecrypt] Nonce:', encryptedData.nonce);
            console.log('[tryDecrypt] Ciphertext length:', encryptedData.ciphertext.length);
            
            const decrypted = decryptNoteWithViewKey(encryptedData, ecdhPrivKey);
            
            if (decrypted) {
              return {
                success: true,
                decrypted: {
                  amount: decrypted.amount,
                  tokenType: decrypted.tokenType,
                  commitment: decrypted.commitment,
                },
              };
            } else {
              return {
                success: false,
                error: 'Decryption failed - note not encrypted to this wallet',
                myAddress: keys.shieldedAddress,
              };
            }
          },
        };

        console.log('[Privacy] ✅ All privacy systems initialized - 100% Privacy enabled');
        
        // Purge corrupted notes from localStorage on startup
        const purgeResult = purgeCorruptedNotes();
        if (purgeResult.removed > 0) {
          console.log(`[Privacy] ✅ Cleaned up ${purgeResult.removed} corrupted notes from localStorage`);
          console.log('[Privacy] Removed notes:', purgeResult.notes);
        }
      } catch (err) {
        console.error('[Privacy] Error initializing privacy systems:', err);
      }
    };

    initializePrivacy();
  }, [keypair]);

  // Derive shielded keys when keypair is available (for private transfers)
  useEffect(() => {
    if (!keypair) {
      setShieldedKeys(null);
      return;
    }
    
    try {
      const keys = deriveShieldedKeys(keypair);
      setShieldedKeys(keys);
      console.log('[ShieldedKeys] ✅ Derived shielded keys for private transfers');
      console.log('[ShieldedKeys] Shielded address:', keys.shieldedAddress);
    } catch (err) {
      console.error('[ShieldedKeys] Failed to derive shielded keys:', err);
    }
  }, [keypair]);

  // Start/stop background scanner for incoming private transfers
  useEffect(() => {
    if (!keypair) {
      stopScanner();
      return;
    }
    
    // Handle incoming notes discovered by scanner
    const handleNewNote = (incoming: DecryptedIncomingNote) => {
      console.log('[Scanner] 🎉 New private transfer received!', {
        amount: incoming.notePayload.amount,
        tokenType: incoming.notePayload.tokenType,
        commitment: incoming.commitment.slice(0, 16) + '...',
      });
      
      const tokenType = incoming.notePayload.tokenType;
      
      // Reconstruct full Note object to get nullifier
      const fullNote = reconstructNoteFromPayload(incoming.notePayload);
      
      // Add to shielded notes store
      const noteRecord: ShieldedNoteRecord = {
        commitment: incoming.notePayload.commitment,
        nullifier: fullNote.nullifier.toString(),
        amount: incoming.notePayload.amount,
        tokenMintField: incoming.notePayload.tokenMint,
        tokenMintAddress: tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT,
        owner: keypair.publicKey.toBase58(),
        secret: incoming.notePayload.secret,
        blinding: incoming.notePayload.blinding,
        rho: incoming.notePayload.rho,
        leafIndex: -1, // Will need to be resolved from on-chain
        spent: false,
        createdAt: Date.now(),
        tokenType,
        signature: incoming.signature,
      };
      
      addShieldedNote(noteRecord);
      
      // Record the incoming private transfer in transaction history
      const amountDisplay = tokenType === 'SOL' 
        ? (Number(BigInt(incoming.notePayload.amount)) / 1e9).toFixed(6) 
        : (Number(BigInt(incoming.notePayload.amount)) / 1e6).toFixed(6);
        
      addTransaction({
        type: 'shielded_receive',
        status: 'success',
        signature: incoming.signature,
        amount: amountDisplay,
        token: tokenType,
        from: 'Private Transfer',
        to: 'Shielded Vault',
        isShielded: true,
        walletAddress: keypair.publicKey.toBase58(),
      });
      
      setStatus(`✨ Received ${amountDisplay} ${tokenType} privately!`);
    };
    
    // Start scanner
    startScanner(keypair, handleNewNote);
    console.log('[Scanner] ✅ Background scanner started for incoming private transfers');
    
    // Cleanup on unmount or keypair change
    return () => {
      stopScanner();
    };
  }, [keypair, addShieldedNote, addTransaction]);

  const [solBalance, setSolBalance] = useState(0);
  const [nocBalance, setNocBalance] = useState(0);
  const [shieldedKeys, setShieldedKeys] = useState<ShieldedKeyPair | null>(null);
  const shieldedSyncAttempted = useRef(false);

  // Calculate shielded balances from notes (excluding corrupted notes)
  const { shieldedSolBalance, shieldedNocBalance, corruptedNotesCount } = useMemo(() => {
    const currentWalletAddress = keypair?.publicKey.toBase58();
    const walletNotes = shieldedNotes.filter((note) => note.owner === currentWalletAddress);
    
    // Filter by tokenType field (primary source of truth)
    const unspentSolNotes = walletNotes.filter((n) => !n.spent && n.tokenType === 'SOL');
    const unspentNocNotes = walletNotes.filter((n) => !n.spent && (n.tokenType === 'NOC' || !n.tokenType));
    
    // Filter out corrupted notes from balance calculation
    const validSolNotes = filterCorruptedNotes(unspentSolNotes);
    const validNocNotes = filterCorruptedNotes(unspentNocNotes);
    const corruptedCount = (unspentSolNotes.length - validSolNotes.length) + (unspentNocNotes.length - validNocNotes.length);
    
    const totalSol = validSolNotes.reduce((sum, n) => sum + Number(BigInt(n.amount)), 0) / LAMPORTS_PER_SOL;
    const totalNoc = validNocNotes.reduce((sum, n) => sum + Number(BigInt(n.amount)), 0) / 1_000_000;
    
    if (corruptedCount > 0) {
      console.warn(`[Balance] Excluding ${corruptedCount} corrupted notes from balance`);
    }
    
    return { shieldedSolBalance: totalSol, shieldedNocBalance: totalNoc, corruptedNotesCount: corruptedCount };
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
  const [pendingRecipient, setPendingRecipient] = useState<string | null>(null);
  const [pendingRecipientAta, setPendingRecipientAta] = useState<string | null>(null);
  const [shieldedSendPending, setShieldedSendPending] = useState(false);
  const [shieldedSendError, setShieldedSendError] = useState<string | null>(null);
  const [networkFeeEstimate, setNetworkFeeEstimate] = useState(DEFAULT_SOL_FEE);
  const [feeEstimateError, setFeeEstimateError] = useState<string | null>(null);
  const [txConfirmation, setTxConfirmation] = useState<TransactionConfirmation | null>(null);
  const [txConfirmPending, setTxConfirmPending] = useState(false);
  const [txSuccess, setTxSuccess] = useState<{ signature: string; amount: string; recipient: string; token: 'SOL' | 'NOC' } | null>(null);
  const [shieldedTxSuccess, setShieldedTxSuccess] = useState<{ signature: string; amount: string; recipient: string; from?: string; token: 'SOL' | 'NOC'; isFullPrivacy?: boolean } | null>(null);
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [stagedSendPlan, setStagedSendPlan] = useState<{ recipient: PublicKey; amount: bigint; steps: number; fullCount: number; hasPartial: boolean; feeEstimate: number } | null>(null);
  const [transparentPayout, setTransparentPayout] = useState(false); // Default to false: privacy-first, recipient/amount hidden on-chain
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
          tokenMint: getCorrectTokenMint(current),
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

          // Use tokenType 'SOL' for creating notes
          const changeNote = createNoteFromSecrets(changeAmount, 'SOL');
          const recipientNote = createNoteFromSecrets(recipientPortion, 'SOL');

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
            'SOL',
            { signature: splitResult.signature }
          );
          addShieldedNote(changeRecord);
          available.push(changeRecord);

          // Now withdraw the recipient portion to transparent recipient
          // Build Merkle proof for recipient note (include change record)
          setStatus(`Step ${i + 1}/${plan.steps.length}: Building withdraw proof…`);
          const recipientRecord = snapshotNote(
            recipientNote,
            keypair.publicKey,
            'SOL',
            { signature: splitResult.signature }
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
    // Only allow airdrop if faucetGranted has never been set - one-time per wallet
    const needs = !stored?.faucetGranted;
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
        setTransparentPayout(false); // Reset to private mode when entering shielded mode
      }
    },
    [setActionType, setSelectedToken],
  );

  const resetPendingShieldedTransfer = useCallback(() => {
    setPendingWithdrawalProof(null);
    setPendingWithdrawalNote(null);
    setPendingRecipient(null);
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
      const loaded = useShieldedNotes.getState().manualLoad();
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
  }, [keypair, mode, shieldedNotes.length, markMultipleSpent]);

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
        // Check if recipient is a shielded address (noctura1...) or Solana address
        const isShieldedRecipient = trimmedRecipient.startsWith('noctura1');
        
        if (isShieldedRecipient) {
          // Validate shielded address
          if (!isValidShieldedAddress(trimmedRecipient)) {
            throw new Error('Invalid shielded address format. Expected: noctura1<hex>');
          }
          
          // SHIELDED-TO-SHIELDED TRANSFER: Full privacy - both sender and recipient hidden
          console.log('[Transfer] 🔒 Shielded-to-shielded transfer initiated');
          
          // Decode recipient's public key from shielded address
          const recipientPublicKey = decodeShieldedAddress(trimmedRecipient);
          
          // Verify it's a valid compressed secp256k1 pubkey
          if (recipientPublicKey.length !== 33 || (recipientPublicKey[0] !== 0x02 && recipientPublicKey[0] !== 0x03)) {
            throw new Error('Invalid recipient public key - not a valid compressed secp256k1 key');
          }
          
          // Get sender's wallet address for filtering notes
          const walletAddress = keypair.publicKey.toBase58();
          
          // Filter notes for this token type
          const typeFilteredNotes = shieldedNotes.filter((note) => {
            if (note.spent || note.owner !== walletAddress) return false;
            if (tokenType === 'SOL') return note.tokenType === 'SOL';
            return note.tokenType === 'NOC' || !note.tokenType;
          });
          
          const availableNotes = filterCorruptedNotes(typeFilteredNotes);
          if (!availableNotes.length) {
            throw new Error(`No shielded ${tokenType} balance for private transfer.`);
          }
          
          // Find a note with sufficient balance
          const sortedNotes = [...availableNotes].sort((a, b) => 
            Number(BigInt(b.amount) - BigInt(a.amount))
          );
          const spendNote = sortedNotes.find(n => BigInt(n.amount) >= atoms) || sortedNotes[0];
          const noteAmount = BigInt(spendNote.amount);
          
          // For shielded-to-shielded transfers, the fee is collected SEPARATELY
          // The transfer circuit requires: input = output1 + output2
          // So we don't include fee in the transfer amounts - it's withdrawn separately
          // This applies to BOTH SOL and NOC transfers
          const totalNeeded = atoms; // Just the transfer amount, no fee in circuit
          
          // Verify we have NOC for the privacy fee (always needed for shielded-to-shielded)
          const nocNotes = shieldedNotes.filter(n => {
            if (n.spent || n.owner !== walletAddress) return false;
            // Must be explicitly NOC token
            if (n.tokenType === 'NOC') return true;
            if (n.tokenMintAddress === NOC_TOKEN_MINT) return true;
            // Legacy notes without tokenType that match NOC mint
            if (!n.tokenType && n.tokenMintAddress === NOC_TOKEN_MINT) return true;
            return false;
          });
          const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
          console.log('[Transfer] NOC available for fee:', Number(totalNocAvailable) / 1e6, 'NOC notes:', nocNotes.length);
          
          // For NOC transfers, we need fee PLUS the transfer amount
          // For SOL transfers, we just need the fee in NOC
          if (tokenType === 'NOC') {
            // NOC transfer: need enough NOC for both transfer AND fee (from possibly different notes)
            const totalNocNeeded = atoms + PRIVACY_FEE_ATOMS;
            const allNocAvailable = availableNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
            if (allNocAvailable < totalNocNeeded) {
              throw new Error(`Insufficient NOC. Need ${Number(totalNocNeeded) / 1_000_000} NOC (${Number(atoms) / 1_000_000} + 0.25 fee) but only have ${Number(allNocAvailable) / 1_000_000} NOC shielded.`);
            }
          } else {
            // SOL transfer: need fee from NOC balance
            if (totalNocAvailable < PRIVACY_FEE_ATOMS) {
              throw new Error(`Insufficient NOC for privacy fee. Need 0.25 NOC but only have ${(Number(totalNocAvailable) / 1_000_000).toFixed(6)} NOC shielded.`);
            }
          }
          
          if (noteAmount < totalNeeded) {
            // Need multi-note or error
            const totalAvailable = availableNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
            if (totalAvailable < totalNeeded) {
              throw new Error(`Insufficient ${tokenType}. Need ${Number(totalNeeded) / (tokenType === 'SOL' ? 1e9 : 1e6)} but only have ${Number(totalAvailable) / (tokenType === 'SOL' ? 1e9 : 1e6)} shielded.`);
            }
            // For now, require single note (multi-note shielded-to-shielded coming later)
            throw new Error(`Your largest ${tokenType} note has ${Number(noteAmount) / (tokenType === 'SOL' ? 1e9 : 1e6)} but need ${Number(totalNeeded) / (tokenType === 'SOL' ? 1e9 : 1e6)}. Please consolidate notes first.`);
          }
          
          // Build merkle proof for the input note
          const merkleProof = buildMerkleProof(availableNotes, spendNote);
          
          const inputNote = {
            secret: BigInt(spendNote.secret),
            amount: noteAmount,
            tokenMint: getCorrectTokenMint(spendNote),
            blinding: BigInt(spendNote.blinding),
            rho: BigInt(spendNote.rho),
            commitment: BigInt(spendNote.commitment),
            nullifier: BigInt(spendNote.nullifier),
          };
          
          // Create recipient's note (they will own this in the vault)
          const recipientNote = createNoteFromSecrets(atoms, tokenType);
          console.log('[Transfer] Created recipient note with commitment:', recipientNote.commitment.toString().slice(0, 20));
          
          // Create change note back to sender
          // For NOC transfers: fee is deducted from change (input = recipient + change + fee)
          // For SOL transfers: fee is collected separately from NOC balance
          const feeDeductedFromChange = tokenType === 'NOC' ? PRIVACY_FEE_ATOMS : 0n;
          const changeAmount = noteAmount - atoms - feeDeductedFromChange;
          
          if (changeAmount < 0n) {
            throw new Error(`Insufficient ${tokenType} for transfer plus fee. Have ${Number(noteAmount) / 1e6}, need ${Number(atoms + feeDeductedFromChange) / 1e6}`);
          }
          
          const changeNote = createNoteFromSecrets(changeAmount, tokenType);
          console.log('[Transfer] Created change note:', Number(changeAmount) / (tokenType === 'SOL' ? 1e9 : 1e6), tokenType, tokenType === 'NOC' ? '(fee deducted from change)' : '');
          
          // Store pending shielded-to-shielded transfer data for confirmation
          (window as unknown as Record<string, unknown>).__pendingTransfer = {
            isShieldedToShielded: true,
            inputNote,
            merkleProof,
            recipientNote,
            changeNote,
            recipientPublicKey,
            spendNote,
            trimmedRecipient,
            atoms,
            tokenType,
            parsedAmount,
            changeAmount,
          };
          
          console.log('[Transfer] Opening review modal for shielded-to-shielded transfer');
          
          // Show confirmation modal with transfer details
          setTransferReview({
            recipient: trimmedRecipient,
            amount: parsedAmount,
            atoms,
            feeNoc: 0.25, // Privacy fee (for NOC: deducted from change, for SOL: separate withdrawal)
            isPartialSpend: changeAmount > 0n,
            changeAmount: changeAmount > 0n ? Number(changeAmount) / (tokenType === 'SOL' ? 1e9 : 1e6) : undefined,
            tokenType,
            isFullyPrivate: true, // Shielded-to-shielded is always fully private
          });
          
          const feeNote = tokenType === 'NOC' ? ' (0.25 NOC fee deducted from change)' : '';
          const changeMsg = changeAmount > 0n 
            ? ` Change: ${(Number(changeAmount) / (tokenType === 'SOL' ? 1e9 : 1e6)).toFixed(tokenType === 'SOL' ? 9 : 6)} ${tokenType} stays shielded.${feeNote}`
            : '';
          setStatus(`Review: Full privacy transfer of ${parsedAmount} ${tokenType}.${changeMsg}`);
          setShieldedSendPending(false); // Ready for user to confirm
          return; // Exit early - wait for confirmation
        }
        
        // Standard Solana address - WARN: This breaks privacy!
        // Funds must physically leave the vault, making recipient and amount visible
        console.warn('[Transfer] ⚠️ PRIVACY WARNING: Sending to Solana address reveals recipient + amount on-chain');
        console.warn('[Transfer] For full privacy, recipient should use noctura1... address');
        
        let recipientKey: PublicKey;
        try {
          recipientKey = new PublicKey(trimmedRecipient);
        } catch {
          throw new Error('Invalid recipient address. Enter a valid Solana address or shielded address (noctura1...).');
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
        const typeFilteredNotes = shieldedNotes.filter((note) => {
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
        
        // Filter out corrupted notes (tokenMintField doesn't match tokenType)
        const availableNotes = filterCorruptedNotes(typeFilteredNotes);
        console.log(`[startShieldedTransfer] Available ${tokenType} notes after filtering:`, availableNotes.length, 'out of', shieldedNotes.length, 'total (excluded', typeFilteredNotes.length - availableNotes.length, 'corrupted)');
        if (!availableNotes.length) {
          const corruptedCount = typeFilteredNotes.length - availableNotes.length;
          if (corruptedCount > 0) {
            throw new Error(`No valid shielded ${tokenType} balance. Found ${corruptedCount} corrupted notes that cannot be used. Please make a new deposit.`);
          }
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
                  
                  try {
                    setStatus(`Consolidating batch ${stepNum}/${consolidationSteps.length}… (proof generation ~30-60s)`);
                    console.log(`[Transfer] Consolidation step ${stepNum}: merging ${step.inputNotes.length} notes`);
                    
                    // Build witness using all notes in the tree for merkle proof
                    console.log(`[Transfer] Building consolidation witness with ${allNotesInTree.length} notes in tree`);
                    const consolidateWitness = buildConsolidationWitness({
                      inputRecords: step.inputRecords,
                      outputNote: step.outputNote,
                      allNotesForMerkle: allNotesInTree,
                    });
                    console.log(`[Transfer] Consolidation witness built successfully`, consolidateWitness);
                    
                    // Generate proof
                    console.log(`[Transfer] Sending consolidation witness to prover...`);
                    const consolidateProof = await proveCircuit('consolidate', consolidateWitness);
                    console.log(`[Transfer] Consolidation proof ${stepNum} generated`, consolidateProof);
                  
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
                  } catch (consolidateError) {
                    console.error(`[Transfer] Consolidation step ${stepNum} failed:`, consolidateError);
                    throw new Error(`Consolidation failed: ${consolidateError instanceof Error ? consolidateError.message : String(consolidateError)}`);
                  }
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
            
            // Debug: Log all selected notes with their tokenMint values
            selectedNotes.forEach((note, idx) => {
              console.log(`[Transfer] Note ${idx + 1} tokenMint debug:`, {
                tokenMintField: note.tokenMintField,
                tokenMintFieldType: typeof note.tokenMintField,
                tokenMintFieldLength: note.tokenMintField?.length,
                tokenMintAddress: note.tokenMintAddress,
                tokenType: note.tokenType,
                commitment: note.commitment.slice(0, 20),
              });
            });

            const inputNotes = selectedNotes.map(note => {
              // Validate tokenMintField before conversion
              if (!note.tokenMintField || note.tokenMintField === 'undefined') {
                console.error('[Transfer] ❌ Note has invalid tokenMintField:', note);
                throw new Error(`Note ${note.nullifier.slice(0, 8)} has invalid tokenMintField`);
              }
              return {
                secret: BigInt(note.secret),
                amount: BigInt(note.amount),
                tokenMint: getCorrectTokenMint(note),
                blinding: BigInt(note.blinding),
                rho: BigInt(note.rho),
                commitment: BigInt(note.commitment),
                nullifier: BigInt(note.nullifier),
              };
            });

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
            const merkleProofsMulti = selectedNotes.map((note, idx) => {
              console.log(`[Transfer] Building merkle proof for note ${idx + 1}:`, {
                commitment: note.commitment.slice(0, 20),
                amount: note.amount,
                tokenMintField: note.tokenMintField?.slice(0, 20),
                tokenMintAddress: note.tokenMintAddress,
                tokenType: note.tokenType,
              });
              return buildMerkleProof(availableNotes, note);
            });
            
            // Verify all merkle roots are the same
            const roots = merkleProofsMulti.map(p => p.root.toString());
            console.log('[Transfer] Merkle roots for all notes:', roots);
            if (new Set(roots).size > 1) {
              console.error('[Transfer] ❌ CRITICAL: Merkle roots do not match!');
              throw new Error('Merkle tree inconsistency: different roots for different notes');
            }
            
            // Verify all notes have the same tokenMint
            const tokenMints = selectedNotes.map(n => n.tokenMintField);
            console.log('[Transfer] Token mints for all notes:', tokenMints);
            if (new Set(tokenMints).size > 1) {
              console.error('[Transfer] ❌ CRITICAL: Notes have different token mints!');
              throw new Error('Cannot combine notes with different token mints');
            }

            // Create output notes with correct tokenType
            const recipientNote = createNoteFromSecrets(recipientNoteAmount, tokenType);
            const changeNote = createNoteFromSecrets(changeAmount, tokenType);

            console.log('[Transfer] Serializing transfer-multi witness...');
            
            // Debug: Verify inputs before serialization
            console.log('[Transfer] === PRE-SERIALIZATION DEBUG ===');
            console.log('[Transfer] Input notes count:', inputNotes.length);
            inputNotes.forEach((n, i) => {
              console.log(`[Transfer] Input note ${i + 1}:`, {
                amount: n.amount.toString(),
                tokenMint: n.tokenMint.toString().slice(0, 20),
                commitment: n.commitment.toString().slice(0, 20),
                nullifier: n.nullifier.toString().slice(0, 20),
              });
            });
            console.log('[Transfer] Merkle proofs count:', merkleProofsMulti.length);
            merkleProofsMulti.forEach((p, i) => {
              console.log(`[Transfer] Merkle proof ${i + 1}:`, {
                root: p.root.toString().slice(0, 20),
                pathLength: p.pathElements.length,
                pathIndices: p.pathIndices,
              });
            });
            console.log('[Transfer] Output note 1 amount:', recipientNote.amount.toString());
            console.log('[Transfer] Output note 2 amount:', changeNote.amount.toString());
            console.log('[Transfer] Total input:', inputNotes.reduce((s, n) => s + n.amount, 0n).toString());
            console.log('[Transfer] Total output:', (recipientNote.amount + changeNote.amount).toString());
            console.log('[Transfer] === END DEBUG ===');
            
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
            setPendingRecipient(recipientKey.toBase58());
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
          tokenMint: getCorrectTokenMint(spendNote),
          blinding: BigInt(spendNote.blinding),
          rho: BigInt(spendNote.rho),
          commitment: BigInt(spendNote.commitment),
          nullifier: BigInt(spendNote.nullifier),
        };

        // For shielded sends, we withdraw to the recipient's transparent wallet
        // Check fee headroom for NOC transparent payout: amount + 0.25 NOC must fit in the note
        if (tokenType === 'NOC' && transparentPayout) {
          const feeAtoms = PRIVACY_FEE_ATOMS;
          if (noteAmount < atoms + feeAtoms) {
            const shieldedBalance = Number(noteAmount) / Math.pow(10, decimals);
            const requestedAmount = Number(atoms) / Math.pow(10, decimals);
            const feeAmount = Number(feeAtoms) / Math.pow(10, decimals);
            const maxWithdrawable = shieldedBalance - feeAmount;
            throw new Error(`Insufficient balance for fee. You have ${shieldedBalance.toFixed(decimals === 9 ? 9 : 6)} ${tokenType} shielded, trying to withdraw ${requestedAmount.toFixed(decimals === 9 ? 9 : 6)} ${tokenType}, but need ${feeAmount.toFixed(decimals === 9 ? 9 : 6)} ${tokenType} for privacy fee. Maximum withdrawable: ${maxWithdrawable.toFixed(decimals === 9 ? 9 : 6)} ${tokenType}.`);
          }
        }

        // Check if this is a partial spend - if so, we need to split the note first
        const isPartialSpend = atoms < noteAmount;
        console.log('[Transfer] isPartialSpend:', isPartialSpend, 'atoms:', atoms.toString(), 'noteAmount:', noteAmount.toString());
        
        if (isPartialSpend) {
          // Partial spend: First split the note using transfer circuit
          // Then the recipient amount will be withdrawn to their transparent wallet
          
          // For NOC transfers: fee is deducted from the SOL note change
          // For SOL transfers: fee comes from a separate NOC note (NOT from SOL)
          let recipientNoteAmount: bigint;
          let changeAmount: bigint;
          
          if (tokenType === 'NOC') {
            // NOC: fee can be deducted from the same token type
            const feeAtoms = PRIVACY_FEE_ATOMS; // 0.25 NOC = 250,000 atoms
            recipientNoteAmount = atoms + feeAtoms; // recipient amount plus fee for withdraw circuit
            changeAmount = noteAmount - recipientNoteAmount;
            
            // Ensure user has enough for amount + fee
            if (changeAmount < 0n) {
              const totalNeededDisplay = Number(recipientNoteAmount) / Math.pow(10, decimals);
              const noteDisplay = Number(noteAmount) / Math.pow(10, decimals);
              throw new Error(`Insufficient shielded ${tokenType} balance. Need ${totalNeededDisplay.toFixed(6)} NOC (${parsedAmount} NOC + 0.25 NOC fee), but this note only has ${noteDisplay.toFixed(6)} NOC. Use a smaller amount or consolidate notes.`);
            }
            
            console.log('[Transfer] NOC partial spend - fee deducted from NOC change:', {
              requestedAmount: Number(atoms) / 1_000_000,
              privacyFeeNoc: 0.25,
              recipientNoteAmount: Number(recipientNoteAmount) / 1_000_000,
              changeRemaining: Number(changeAmount) / 1_000_000,
            });
          } else {
            // SOL: fee comes from a separate NOC note, NOT from SOL
            // User must have at least 0.25 NOC shielded
            const nocNotes = shieldedNotes.filter(n => 
              !n.spent && 
              n.owner === keypair.publicKey.toBase58() && 
              (n.tokenType === 'NOC' || !n.tokenType || n.tokenMintAddress === NOC_TOKEN_MINT)
            );
            const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
            if (totalNocAvailable < PRIVACY_FEE_ATOMS) {
              throw new Error(`Insufficient NOC for privacy fee. Need 0.25 NOC but only have ${(Number(totalNocAvailable) / 1_000_000).toFixed(6)} NOC shielded.`);
            }
            
            // SOL recipient gets exactly what they asked for
            // Change is simply: noteAmount - atoms (no fee deducted from SOL)
            recipientNoteAmount = atoms;
            changeAmount = noteAmount - atoms;
            
            console.log('[Transfer] SOL partial spend - fee will be paid separately from NOC:', {
              requestedAmount: Number(atoms) / 1_000_000_000,
              recipientNoteAmount: Number(recipientNoteAmount) / 1_000_000_000,
              changeRemaining: Number(changeAmount) / 1_000_000_000,
              nocAvailableForFee: Number(totalNocAvailable) / 1_000_000,
            });
          }
          
          // Log the fee breakdown for verification
          console.log('[Transfer] CRITICAL: Fee verification for partial spend:', {
            requestedAmount: Number(atoms) / Math.pow(10, decimals),
            privacyFeeNoc: 0.25,
            changeRemaining: Number(changeAmount) / Math.pow(10, decimals),
            tokenType,
            feeSource: tokenType === 'NOC' ? 'deducted from NOC change' : 'separate NOC note',
          });
          
          console.log('[Transfer] Creating change note for:', changeAmount.toString());
          console.log('[Transfer] Recipient note amount:', recipientNoteAmount.toString());
          
          // Create change note back to ourselves (we keep this shielded)
          // For NOC: change is reduced by recipient amount AND privacy fee
          // For SOL: change is only reduced by recipient amount (fee paid separately in NOC)
          const changeNote = createNoteFromSecrets(changeAmount, tokenType);
          console.log('[Transfer] Change note created (stays shielded)');
          
          // Create a note for the recipient
          // For NOC: includes fee for withdraw circuit
          // For SOL: just the recipient amount (fee paid separately)
          const recipientNote = createNoteFromSecrets(recipientNoteAmount, tokenType);
          console.log('[Transfer] Recipient note created');
          
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
          setPendingRecipient(recipientKey.toBase58());
          setPendingRecipientAta(recipientAta);
          
          // Encode recipient note for sharing
          const sharedNote = encodeSharedNote(recipientNote, tokenType);
          
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
            isPartialSpend: changeAmount > 0n,
            changeAmount: changeAmount > 0n ? Number(changeAmount) / Math.pow(10, decimals) : undefined,
            tokenType,
            sharedNote,
            transparentPayout,
            isFullyPrivate: trimmedRecipient.startsWith('noctura1'),
          });
          const changeMsg = changeAmount > 0n 
            ? ` Change: ${(Number(changeAmount) / Math.pow(10, decimals)).toFixed(decimals === 9 ? 9 : 6)} ${tokenType} stays shielded.`
            : '';
          setStatus(`Review: Sending ${parsedAmount} ${tokenType} to recipient (privacy fee 0.25 NOC).${changeMsg} ALL FUNDS FROM SHIELDED BALANCE.`);
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
          const recipientNote = createNoteFromSecrets(recipientAmount, tokenType);
          const sharedNote = encodeSharedNote(recipientNote, tokenType);
          const recipientZkHash = await computeZkHash(trimmedRecipient, tokenType, recipientAmount);
          
          setPendingWithdrawalProof(proof);
          setPendingWithdrawalNote(spendNote);
          setPendingRecipient(recipientKey.toBase58());
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
            isFullyPrivate: trimmedRecipient.startsWith('noctura1'),
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
    // Immediately show we're processing
    setStatus('Processing transfer...');
    console.log('=== confirmShieldedTransfer START ===');
    
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
      isShieldedToShielded?: boolean;
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
      inputNote?: Note;
      merkleProof?: { root: bigint; pathElements: bigint[]; pathIndices: number[] };
      recipientPublicKey?: Uint8Array;
      spendNote?: ShieldedNoteRecord;
      trimmedRecipient?: string;
      parsedAmount?: number;
    } | undefined;
    
    console.log('[Transfer] Pending transfer state:', {
      exists: !!pendingTransfer,
      isShieldedToShielded: pendingTransfer?.isShieldedToShielded,
      isPartial: pendingTransfer?.isPartial,
      isSequentialConsolidate: pendingTransfer?.isSequentialConsolidate,
      hasInputNote: !!pendingTransfer?.inputNote,
      hasRecipientNote: !!pendingTransfer?.recipientNote,
      hasChangeNote: !!pendingTransfer?.changeNote,
      hasMerkleProof: !!pendingTransfer?.merkleProof,
      hasSpendNote: !!pendingTransfer?.spendNote,
      hasRecipientPublicKey: !!pendingTransfer?.recipientPublicKey,
      tokenType: pendingTransfer?.tokenType,
    });
    
    // DEBUG: Log the raw window object
    console.log('[Transfer] Raw __pendingTransfer:', (window as any).__pendingTransfer);
    
    const isPartialTransfer = pendingTransfer?.isPartial && transferReview?.isPartialSpend;
    const isAutoConsolidate = pendingTransfer?.isAutoConsolidate;
    const isSequentialConsolidate = pendingTransfer?.isSequentialConsolidate;
    const isShieldedToShielded = pendingTransfer?.isShieldedToShielded;
    
    console.log('[Transfer] Transfer type flags:', { isPartialTransfer, isAutoConsolidate, isSequentialConsolidate, isShieldedToShielded });
    
    if (!keypair || !transferReview) {
      console.log('Missing required state, returning early');
      setStatus('❌ Error: Wallet not ready. Please try again.');
      setTransferReview(null);
      return;
    }
    
    // For shielded-to-shielded, validate we have the pending transfer data
    if (isShieldedToShielded) {
      console.log('[Transfer] Validating shielded-to-shielded data...');
      if (!pendingTransfer?.inputNote || !pendingTransfer?.recipientNote) {
        console.error('[Transfer] Missing pending transfer data:', {
          hasInputNote: !!pendingTransfer?.inputNote,
          hasRecipientNote: !!pendingTransfer?.recipientNote,
          hasChangeNote: !!pendingTransfer?.changeNote,
          hasMerkleProof: !!pendingTransfer?.merkleProof,
        });
        setStatus('❌ Error: Missing transfer data. Please cancel and try again.');
        setTransferReview(null);
        resetPendingShieldedTransfer();
        return;
      }
      console.log('[Transfer] ✓ Shielded-to-shielded data validated');
    }
    // For non-sequential consolidate, we need the withdrawal proof and note
    else if (!isSequentialConsolidate && (!pendingWithdrawalProof || !pendingWithdrawalNote)) {
      console.log('Missing withdrawal proof/note (non-sequential case)');
      setStatus('❌ Error: Missing withdrawal proof. Please try again.');
      setTransferReview(null);
      return;
    }
    
    // For non-sequential non-partial, we need the recipient ATA
    if (!isShieldedToShielded && !isSequentialConsolidate && !isPartialTransfer && !pendingRecipientAta) {
      console.log('Missing recipient ATA for full withdrawal');
      setStatus('❌ Error: Missing recipient address. Please try again.');
      setTransferReview(null);
      return;
    }
    
    try {
      setConfirmingTransfer(true);
      
      // Handle shielded-to-shielded transfer
      if (isShieldedToShielded) {
        console.log('[Transfer] 🔒 Checking shielded-to-shielded transfer requirements:', {
          hasInputNote: !!pendingTransfer?.inputNote,
          hasRecipientNote: !!pendingTransfer?.recipientNote,
          hasChangeNote: !!pendingTransfer?.changeNote,
          hasMerkleProof: !!pendingTransfer?.merkleProof,
          hasSpendNote: !!pendingTransfer?.spendNote,
          hasRecipientPublicKey: !!pendingTransfer?.recipientPublicKey,
        });
        
        if (!pendingTransfer?.inputNote || !pendingTransfer?.recipientNote || !pendingTransfer?.changeNote || !pendingTransfer?.merkleProof || !pendingTransfer?.spendNote || !pendingTransfer?.recipientPublicKey) {
          console.error('[Transfer] Missing required data for shielded-to-shielded transfer');
          setStatus('Error: Missing transfer data. Please cancel and try again.');
          setConfirmingTransfer(false);
          setTransferReview(null);
          resetPendingShieldedTransfer();
          return;
        }
        
        console.log('[Transfer] 🔒 Executing shielded-to-shielded transfer');
        const { inputNote, recipientNote, changeNote, merkleProof, spendNote, recipientPublicKey, trimmedRecipient, tokenType, parsedAmount, changeAmount } = pendingTransfer;
        const walletAddress = keypair.publicKey.toBase58();
        
        // For NOC transfers: fee is already included in the change calculation (deducted from change)
        // For SOL transfers: we need to collect a separate 0.25 NOC fee
        
        if (tokenType !== 'NOC') {
          // SOL transfer - need to collect 0.25 NOC fee separately
          setStatus('Preparing privacy fee (0.25 NOC)...');
          
          // Find a NOC note to pay the fee from
          const freshNotes = useShieldedNotes.getState().notes;
          const nocNotes = freshNotes.filter(n => {
            if (n.spent || n.owner !== walletAddress) return false;
            const isNoc = n.tokenType === 'NOC' || n.tokenMintAddress === NOC_TOKEN_MINT;
            return isNoc;
          });
          
          const totalNocAvailable = nocNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
          if (nocNotes.length === 0 || totalNocAvailable < PRIVACY_FEE_ATOMS) {
            setStatus('❌ Insufficient NOC for privacy fee. Need 0.25 NOC shielded.');
            setTransferReview(null);
            resetPendingShieldedTransfer();
            throw new Error('Insufficient NOC in vault for privacy fee. Need 0.25 NOC shielded to pay for private transfers. Please deposit NOC first.');
          }
          
          // Look for an EXACT 0.25 NOC note (withdraw circuit requires full amount)
          let exactFeeNote = nocNotes.find(n => BigInt(n.amount) === PRIVACY_FEE_ATOMS);
          
          if (!exactFeeNote) {
            // No exact fee note - create one from a larger NOC note first
            console.log('[Transfer] No exact 0.25 NOC fee note found - creating one...');
            
            const splittableNote = nocNotes.find(n => BigInt(n.amount) > PRIVACY_FEE_ATOMS);
            
            if (!splittableNote) {
              setStatus('❌ Cannot create fee note: no NOC note larger than 0.25 NOC available.');
              setTransferReview(null);
              resetPendingShieldedTransfer();
              throw new Error('Cannot create fee note: no NOC note larger than 0.25 NOC available.');
            }
            
            console.log('[Transfer] Splitting note:', Number(BigInt(splittableNote.amount)) / 1e6, 'NOC');
            setStatus('Creating 0.25 NOC fee note from vault...');
            
            const allUnspent = useShieldedNotes.getState().notes.filter(
              n => n.owner === walletAddress && !n.spent
            );
            
            const splitInputNote: Note = {
              secret: BigInt(splittableNote.secret),
              amount: BigInt(splittableNote.amount),
              tokenMint: getCorrectTokenMint(splittableNote),
              blinding: BigInt(splittableNote.blinding),
              rho: BigInt(splittableNote.rho),
              commitment: BigInt(splittableNote.commitment),
              nullifier: BigInt(splittableNote.nullifier),
            };
            
            const splitMerkleProof = buildMerkleProof(allUnspent, splittableNote);
            
            const newFeeNote = createNoteFromSecrets(PRIVACY_FEE_ATOMS, 'NOC');
            const splitChangeAmount = BigInt(splittableNote.amount) - PRIVACY_FEE_ATOMS;
            const splitChangeNote = createNoteFromSecrets(splitChangeAmount, 'NOC');
            
            const splitWitness = serializeTransferWitness({
              inputNote: splitInputNote,
              merkleProof: splitMerkleProof,
              outputNote1: newFeeNote,
              outputNote2: splitChangeNote,
            });
            
            console.log('[Transfer] Generating proof to split note...');
            const splitProof = await proveCircuit('transfer', splitWitness);
            
            const splitResult = await relayTransfer({
              proof: splitProof,
              nullifier: splittableNote.nullifier,
              outputCommitment1: newFeeNote.commitment.toString(),
              outputCommitment2: splitChangeNote.commitment.toString(),
            });
            
            console.log('[Transfer] ✅ Created fee note:', splitResult.signature);
            
            markNoteSpent(splittableNote.nullifier);
            
            const feeNoteRecord = snapshotNote(newFeeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
            const changeNoteRecord = snapshotNote(splitChangeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
            addShieldedNote(feeNoteRecord);
            addShieldedNote(changeNoteRecord);
            
            exactFeeNote = feeNoteRecord;
            await new Promise(r => setTimeout(r, 200));
          }
          
          // Collect the 0.25 NOC fee
          setStatus('Collecting privacy fee (0.25 NOC)...');
          console.log('[Transfer] Collecting 0.25 NOC fee note');
          
          const allUnspentNotes = useShieldedNotes.getState().notes.filter(n => n.owner === walletAddress && !n.spent);
          const feeMerkleProof = buildMerkleProof(allUnspentNotes, exactFeeNote);
          
          const feeInputNote: Note = {
            secret: BigInt(exactFeeNote.secret),
            amount: BigInt(exactFeeNote.amount),
            tokenMint: getCorrectTokenMint(exactFeeNote),
            blinding: BigInt(exactFeeNote.blinding),
            rho: BigInt(exactFeeNote.rho),
            commitment: BigInt(exactFeeNote.commitment),
            nullifier: BigInt(exactFeeNote.nullifier),
          };
          
          const nocMint = new PublicKey(NOC_TOKEN_MINT);
          const feeCollectorOwner = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
          const feeCollectorAta = getAssociatedTokenAddressSync(nocMint, feeCollectorOwner, false);
          
          const feeWitness = serializeWithdrawWitness({
            inputNote: feeInputNote,
            merkleProof: feeMerkleProof,
            receiver: pubkeyToField(feeCollectorOwner),
          });
          
          setStatus('Generating fee proof...');
          const feeProof = await proveCircuit('withdraw', feeWitness);
          
          try {
            const feeRes = await relayWithdraw({
              proof: feeProof,
              amount: exactFeeNote.amount,
              nullifier: exactFeeNote.nullifier,
              recipient: feeCollectorOwner.toBase58(),
              recipientAta: feeCollectorAta.toBase58(),
              mint: nocMint.toBase58(),
              collectFee: false,
            });
            console.log('[Transfer] ✅ Fee collected (0.25 NOC):', feeRes.signature);
            markNoteSpent(exactFeeNote.nullifier);
          } catch (feeErr) {
            console.error('[Transfer] Fee collection failed:', feeErr);
            throw new Error('Failed to collect privacy fee. Please try again.');
          }
        } else {
          // NOC transfer - fee is already included in the change (deducted during preparation)
          console.log('[Transfer] NOC transfer - fee already deducted from change, no separate fee collection needed');
        }
        
        // Now generate transfer proof
        setStatus('Generating zero-knowledge proof for private transfer…');
        
        // Serialize transfer witness
        const transferWitness = serializeTransferWitness({
          inputNote,
          merkleProof,
          outputNote1: recipientNote,
          outputNote2: changeNote,
        });
        
        const proof = await proveCircuit('transfer', transferWitness);
        
        // Encrypt the recipient's note so only they can decrypt it
        const notePayload: NotePayload = {
          amount: recipientNote.amount.toString(),
          tokenMint: recipientNote.tokenMint.toString(),
          secret: recipientNote.secret.toString(),
          blinding: recipientNote.blinding.toString(),
          rho: recipientNote.rho.toString(),
          commitment: recipientNote.commitment.toString(),
          tokenType: tokenType || 'NOC',
        };
        
        const encryptedNote = encryptNoteToRecipient(recipientPublicKey, notePayload);
        const encryptedNoteString = serializeEncryptedNote(encryptedNote);
        
        // Store for debugging - can be retrieved with debugApi.getLastSentMemo()
        (window as any).__lastSentMemo = {
          recipientAddress: trimmedRecipient,
          recipientPubKeyHex: Array.from(recipientPublicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
          encryptedNoteString: encryptedNoteString,
          ephemeralPubkey: encryptedNote.ephemeralPubkey,
          nonce: encryptedNote.nonce,
          ciphertext: encryptedNote.ciphertext,
          lengths: {
            ephemeralPubkey: encryptedNote.ephemeralPubkey.length,
            nonce: encryptedNote.nonce.length,
            ciphertext: encryptedNote.ciphertext.length,
            total: encryptedNoteString.length,
          },
          timestamp: Date.now(),
        };
        
        setStatus('Submitting private transfer to chain…');
        
        // Submit via relayer
        const result = await relayTransfer({
          proof,
          nullifier: spendNote.nullifier,
          outputCommitment1: recipientNote.commitment.toString(),
          outputCommitment2: changeNote.commitment.toString(),
        });
        const signature = result.signature;
        
        // Check if this is a self-transfer (sending to own shielded address)
        const isSelfTransfer = shieldedKeys?.shieldedAddress === trimmedRecipient;
        
        // For non-self transfers, send the encrypted memo in a separate transaction
        if (!isSelfTransfer) {
          try {
            setStatus('Sending encrypted note to recipient…');
            const memoResult = await sendEncryptedMemo(encryptedNoteString, signature);
            
            // Store memo signature for debugging
            (window as any).__lastSentMemo.memoSignature = memoResult.signature;
            (window as any).__lastSentMemo.transferSignature = signature;
          } catch (memoErr) {
            console.error('[Transfer] Failed to send memo:', memoErr);
            // Don't fail the transfer - it already succeeded on-chain
          }
        }
        
        // Mark input note as spent and add change note
        markNoteSpent(spendNote.nullifier);
        
        if (isSelfTransfer) {
          // Self-transfer: save the recipient note directly (no memo discovery needed)
          const recipientRecord = snapshotNote(
            recipientNote,
            keypair.publicKey,
            tokenType || 'NOC',
            { signature }
          );
          addShieldedNote(recipientRecord);
        }
        
        if (changeAmount && changeAmount > 0n) {
          const changeRecord = snapshotNote(
            changeNote,
            keypair.publicKey,
            tokenType || 'NOC',
            { signature }
          );
          addShieldedNote(changeRecord);
        }
        
        // Record the shielded transfer in transaction history
        addTransaction({
          type: 'shielded_send',
          status: 'success',
          signature,
          amount: String(parsedAmount),
          token: tokenType || 'NOC',
          from: 'Shielded Vault',
          to: isSelfTransfer ? 'Self (Shielded)' : `${trimmedRecipient?.slice(0, 8)}...${trimmedRecipient?.slice(-4)}`,
          fee: '0.25',
          isShielded: true,
          walletAddress: keypair.publicKey.toBase58(),
        });
        
        // Show shielded success modal
        setShieldedTxSuccess({
          signature,
          amount: `${parsedAmount} ${tokenType || 'NOC'}`,
          from: shieldedKeys?.shieldedAddress || 'Shielded Vault',
          recipient: isSelfTransfer ? 'Self (Shielded Vault)' : (trimmedRecipient || 'Unknown'),
          token: (tokenType || 'NOC') as 'SOL' | 'NOC',
          isFullPrivacy: true,
        });
        
        delete (window as unknown as Record<string, unknown>).__pendingTransfer;
        setTransferReview(null);
        resetPendingShieldedTransfer();
        await refreshBalances();
        return;
      }
      
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
            tokenMint: getCorrectTokenMint(currentNote),
            blinding: BigInt(currentNote.blinding),
            rho: BigInt(currentNote.rho),
            commitment: BigInt(currentNote.commitment),
            nullifier: BigInt(currentNote.nullifier),
          };
          
          const newConsolidatedAmount = consolidatedAmount + nextAmount;
          
          // Create new consolidated note and dummy note using tokenType
          const newConsolidatedNote = createNoteFromSecrets(newConsolidatedAmount, tokenType);
          const dummy = createNoteFromSecrets(0n, tokenType);
          
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
          tokenMint: getCorrectTokenMint(finalConsolidatedNote),
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
            recipient: recipientKey.toBase58(),
            recipientAta,
            mint: mintKey.toBase58(),
            collectFee: true, // Collect 0.25 NOC fee from vault
          });
          console.log('[SequentialConsolidate] Withdrawal succeeded:', res.signature);
          
          // Record the transaction
          addTransaction({
            type: 'shield_withdraw',
            status: 'success',
            signature: res.signature,
            amount: String(Number(pendingTransfer.targetAmount!) / 1e6),
            token: 'NOC',
            from: 'Shielded Vault (Consolidated)',
            to: `${recipientKey.toBase58().slice(0, 8)}...${recipientKey.toBase58().slice(-4)}`,
            fee: '0.25',
            memo: `Consolidated ${notes.length} notes`,
            isShielded: true,
            walletAddress: keypair.publicKey.toBase58(),
          });
        } else {
          const res = await relayWithdraw({
            proof: withdrawProof,
            amount: pendingTransfer.targetAmount!.toString(),
            nullifier: finalConsolidatedNote.nullifier,
            recipient: recipientKey.toBase58(),
            recipientAta,
            mint: mintKey.toBase58(),
            collectFee: false, // Fee already collected if needed
          });
          console.log('[SequentialConsolidate] Withdrawal succeeded:', res.signature);
          
          // Record the transaction
          addTransaction({
            type: 'shield_withdraw',
            status: 'success',
            signature: res.signature,
            amount: String(Number(pendingTransfer.targetAmount!) / 1e9),
            token: 'SOL',
            from: 'Shielded Vault (Consolidated)',
            to: `${recipientKey.toBase58().slice(0, 8)}...${recipientKey.toBase58().slice(-4)}`,
            fee: '0.25',
            memo: `Consolidated ${notes.length} notes`,
            isShielded: true,
            walletAddress: keypair.publicKey.toBase58(),
          });
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
            tokenType,
            { signature: consolidateResult.signature }
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
              recipient: pendingTransfer.recipientKey!,
              recipientAta: pendingTransfer.recipientAta!,
              mint: nocMint.toBase58(),
              collectFee: true, // Collect 0.25 NOC from vault
            });
            console.log('[AutoConsolidate] Withdrawal succeeded:', res.signature);
            markNoteSpent(pendingTransfer.consolidatedNote.nullifier.toString());
            
            // Record the transaction
            addTransaction({
              type: 'shield_withdraw',
              status: 'success',
              signature: res.signature,
              amount: String(Number(pendingTransfer.atoms!) / 1e6),
              token: 'NOC',
              from: 'Shielded Vault (Auto-Consolidated)',
              to: `${pendingTransfer.recipientKey!.slice(0, 8)}...${pendingTransfer.recipientKey!.slice(-4)}`,
              fee: '0.25',
              memo: `Auto-consolidated ${pendingTransfer.allNotesUsed?.length} notes`,
              isShielded: true,
              walletAddress: keypair.publicKey.toBase58(),
            });
          } else {
            // SOL: collect NOC fee first, then withdraw SOL
            console.log('[AutoConsolidate] SOL withdrawal: collecting NOC fee first');
            
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
            
            // Look for an EXACT 0.25 NOC note
            let feeNoteAC = nocNotes.find(n => BigInt(n.amount) === PRIVACY_FEE_ATOMS);
            
            if (!feeNoteAC) {
              // No exact fee note - create one from a larger NOC note first
              console.log('[AutoConsolidate] No exact 0.25 NOC fee note found - creating one via split...');
              const splittableNote = nocNotes.find(n => BigInt(n.amount) > PRIVACY_FEE_ATOMS);
              
              if (!splittableNote) {
                throw new Error('Cannot create fee note: no NOC note larger than 0.25 NOC available.');
              }
              
              setStatus('Creating 0.25 NOC fee note from vault...');
              const allUnspent = useShieldedNotes.getState().notes.filter(
                n => n.owner === walletAddress && !n.spent
              );
              
              const splitInputNote: Note = {
                secret: BigInt(splittableNote.secret),
                amount: BigInt(splittableNote.amount),
                tokenMint: getCorrectTokenMint(splittableNote),
                blinding: BigInt(splittableNote.blinding),
                rho: BigInt(splittableNote.rho),
                commitment: BigInt(splittableNote.commitment),
                nullifier: BigInt(splittableNote.nullifier),
              };
              
              const splitMerkleProof = buildMerkleProof(allUnspent, splittableNote);
              const newFeeNote = createNoteFromSecrets(PRIVACY_FEE_ATOMS, 'NOC');
              const splitChangeAmount = BigInt(splittableNote.amount) - PRIVACY_FEE_ATOMS;
              const splitChangeNote = createNoteFromSecrets(splitChangeAmount, 'NOC');
              
              const splitWitness = serializeTransferWitness({
                inputNote: splitInputNote,
                merkleProof: splitMerkleProof,
                outputNote1: newFeeNote,
                outputNote2: splitChangeNote,
              });
              
              const splitProof = await proveCircuit('transfer', splitWitness);
              const splitResult = await relayTransfer({
                proof: splitProof,
                nullifier: splittableNote.nullifier,
                outputCommitment1: newFeeNote.commitment.toString(),
                outputCommitment2: splitChangeNote.commitment.toString(),
              });
              
              markNoteSpent(splittableNote.nullifier);
              const feeNoteRecord = snapshotNote(newFeeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
              const changeNoteRecord = snapshotNote(splitChangeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
              addShieldedNote(feeNoteRecord);
              addShieldedNote(changeNoteRecord);
              feeNoteAC = feeNoteRecord;
              await new Promise(r => setTimeout(r, 200));
            }
            
            // Collect the 0.25 NOC fee
            setStatus('Withdrawing privacy fee (0.25 NOC)...');
            const currentNotes = useShieldedNotes.getState().notes.filter(
              n => n.owner === walletAddress && !n.spent
            );
            const feeMerkleProof = buildMerkleProof(currentNotes, feeNoteAC);
            
            const feeInputNote: Note = {
              secret: BigInt(feeNoteAC.secret),
              amount: BigInt(feeNoteAC.amount),
              tokenMint: getCorrectTokenMint(feeNoteAC),
              blinding: BigInt(feeNoteAC.blinding),
              rho: BigInt(feeNoteAC.rho),
              commitment: BigInt(feeNoteAC.commitment),
              nullifier: BigInt(feeNoteAC.nullifier),
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
                amount: feeNoteAC.amount,
                nullifier: feeNoteAC.nullifier,
                recipient: feeCollectorOwner.toBase58(),
                recipientAta: feeCollectorAta.toBase58(),
                mint: nocMint.toBase58(),
                collectFee: false, // This IS the fee payment
              });
              console.log('[AutoConsolidate] ✅ Fee collected from vault:', feeRes.signature);
              markNoteSpent(feeNoteAC.nullifier);
            } catch (feeErr) {
              console.error('[AutoConsolidate] ❌ Fee collection failed:', feeErr);
              throw new Error('Failed to collect privacy fee from vault. Please retry.');
            }
            
            // Now withdraw SOL
            setStatus('Step 2/2: Withdrawing SOL from consolidated note...');
            const wsolMint = new PublicKey(WSOL_MINT);
            const res = await relayWithdraw({
              proof: pendingTransfer.withdrawProof,
              amount: pendingTransfer.atoms!.toString(),
              nullifier: pendingTransfer.consolidatedNote.nullifier.toString(),
              recipient: pendingTransfer.recipientKey!,
              recipientAta: pendingTransfer.recipientAta!,
              mint: wsolMint.toBase58(),
              collectFee: false, // Fee already collected above
            });
            console.log('[AutoConsolidate] SOL withdrawal succeeded:', res.signature);
            markNoteSpent(pendingTransfer.consolidatedNote.nullifier.toString());
            
            // Record the transaction
            addTransaction({
              type: 'shield_withdraw',
              status: 'success',
              signature: res.signature,
              amount: String(Number(pendingTransfer.atoms!) / 1e9),
              token: 'SOL',
              from: 'Shielded Vault (Auto-Consolidated)',
              to: `${pendingTransfer.recipientKey!.slice(0, 8)}...${pendingTransfer.recipientKey!.slice(-4)}`,
              fee: '0.25',
              memo: `Auto-consolidated ${pendingTransfer.allNotesUsed?.length} notes`,
              isShielded: true,
              walletAddress: keypair.publicKey.toBase58(),
            });
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
        const tokenType = transferReview?.tokenType || 'NOC';
        const changeNoteRecord = snapshotNote(
          pendingTransfer.changeNote,
          keypair.publicKey,
          tokenType,
          { signature: splitSig }
        );
        addShieldedNote(changeNoteRecord);
        
        // Always withdraw to recipient's wallet when using a Solana address
        // (True shielded-to-shielded transfers require noctura1... address)
        console.log('[Transfer] Step 2/2: Withdrawing to recipient wallet...');
        try {
          // Withdraw the recipient note to their transparent wallet
          // First, create a record for the recipient note (temporarily, for merkle proof)
          const recipientNoteRecord = snapshotNote(
              pendingTransfer.recipientNote,
              keypair.publicKey, // We generated it, so we can spend it
              tokenType,
              { signature: splitSig }
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
            // For SPL token operations, use WSOL_MINT for SOL, NOC_TOKEN_MINT for NOC
            const ataMintKeyPartial = new PublicKey(tokenType === 'SOL' ? WSOL_MINT : NOC_TOKEN_MINT);
            const recipientAta = pendingTransfer.recipientAta || getAssociatedTokenAddressSync(ataMintKeyPartial, recipientPubkeyPartial, true).toBase58();
            
            console.log('[Transfer] Calling relayWithdraw for recipient:', pendingTransfer.recipientKey!.slice(0, 8));
            console.log('[Transfer] Withdrawal params:', {
              tokenType,
              mint: ataMintKeyPartial.toBase58(),
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
                  recipient: pendingTransfer.recipientKey!,
                  recipientAta,
                  mint: ataMintKeyPartial.toBase58(),
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
              
              // Record the withdrawal in transaction history
              addTransaction({
                type: 'shield_withdraw',
                status: 'success',
                signature: withdrawSig,
                amount: String(Number(pendingTransfer.atoms!) / 1e6),
                token: 'NOC',
                from: 'Shielded Vault',
                to: `${pendingTransfer.recipientKey!.slice(0, 8)}...${pendingTransfer.recipientKey!.slice(-4)}`,
                fee: '0.25',
                isShielded: true,
                walletAddress: keypair.publicKey.toBase58(),
              });
              
              // Show shielded success modal
              setShieldedTxSuccess({
                signature: withdrawSig,
                amount: `${Number(pendingTransfer.atoms!) / 1e6} NOC`,
                recipient: pendingTransfer.recipientKey!,
                token: 'NOC',
                isFullPrivacy: false,
              });
              
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
              
              // Look for an EXACT 0.25 NOC note (withdraw circuit requires full amount)
              let feeNote = nocNotes.find(n => BigInt(n.amount) === PRIVACY_FEE_ATOMS);
              
              if (!feeNote) {
                // No exact fee note - create one from a larger NOC note first (NEVER waste NOC!)
                console.log('[Transfer] No exact 0.25 NOC fee note found - creating one via split...');
                console.log('[Transfer] Available NOC notes:', nocNotes.map(n => ({ 
                  amount: Number(BigInt(n.amount)) / 1e6,
                  nullifier: n.nullifier.slice(0, 10),
                })));
                
                // Find a NOC note large enough to split
                const splittableNote = nocNotes.find(n => BigInt(n.amount) > PRIVACY_FEE_ATOMS);
                
                if (!splittableNote) {
                  throw new Error('Cannot create fee note: no NOC note larger than 0.25 NOC available.');
                }
                
                console.log('[Transfer] Splitting note:', Number(BigInt(splittableNote.amount)) / 1e6, 'NOC');
                
                // Create fee note via self-transfer (split the note)
                const allUnspent = useShieldedNotes.getState().notes.filter(
                  n => n.owner === walletAddress && !n.spent
                );
                
                const splitInputNote: Note = {
                  secret: BigInt(splittableNote.secret),
                  amount: BigInt(splittableNote.amount),
                  tokenMint: getCorrectTokenMint(splittableNote),
                  blinding: BigInt(splittableNote.blinding),
                  rho: BigInt(splittableNote.rho),
                  commitment: BigInt(splittableNote.commitment),
                  nullifier: BigInt(splittableNote.nullifier),
                };
                
                const splitMerkleProof = buildMerkleProof(allUnspent, splittableNote);
                
                // Create fee note (0.25 NOC) + change note (rest)
                const newFeeNote = createNoteFromSecrets(PRIVACY_FEE_ATOMS, 'NOC');
                const splitChangeAmount = BigInt(splittableNote.amount) - PRIVACY_FEE_ATOMS;
                const splitChangeNote = createNoteFromSecrets(splitChangeAmount, 'NOC');
                
                const splitWitness = serializeTransferWitness({
                  inputNote: splitInputNote,
                  merkleProof: splitMerkleProof,
                  outputNote1: newFeeNote,
                  outputNote2: splitChangeNote,
                });
                
                console.log('[Transfer] Generating proof to split note for fee...');
                const splitProof = await proveCircuit('transfer', splitWitness);
                
                const splitResult = await relayTransfer({
                  proof: splitProof,
                  nullifier: splittableNote.nullifier,
                  outputCommitment1: newFeeNote.commitment.toString(),
                  outputCommitment2: splitChangeNote.commitment.toString(),
                });
                
                console.log('[Transfer] ✅ Created exact 0.25 NOC fee note:', splitResult.signature);
                
                // Mark old note as spent and save new notes
                markNoteSpent(splittableNote.nullifier);
                
                const feeNoteRecord = snapshotNote(newFeeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
                const changeNoteRecord = snapshotNote(splitChangeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
                addShieldedNote(feeNoteRecord);
                addShieldedNote(changeNoteRecord);
                
                // Use the newly created fee note
                feeNote = feeNoteRecord;
                
                // Small delay to let state update
                await new Promise(r => setTimeout(r, 200));
              }
              
              // Now we have an exact 0.25 NOC fee note - use it
              console.log('[Transfer] Using exact 0.25 NOC fee note for withdrawal');
              
              // Refresh note list to include newly split notes
              const currentNotes = useShieldedNotes.getState().notes.filter(
                n => n.owner === walletAddress && !n.spent
              );
              const feeMerkleProof = buildMerkleProof(currentNotes, feeNote);
              
              const feeInputNote: Note = {
                secret: BigInt(feeNote.secret),
                amount: BigInt(feeNote.amount),
                tokenMint: getCorrectTokenMint(feeNote),
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
                // Withdraw the full note amount to fee collector (withdraw circuit requires full amount)
                const feeRes = await relayWithdraw({
                  proof: feeProof,
                  amount: feeNote.amount, // Must be full note amount for withdraw circuit
                  nullifier: feeNote.nullifier,
                  recipient: feeCollectorOwner.toBase58(),
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
              
              // Step 2: Now withdraw SOL - need to regenerate proof since merkle tree may have changed
              console.log('[Transfer] SOL withdrawal: Step 2 - Regenerating withdrawal proof with updated merkle tree...');
              setStatus('Generating SOL withdrawal proof...');
              
              // Get fresh note list after fee collection (merkle tree may have changed)
              const freshNotesForWithdraw = useShieldedNotes.getState().notes.filter(
                n => n.owner === walletAddress && !n.spent
              );
              // Add the recipient note that was created in Step 1
              const recipientNoteRecordSol = snapshotNote(
                pendingTransfer.recipientNote,
                keypair.publicKey,
                'SOL',
                { signature: splitSig }
              );
              const allNotesForWithdraw = [...freshNotesForWithdraw, recipientNoteRecordSol];
              console.log('[Transfer] Building fresh merkle proof with', allNotesForWithdraw.length, 'notes');
              
              const solWithdrawMerkleProof = buildMerkleProof(allNotesForWithdraw, recipientNoteRecordSol);
              
              const solWithdrawWitness = serializeWithdrawWitness({
                inputNote: pendingTransfer.recipientNote,
                merkleProof: solWithdrawMerkleProof,
                receiver: pubkeyToField(new PublicKey(pendingTransfer.recipientKey!)),
              });
              
              console.log('[Transfer] Generating SOL withdrawal proof...');
              const solWithdrawProof = await proveCircuit('withdraw', solWithdrawWitness);
              console.log('[Transfer] ✅ SOL withdrawal proof generated');
              
              setStatus('Withdrawing SOL to recipient...');
              let withdrawSig: string;
              try {
                const wsolMint = new PublicKey(WSOL_MINT);
                const res = await relayWithdraw({
                  proof: solWithdrawProof,
                  amount: pendingTransfer.atoms!.toString(),
                  nullifier: pendingTransfer.recipientNote.nullifier.toString(),
                  recipient: pendingTransfer.recipientKey!,
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
              
              // Record the withdrawal in transaction history
              addTransaction({
                type: 'shield_withdraw',
                status: 'success',
                signature: withdrawSig,
                amount: String(Number(pendingTransfer.atoms!) / 1e9),
                token: 'SOL',
                from: 'Shielded Vault',
                to: `${pendingTransfer.recipientKey!.slice(0, 8)}...${pendingTransfer.recipientKey!.slice(-4)}`,
                fee: '0.25',
                isShielded: true,
                walletAddress: keypair.publicKey.toBase58(),
              });
              
              // Show shielded success modal
              setShieldedTxSuccess({
                signature: withdrawSig,
                amount: `${Number(pendingTransfer.atoms!) / 1e9} SOL`,
                recipient: pendingTransfer.recipientKey!,
                token: 'SOL',
                isFullPrivacy: false,
              });
              
              setTransferReview(null);
              resetPendingShieldedTransfer();
              await refreshBalances();
            }
        } catch (withdrawErr) {
          console.error('[Transfer] ❌ Step 2 (withdrawal) failed:', withdrawErr);
          setStatus(`Split succeeded but withdrawal failed: ${(withdrawErr as Error).message}. Please retry - funds are still in vault.`);
          // Keep modal open so user can retry
        }
      } else {
        // Full withdrawal via PROGRAM (vault-sourced). For SOL we still use relayer; for NOC we withdraw directly from vault.
        // Note: Always withdraw to transparent wallet when using a Solana address.
        // True shielded-to-shielded transfers would require a noctura1... address (not yet implemented).
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
                recipient: pendingRecipient!,
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
            
            // Record the transaction
            addTransaction({
              type: 'shield_withdraw',
              status: 'success',
              signature,
              amount: String(transferReview.amount),
              token: 'NOC',
              from: 'Shielded Vault',
              to: `${pendingRecipient!.slice(0, 8)}...${pendingRecipient!.slice(-4)}`,
              fee: '0.25',
              isShielded: true,
              walletAddress: keypair.publicKey.toBase58(),
            });
            
            // Show shielded success modal
            setShieldedTxSuccess({
              signature,
              amount: `${transferReview.amount} NOC`,
              recipient: pendingRecipient!,
              token: 'NOC',
              isFullPrivacy: false,
            });
            
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
            
            // Look for an EXACT 0.25 NOC note (withdraw circuit requires full amount)
            let feeNote2 = nocNotes.find(n => BigInt(n.amount) === PRIVACY_FEE_ATOMS);
            
            if (!feeNote2) {
              // No exact fee note - create one from a larger NOC note first (NEVER waste NOC!)
              console.log('[Transfer] No exact 0.25 NOC fee note found - creating one via split...');
              console.log('[Transfer] Available NOC notes:', nocNotes.map(n => ({ 
                amount: Number(BigInt(n.amount)) / 1e6,
                nullifier: n.nullifier.slice(0, 10),
              })));
              
              // Find a NOC note large enough to split
              const splittableNote = nocNotes.find(n => BigInt(n.amount) > PRIVACY_FEE_ATOMS);
              
              if (!splittableNote) {
                throw new Error('Cannot create fee note: no NOC note larger than 0.25 NOC available.');
              }
              
              console.log('[Transfer] Splitting note:', Number(BigInt(splittableNote.amount)) / 1e6, 'NOC');
              setStatus('Creating 0.25 NOC fee note from vault...');
              
              // Create fee note via self-transfer (split the note)
              const allUnspent = useShieldedNotes.getState().notes.filter(
                n => n.owner === walletAddress && !n.spent
              );
              
              const splitInputNote: Note = {
                secret: BigInt(splittableNote.secret),
                amount: BigInt(splittableNote.amount),
                tokenMint: getCorrectTokenMint(splittableNote),
                blinding: BigInt(splittableNote.blinding),
                rho: BigInt(splittableNote.rho),
                commitment: BigInt(splittableNote.commitment),
                nullifier: BigInt(splittableNote.nullifier),
              };
              
              const splitMerkleProof = buildMerkleProof(allUnspent, splittableNote);
              
              // Create fee note (0.25 NOC) + change note (rest)
              const newFeeNote = createNoteFromSecrets(PRIVACY_FEE_ATOMS, 'NOC');
              const splitChangeAmount = BigInt(splittableNote.amount) - PRIVACY_FEE_ATOMS;
              const splitChangeNote = createNoteFromSecrets(splitChangeAmount, 'NOC');
              
              const splitWitness = serializeTransferWitness({
                inputNote: splitInputNote,
                merkleProof: splitMerkleProof,
                outputNote1: newFeeNote,
                outputNote2: splitChangeNote,
              });
              
              console.log('[Transfer] Generating proof to split note for fee...');
              const splitProof = await proveCircuit('transfer', splitWitness);
              
              const splitResult = await relayTransfer({
                proof: splitProof,
                nullifier: splittableNote.nullifier,
                outputCommitment1: newFeeNote.commitment.toString(),
                outputCommitment2: splitChangeNote.commitment.toString(),
              });
              
              console.log('[Transfer] ✅ Created exact 0.25 NOC fee note:', splitResult.signature);
              
              // Mark old note as spent and save new notes
              markNoteSpent(splittableNote.nullifier);
              
              const feeNoteRecord = snapshotNote(newFeeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
              const changeNoteRecord = snapshotNote(splitChangeNote, keypair.publicKey, 'NOC', { signature: splitResult.signature });
              addShieldedNote(feeNoteRecord);
              addShieldedNote(changeNoteRecord);
              
              // Use the newly created fee note
              feeNote2 = feeNoteRecord;
              
              // Small delay to let state update
              await new Promise(r => setTimeout(r, 200));
            }
            
            // Now we have an exact 0.25 NOC fee note - use it
            console.log('[Transfer] Using exact 0.25 NOC fee note for withdrawal');
            setStatus('Withdrawing privacy fee (0.25 NOC)...');
            
            // Refresh note list to include newly split notes
            const currentNotes2 = useShieldedNotes.getState().notes.filter(
              n => n.owner === walletAddress && !n.spent
            );
            const feeMerkleProof = buildMerkleProof(currentNotes2, feeNote2);
            
            const feeInputNote: Note = {
              secret: BigInt(feeNote2.secret),
              amount: BigInt(feeNote2.amount),
              tokenMint: getCorrectTokenMint(feeNote2),
              blinding: BigInt(feeNote2.blinding),
              rho: BigInt(feeNote2.rho),
              commitment: BigInt(feeNote2.commitment),
              nullifier: BigInt(feeNote2.nullifier),
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
              // Withdraw the exact 0.25 NOC to fee collector
              const feeRes = await relayWithdraw({
                proof: feeProof,
                amount: feeNote2.amount, // Now exactly 0.25 NOC (250000 atoms)
                nullifier: feeNote2.nullifier,
                recipient: feeCollectorOwner.toBase58(),
                recipientAta: feeCollectorAta.toBase58(),
                mint: nocMint.toBase58(),
                collectFee: false, // This IS the fee payment
              });
              console.log('[Transfer] ✅ Fee collected from vault:', feeRes.signature);
              markNoteSpent(feeNote2.nullifier);
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
                recipient: pendingRecipient!,
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
            
            // Record the transaction
            addTransaction({
              type: 'shield_withdraw',
              status: 'success',
              signature,
              amount: String(transferReview.amount),
              token: 'SOL',
              from: 'Shielded Vault',
              to: `${pendingRecipient!.slice(0, 8)}...${pendingRecipient!.slice(-4)}`,
              fee: '0.25',
              isShielded: true,
              walletAddress: keypair.publicKey.toBase58(),
            });
            
            // Show shielded success modal
            setShieldedTxSuccess({
              signature,
              amount: `${transferReview.amount} SOL`,
              recipient: pendingRecipient!,
              token: 'SOL',
              isFullPrivacy: false,
            });
            
            setTransferReview(null);
            resetPendingShieldedTransfer();
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
        // For other errors, show the message and close the modal
        setStatus(`❌ ${errMsg}`);
        setTransferReview(null);
        resetPendingShieldedTransfer();
      }
    } finally {
      setConfirmingTransfer(false);
    }
  }, [
    keypair,
    transferReview,
    pendingWithdrawalProof,
    pendingWithdrawalNote,
    pendingRecipient,
    pendingRecipientAta,
    shieldedNotes,
    shieldedKeys,
    markNoteSpent,
    addShieldedNote,
    addTransaction,
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
        
        // For actual mint in transactions: null for native SOL, NOC_TOKEN_MINT for NOC
        const txMint = tokenType === 'SOL' ? null : new PublicKey(NOC_TOKEN_MINT);
        
        setStatus('Generating deposit proof…');
        console.log('[performShieldedDeposit] Preparing deposit:', {
          tokenType,
          txMint: txMint?.toBase58() || 'NATIVE_SOL',
          amountAtoms: amountAtoms.toString(),
        });
        // prepareDeposit now takes tokenType directly (SOL uses 1n, NOC uses hash of mint)
        const prepared = prepareDeposit(amountAtoms, tokenType);
        console.log('[performShieldedDeposit] Deposit prepared:', {
          noteAmount: prepared.note.amount.toString(),
          noteCommitment: prepared.note.commitment.toString(),
          tokenMintField: prepared.note.tokenMint.toString(),
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
          tokenMintField: prepared.note.tokenMint.toString(),
          txMint: txMint?.toBase58() || 'NATIVE_SOL',
        });
        
        setStatus('Submitting shielded deposit…');
        console.log('[performShieldedDeposit] Calling submitShieldedDeposit...');
        const { signature, leafIndex } = await submitShieldedDeposit({
          keypair,
          prepared,
          proof,
          mint: txMint || undefined, // Pass undefined for native SOL transactions
          tokenType,
        });
        console.log('[performShieldedDeposit] Deposit submitted successfully:', {
          signature,
          leafIndex,
          tokenType,
          noteAmount: prepared.note.amount.toString(),
          displayAmount,
        });
        
        // snapshotNote now takes tokenType directly
        const noteToAdd = snapshotNote(prepared.note, keypair.publicKey, tokenType, {
          leafIndex,
          signature,
        });
        console.log('[performShieldedDeposit] ADDING NOTE TO STORE:', {
          nullifier: noteToAdd.nullifier.slice(0, 8),
          amount: noteToAdd.amount,
          displayAmount,
          tokenType: noteToAdd.tokenType,
          tokenMintField: noteToAdd.tokenMintField,
          tokenMintAddress: noteToAdd.tokenMintAddress,
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

  /**
   * Creates 0.25 NOC fee notes from a larger NOC note via self-transfer.
   * This ensures users always have fee notes ready for shielded-to-shielded transfers.
   * 
   * @param sourceNote - The note to split (must be NOC and > 0.25)
   * @param numFeeNotes - How many 0.25 NOC fee notes to create (default: 4)
   * @returns Array of created fee note nullifiers
   */
  const createFeeNotes = useCallback(async (sourceNote: ShieldedNoteRecord, numFeeNotes: number = 4): Promise<string[]> => {
    if (!keypair) throw new Error('Wallet not ready');
    
    const walletAddress = keypair.publicKey.toBase58();
    const sourceAmount = BigInt(sourceNote.amount);
    const neededAmount = PRIVACY_FEE_ATOMS * BigInt(numFeeNotes);
    
    if (sourceAmount < neededAmount) {
      console.log(`[FeeNotes] Source note (${Number(sourceAmount) / 1e6} NOC) too small for ${numFeeNotes} fee notes`);
      numFeeNotes = Math.floor(Number(sourceAmount / PRIVACY_FEE_ATOMS));
      if (numFeeNotes === 0) {
        console.log('[FeeNotes] Cannot create any fee notes - source too small');
        return [];
      }
    }
    
    console.log(`[FeeNotes] Creating ${numFeeNotes} fee notes (${numFeeNotes * 0.25} NOC) from ${Number(sourceAmount) / 1e6} NOC note`);
    
    const createdNullifiers: string[] = [];
    let currentNote = sourceNote;
    let currentAmount = sourceAmount;
    
    for (let i = 0; i < numFeeNotes && currentAmount > PRIVACY_FEE_ATOMS; i++) {
      setStatus(`Creating fee note ${i + 1}/${numFeeNotes}...`);
      
      // Get fresh list of unspent notes for merkle proof
      const allUnspent = useShieldedNotes.getState().notes.filter(
        n => n.owner === walletAddress && !n.spent
      );
      
      const inputNote: Note = {
        secret: BigInt(currentNote.secret),
        amount: currentAmount,
        tokenMint: getCorrectTokenMint(currentNote),
        blinding: BigInt(currentNote.blinding),
        rho: BigInt(currentNote.rho),
        commitment: BigInt(currentNote.commitment),
        nullifier: BigInt(currentNote.nullifier),
      };
      
      const merkleProof = buildMerkleProof(allUnspent, currentNote);
      
      // Create fee note (0.25 NOC) + change note (rest)
      const feeNote = createNoteFromSecrets(PRIVACY_FEE_ATOMS, 'NOC');
      const changeAmount = currentAmount - PRIVACY_FEE_ATOMS;
      const changeNote = createNoteFromSecrets(changeAmount, 'NOC');
      
      const witness = serializeTransferWitness({
        inputNote,
        merkleProof,
        outputNote1: feeNote,
        outputNote2: changeNote,
      });
      
      console.log(`[FeeNotes] Generating proof for split ${i + 1}...`);
      const proof = await proveCircuit('transfer', witness);
      
      const result = await relayTransfer({
        proof,
        nullifier: currentNote.nullifier,
        outputCommitment1: feeNote.commitment.toString(),
        outputCommitment2: changeNote.commitment.toString(),
      });
      
      console.log(`[FeeNotes] Split ${i + 1} complete:`, result.signature);
      
      // Mark old note as spent
      markNoteSpent(currentNote.nullifier);
      
      // Save both new notes
      const feeRecord = snapshotNote(feeNote, keypair.publicKey, 'NOC', { signature: result.signature });
      const changeRecord = snapshotNote(changeNote, keypair.publicKey, 'NOC', { signature: result.signature });
      addShieldedNote(feeRecord);
      addShieldedNote(changeRecord);
      
      createdNullifiers.push(feeRecord.nullifier);
      
      // Use change note as source for next iteration
      currentNote = changeRecord;
      currentAmount = changeAmount;
      
      // Small delay to let state update
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`[FeeNotes] ✅ Created ${createdNullifiers.length} fee notes`);
    return createdNullifiers;
  }, [keypair, markNoteSpent, addShieldedNote]);

  /**
   * Ensures the wallet has at least `minFeeNotes` number of 0.25 NOC fee notes.
   * If not enough exist, creates them from the largest available NOC note.
   */
  const ensureFeeNotes = useCallback(async (minFeeNotes: number = 4): Promise<void> => {
    if (!keypair) return;
    
    const walletAddress = keypair.publicKey.toBase58();
    const nocNotes = useShieldedNotes.getState().notes.filter(
      n => !n.spent && 
           n.owner === walletAddress && 
           (n.tokenType === 'NOC' || n.tokenMintAddress === NOC_TOKEN_MINT)
    );
    
    // Count existing exact fee notes
    const existingFeeNotes = nocNotes.filter(n => BigInt(n.amount) === PRIVACY_FEE_ATOMS);
    console.log(`[FeeNotes] Have ${existingFeeNotes.length} fee notes, need ${minFeeNotes}`);
    
    if (existingFeeNotes.length >= minFeeNotes) {
      console.log('[FeeNotes] Sufficient fee notes available');
      return;
    }
    
    const needed = minFeeNotes - existingFeeNotes.length;
    
    // Find largest NOC note that can be split
    const splittableNotes = nocNotes
      .filter(n => BigInt(n.amount) > PRIVACY_FEE_ATOMS)
      .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount))); // Largest first
    
    if (splittableNotes.length === 0) {
      console.log('[FeeNotes] No NOC notes available to split');
      return;
    }
    
    const sourceNote = splittableNotes[0];
    console.log(`[FeeNotes] Will create ${needed} fee notes from ${Number(BigInt(sourceNote.amount)) / 1e6} NOC note`);
    
    await createFeeNotes(sourceNote, needed);
  }, [keypair, createFeeNotes]);

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
          
          // Record the transaction
          addTransaction({
            type: 'public_send',
            status: 'success',
            signature,
            amount: txConfirmation.amount,
            token: 'SOL',
            from: 'Transparent Balance',
            to: `${target.toBase58().slice(0, 8)}...${target.toBase58().slice(-4)}`,
            isShielded: false,
            walletAddress: keypair.publicKey.toBase58(),
          });
          
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
          
          // Record the transaction
          addTransaction({
            type: 'public_send',
            status: 'success',
            signature,
            amount: txConfirmation.amount,
            token: 'NOC',
            from: 'Transparent Balance',
            to: `${target.toBase58().slice(0, 8)}...${target.toBase58().slice(-4)}`,
            isShielded: false,
            walletAddress: keypair.publicKey.toBase58(),
          });
          
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
            
            // Record the transaction
            addTransaction({
              type: 'shield_deposit',
              status: 'success',
              signature,
              amount: txConfirmation.amount,
              token: 'SOL',
              from: 'Transparent Balance',
              to: 'Shielded Vault',
              fee: '0.25',
              isShielded: true,
              walletAddress: keypair.publicKey.toBase58(),
            });
            
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
            
            // Record the transaction
            addTransaction({
              type: 'shield_deposit',
              status: 'success',
              signature,
              amount: txConfirmation.amount,
              token: 'NOC',
              from: 'Transparent Balance',
              to: 'Shielded Vault',
              fee: '0.25',
              isShielded: true,
              walletAddress: keypair.publicKey.toBase58(),
            });
            
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
            
            // Auto-create fee notes in background after NOC deposit
            // This ensures user has 0.25 NOC notes ready for shielded transfers
            setTimeout(() => {
              console.log('[executeConfirmedTransaction] Creating fee notes in background...');
              ensureFeeNotes(4).catch(err => {
                console.warn('[executeConfirmedTransaction] Fee note creation failed (non-critical):', err);
              });
            }, 500);
            
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
  }, [keypair, txConfirmation, refreshBalances, performShieldedDeposit, ensureFeeNotes, addTransaction]);

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

  // Track signatures we've already processed to avoid duplicate transaction records
  const processedSignaturesRef = useRef<Set<string>>(new Set());

  const fetchTransactions = useCallback(async () => {
    if (!keypair) return [];
    const walletAddress = keypair.publicKey.toBase58();
    
    try {
      const { connection } = await import('./lib/solana');
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
      
      // Fetch on-chain transactions for main wallet
      const mainWalletSigs = await connection.getSignaturesForAddress(
        keypair.publicKey,
        { limit: 20 },
        'confirmed'
      );
      
      // Also fetch transactions for NOC token account (ATA) to catch incoming token transfers
      let tokenAccountSigs: typeof mainWalletSigs = [];
      let nocAtaAddress: string | null = null;
      try {
        const nocMint = new PublicKey(NOC_TOKEN_MINT);
        const nocAta = getAssociatedTokenAddressSync(nocMint, keypair.publicKey, false);
        nocAtaAddress = nocAta.toBase58();
        tokenAccountSigs = await connection.getSignaturesForAddress(
          nocAta,
          { limit: 15 },
          'confirmed'
        );
      } catch (ataErr) {
        // ATA might not exist yet, ignore
        console.log('[fetchTransactions] Could not fetch ATA transactions:', ataErr);
      }
      
      // Combine and deduplicate signatures
      const seenSigs = new Set<string>();
      const allSignatures = [...mainWalletSigs, ...tokenAccountSigs].filter(sig => {
        if (seenSigs.has(sig.signature)) return false;
        seenSigs.add(sig.signature);
        return true;
      });
      
      // Parse transactions to detect incoming transfers and record them
      // Only process signatures we haven't seen before
      const newSignatures = allSignatures.filter(sig => !processedSignaturesRef.current.has(sig.signature));
      
      if (newSignatures.length > 0) {
        // Fetch parsed transactions for new signatures to detect incoming transfers
        for (const sigInfo of newSignatures.slice(0, 10)) { // Limit to 10 to avoid rate limits
          try {
            const tx = await connection.getParsedTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0,
            });
            
            if (!tx || sigInfo.err) continue;
            
            // Skip if already in our transaction history
            const existingTx = getWalletTransactions(walletAddress).find(t => t.signature === sigInfo.signature);
            if (existingTx) {
              processedSignaturesRef.current.add(sigInfo.signature);
              continue;
            }
            
            // Analyze the transaction to detect incoming transfers
            const preBalances = tx.meta?.preBalances || [];
            const postBalances = tx.meta?.postBalances || [];
            const accountKeys = tx.transaction.message.accountKeys.map(k => 
              typeof k === 'string' ? k : k.pubkey.toBase58()
            );
            
            const walletIndex = accountKeys.indexOf(walletAddress);
            const nocAtaIndex = nocAtaAddress ? accountKeys.indexOf(nocAtaAddress) : -1;
            
            // Check for SOL received (native transfer)
            if (walletIndex >= 0 && preBalances[walletIndex] !== undefined && postBalances[walletIndex] !== undefined) {
              const solDiff = postBalances[walletIndex] - preBalances[walletIndex];
              
              // If we received SOL and we're not the fee payer (index 0), it's an incoming transfer
              if (solDiff > 0 && walletIndex !== 0) {
                const amountSol = solDiff / 1e9;
                console.log('[fetchTransactions] Detected incoming SOL transfer:', amountSol, 'SOL');
                
                // Find the sender (account that decreased in SOL)
                let sender = 'Unknown';
                for (let i = 0; i < preBalances.length; i++) {
                  if (i !== walletIndex && postBalances[i] < preBalances[i]) {
                    sender = accountKeys[i].slice(0, 8) + '...' + accountKeys[i].slice(-4);
                    break;
                  }
                }
                
                addTransaction({
                  type: 'public_receive',
                  status: 'success',
                  signature: sigInfo.signature,
                  amount: amountSol.toFixed(6),
                  token: 'SOL',
                  from: sender,
                  to: 'Transparent Wallet',
                  isShielded: false,
                  walletAddress,
                });
              }
            }
            
            // Check for NOC token received
            const preTokenBalances = tx.meta?.preTokenBalances || [];
            const postTokenBalances = tx.meta?.postTokenBalances || [];
            
            const preNocBalance = preTokenBalances.find(b => b.owner === walletAddress && b.mint === NOC_TOKEN_MINT);
            const postNocBalance = postTokenBalances.find(b => b.owner === walletAddress && b.mint === NOC_TOKEN_MINT);
            
            if (postNocBalance) {
              // Use uiAmount if available, otherwise calculate from raw amount
              const getUiAmount = (balance: any): number => {
                if (balance?.uiTokenAmount?.uiAmount != null) {
                  return balance.uiTokenAmount.uiAmount;
                }
                if (balance?.uiTokenAmount?.amount && balance?.uiTokenAmount?.decimals != null) {
                  return Number(balance.uiTokenAmount.amount) / Math.pow(10, balance.uiTokenAmount.decimals);
                }
                return 0;
              };
              
              const preAmount = getUiAmount(preNocBalance);
              const postAmount = getUiAmount(postNocBalance);
              const nocDiff = postAmount - preAmount;
              
              if (nocDiff > 0) {
                console.log('[fetchTransactions] Detected incoming NOC transfer:', nocDiff, 'NOC (preAmount:', preAmount, 'postAmount:', postAmount, ')');
                
                // Find the sender
                let sender = 'Unknown';
                for (const preBalance of preTokenBalances) {
                  const preOwner = preBalance.owner;
                  if (preBalance.mint === NOC_TOKEN_MINT && preOwner && preOwner !== walletAddress) {
                    const postBalance = postTokenBalances.find(b => b.owner === preOwner && b.mint === NOC_TOKEN_MINT);
                    if (postBalance && (preBalance.uiTokenAmount.uiAmount || 0) > (postBalance.uiTokenAmount.uiAmount || 0)) {
                      sender = preOwner.slice(0, 8) + '...' + preOwner.slice(-4);
                      break;
                    }
                  }
                }
                
                addTransaction({
                  type: 'public_receive',
                  status: 'success',
                  signature: sigInfo.signature,
                  amount: nocDiff.toFixed(6),
                  token: 'NOC',
                  from: sender,
                  to: 'Transparent Wallet',
                  isShielded: false,
                  walletAddress,
                });
              }
            }
            
            processedSignaturesRef.current.add(sigInfo.signature);
          } catch (parseErr) {
            // Skip transactions that fail to parse
            console.log('[fetchTransactions] Could not parse transaction:', sigInfo.signature.slice(0, 16));
          }
        }
      }
      
      // Convert on-chain transactions to our format
      const onChainTxs = allSignatures.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
        timestamp: sig.blockTime ?? 0,
        err: sig.err,
        memo: sig.memo ?? undefined,
        type: 'public' as const,
        isShielded: false,
      }));
      
      // Get shielded transaction history from our store
      const shieldedTxs = getWalletTransactions(walletAddress);
      console.log('[fetchTransactions] Transaction store has', shieldedTxs.length, 'transactions for this wallet');
      console.log('[fetchTransactions] Transaction types:', shieldedTxs.map(tx => tx.type));
      
      // Convert shielded transactions to display format
      const shieldedForDisplay = shieldedTxs.map((tx) => {
        const displayInfo = getTransactionDisplayInfo(tx.type);
        return {
          signature: tx.signature || tx.id,
          slot: 0,
          timestamp: Math.floor(tx.timestamp / 1000), // Convert to seconds
          err: tx.status === 'failed' ? { message: 'Transaction failed' } : null,
          memo: `${displayInfo.icon} ${displayInfo.label}: ${tx.amount} ${tx.token}`,
          type: tx.type,
          isShielded: tx.isShielded,
        };
      });
      
      // Merge and deduplicate (prefer shielded record if signature matches)
      const shieldedSignatures = new Set(shieldedForDisplay.map(tx => tx.signature).filter(Boolean));
      const filteredOnChain = onChainTxs.filter(tx => !shieldedSignatures.has(tx.signature));
      
      console.log('[fetchTransactions] Combining', shieldedForDisplay.length, 'store transactions with', filteredOnChain.length, 'on-chain transactions');
      
      // Combine and sort by timestamp (newest first)
      const combined = [...shieldedForDisplay, ...filteredOnChain]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 30); // Keep top 30
      
      return combined;
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      return [];
    }
  }, [keypair, getWalletTransactions, addTransaction]);

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
    const isFullPrivacy = transferReview.isFullyPrivate || transferReview.recipient.startsWith('noctura1');
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4">
          {/* Status message display */}
          {status && (
            <div className={`p-3 rounded-lg text-sm ${status.includes('❌') ? 'bg-red-500/20 text-red-300' : status.includes('✅') ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'}`}>
              {status}
            </div>
          )}
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
              {isFullPrivacy ? '🔐 Fully Private Transfer' : '⚠️ Partial Privacy Transfer'}
            </p>
            <h2 className="text-2xl font-semibold mt-2">Send {transferReview.amount} {tokenSymbol}</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">From</span>
              <span className="font-mono text-xs text-right">Shielded vault (your identity hidden)</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400">To</span>
              <span className="font-mono text-xs text-right break-all">
                {isFullPrivacy 
                  ? `${transferReview.recipient.slice(0, 12)}...${transferReview.recipient.slice(-8)} (encrypted)`
                  : `${transferReview.recipient.slice(0, 8)}...${transferReview.recipient.slice(-6)}`
                }
              </span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2 items-center">
              <span className="text-neutral-400">Amount</span>
              <span className="text-sm">{transferReview.amount} {tokenSymbol} {isFullPrivacy ? '(hidden)' : '(visible)'}</span>
            </div>
            {transferReview.isPartialSpend && transferReview.changeAmount !== undefined && transferReview.changeAmount > 0 && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-neutral-400">Change (stays shielded)</span>
                <span>{transferReview.changeAmount.toFixed(4)} {tokenSymbol}</span>
              </div>
            )}
            <div className="pt-2">
              <FeeBreakdown nocFee={nocFee} solFee={estimatedSolFee} relayerPaysGas={isFullPrivacy} />
            </div>
          </div>
          {isFullPrivacy ? (
            <p className="text-xs text-green-400">
              🔐 FULL PRIVACY: Sender, recipient, AND amount are all hidden on-chain. Only encrypted data is stored. The recipient will auto-discover this payment.
            </p>
          ) : (
            <p className="text-xs text-yellow-400">
              ⚠️ PARTIAL PRIVACY: Your identity is hidden, but recipient address and amount will be visible on-chain. For full privacy, ask recipient to share their noctura1... address.
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <button className="px-4 py-2 border border-white/20 rounded-xl" onClick={cancelShieldedTransfer} disabled={confirmingTransfer}>
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-gradient-neon text-black rounded-xl disabled:opacity-60 font-semibold"
              onClick={() => {
                console.log('=== CONFIRM BUTTON CLICKED ===');
                confirmShieldedTransfer().catch((err) => {
                  console.error('=== CONFIRM TRANSFER ERROR ===', err);
                  setStatus(`❌ Transfer failed: ${(err as Error).message}`);
                  setConfirmingTransfer(false);
                });
              }}
              disabled={confirmingTransfer}
            >
              {confirmingTransfer ? 'Sending…' : 'Confirm transfer'}
            </button>
          </div>
        </div>
      </div>
    );
  }, [transferReview, confirmingTransfer, cancelShieldedTransfer, confirmShieldedTransfer, pendingSharedNote, status]);

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
            {txConfirmation.changeAmount !== undefined && txConfirmation.changeAmount > 0 && (
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
            {txConfirmation.relayerPaysGas ? (
              <div className="flex justify-between">
                <span className="text-neutral-400">Solana network fee</span>
                <span className="text-green-400 text-sm">Covered by relayer ✓</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-neutral-400">Solana network fee</span>
                <span>{txConfirmation.solFee.toFixed(6)} SOL</span>
              </div>
            )}
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

  // Shielded transaction success modal (purple theme)
  const shieldedSuccessModal = useMemo(() => {
    if (!shieldedTxSuccess) return null;

    console.log('[UI] Rendering shielded success modal:', shieldedTxSuccess);

    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50 animate-in fade-in duration-300">
        <div className="bg-surface rounded-2xl max-w-md w-full p-6 space-y-4 border border-purple-500/30">
          <div className="flex flex-col items-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
              {shieldedTxSuccess.isFullPrivacy ? 'Private Transfer Complete' : 'Transaction successful'}
            </p>
            <h2 className="text-2xl font-semibold">Sent {shieldedTxSuccess.amount}</h2>
            {shieldedTxSuccess.isFullPrivacy && (
              <span className="text-xs text-purple-400">🔐 Fully Private • No on-chain trace</span>
            )}
          </div>

          <div className="space-y-3 text-sm">
            {shieldedTxSuccess.from && (
              <div className="bg-purple-900/20 rounded-xl p-3 border border-purple-500/20">
                <span className="text-neutral-400">From</span>
                <p className="font-mono text-xs text-purple-400 mt-1 break-all">{shieldedTxSuccess.from}</p>
              </div>
            )}

            <div className="bg-purple-900/20 rounded-xl p-3 border border-purple-500/20">
              <span className="text-neutral-400">To</span>
              <p className="font-mono text-xs text-purple-400 mt-1 break-all">{shieldedTxSuccess.recipient}</p>
            </div>

            <div className="bg-purple-900/20 rounded-xl p-3 border border-purple-500/20">
              <span className="text-neutral-400">Amount</span>
              <p className="font-mono text-sm text-purple-300 mt-1">{shieldedTxSuccess.amount}</p>
            </div>
          </div>

          <button
            className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-500 transition-colors"
            onClick={() => {
              console.log('[UI] Closing shielded success modal');
              setShieldedTxSuccess(null);
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }, [shieldedTxSuccess]);

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
                src="/NOC1.png" 
                alt="NOCtura" 
                style={{ height: '540px' }}
                className="w-auto"
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
        {mockRelayerBanner}
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
      {mockRelayerBanner}
      <Dashboard
        mode={mode}
        solBalance={solBalance}
        nocBalance={nocBalance}
        shieldedSolBalance={shieldedSolBalance}
        shieldedNocBalance={shieldedNocBalance}
        walletAddress={keypair?.publicKey.toBase58() || ''}
        shieldedAddress={shieldedKeys?.shieldedAddress}
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
      {shieldedSuccessModal}
      {shieldedErrorModal}
      {stagedSendModal}
      {transactionConfirmModal}
      {transactionSuccessModal}
      {mnemonicModal}
    </>
  );
}
