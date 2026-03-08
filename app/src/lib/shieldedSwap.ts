/**
 * Shielded Swap Service
 * 
 * TWO MODES:
 * 
 * 1. TRUE PRIVATE (Shielded Pool Mode):
 *    - Uses on-chain AMM pool
 *    - Tokens NEVER leave shielded system
 *    - Requires shielded pool to be initialized and funded
 * 
 * 2. FALLBACK (Relayer Mode):
 *    - Withdraw → Swap via Relayer → Re-deposit
 *    - Brief transparent exposure
 *    - Used when shielded pool not available
 */

import { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { NOC_TOKEN_MINT, WSOL_MINT, SOLANA_RPC, RELAYER_ADDRESS } from './constants';
import { getSwapQuote, formatQuoteForDisplay, SwapQuote } from './relayerSwap';
import { proveCircuit, ProverResponse, relayTransfer } from './prover';
import { submitShieldedDeposit, submitShieldedWithdraw, submitShieldedWithdrawSol, submitShieldedTransfer, relayConsolidate, PRIVACY_FEE_ATOMS, base64ToBytes } from './shieldProgram';
import { buildMerkleProof } from './merkle';
import { pubkeyToField, prepareDeposit, snapshotNote, createNoteFromSecrets, EXPECTED_NOC_TOKEN_MINT_FIELD, EXPECTED_SOL_TOKEN_MINT_FIELD, randomScalar } from './shield';
import { serializeWithdrawWitness, serializeDepositWitness, serializeSwapWitness, serializeSwapV2Witness, serializeTransferWitness, createNote } from '@zk-witness/index';
import type { Note } from '@zk-witness/index';
import { ShieldedNoteRecord } from '../types/shield';
import { getTokenBalance, getSolBalance } from './solana';
import { buildConsolidationWitness, partitionNotesForConsolidation } from './consolidate';
import { 
  shouldUseShieldedPool, 
  getPoolReserves, 
  getShieldedPoolQuote,
  calculateSwapOutput,
  executeShieldedPoolSwap,
  executeShieldedPoolSwapV2
} from './shieldedPool';

const NOC_DECIMALS = 6;
const SOL_DECIMALS = 9;

export interface ShieldedSwapParams {
  fromToken: 'SOL' | 'NOC';
  toToken: 'SOL' | 'NOC';
  amount: string;
  slippageBps: number;
  // Wallet info
  keypair: Keypair;
  walletAddress: string;
  // Shielded notes
  shieldedNotes: ShieldedNoteRecord[];
  // Callbacks
  onStatusUpdate: (status: string) => void;
  markNoteSpent: (nullifier: string) => void;
  addShieldedNote: (note: ShieldedNoteRecord) => void;
  // Consolidation callback: receives notes to consolidate, returns consolidated notes
  onConsolidateNotes?: (notes: ShieldedNoteRecord[]) => Promise<ShieldedNoteRecord[]>;
}

export interface ShieldedSwapResult {
  success: boolean;
  withdrawSignature?: string;
  swapSignature?: string;
  depositSignature?: string;
  inputAmount: string;
  outputAmount: string;
  outputNote?: ShieldedNoteRecord;
  changeNote?: ShieldedNoteRecord; // Remaining input token (for fee collection)
  changeAmount?: string; // Change amount as string
  error?: string;
}

/**
 * Execute a shielded swap (private)
 * 
 * This is a 3-step atomic process:
 * 1. Withdraw from shielded pool → transparent balance
 * 2. Swap via Jupiter
 * 3. Re-deposit to shielded pool
 */
export async function executeShieldedSwap(
  params: ShieldedSwapParams
): Promise<ShieldedSwapResult> {
  const {
    fromToken,
    toToken,
    amount,
    slippageBps,
    keypair,
    walletAddress,
    shieldedNotes,
    onStatusUpdate,
    markNoteSpent,
    addShieldedNote,
    onConsolidateNotes,
  } = params;

  const connection = new Connection(SOLANA_RPC, 'confirmed');

  try {
    console.log('[ShieldedSwap] Starting shielded swap:', { fromToken, toToken, amount });
    
    // Convert amount to atoms/lamports
    const inputDecimals = fromToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
    const amountAtoms = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, inputDecimals)));
    
    // Check if shielded pool is available for TRUE private swap
    const useShieldedPool = await shouldUseShieldedPool();
    
    if (useShieldedPool) {
      console.log('[ShieldedSwap] 🔒 Using TRUE PRIVATE mode (shielded pool with swap_v2)');
      onStatusUpdate('🔒 TRUE PRIVATE swap mode - tokens stay shielded');
      
      // ============================================
      // TRUE PRIVATE SWAP V2 - Supports ANY amount from a note
      // User can swap X from a note of Y where X <= Y
      // Receives: swapped tokens + change (Y - X)
      // ============================================
      
      const relevantNotes = shieldedNotes.filter(n => 
        !n.spent && 
        n.owner === walletAddress && 
        n.tokenType === fromToken
      );

      if (relevantNotes.length === 0) {
        throw new Error(`No shielded ${fromToken} notes available`);
      }

      // Find a note with enough balance for the swap
      const sortedNotes = [...relevantNotes].sort((a, b) => 
        Number(BigInt(b.amount) - BigInt(a.amount))
      );
      
      const suitableNote = sortedNotes.find(n => BigInt(n.amount) >= amountAtoms);

      // If no single note large enough, auto-consolidate first
      let finalNote: ShieldedNoteRecord;
      
      if (!suitableNote) {
        const totalAvailable = relevantNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
        const largestNote = sortedNotes[0] ? BigInt(sortedNotes[0].amount) : 0n;
        const largestDisplay = (Number(largestNote) / Math.pow(10, inputDecimals)).toFixed(2);
        const swapAmountDisplay = (Number(amountAtoms) / Math.pow(10, inputDecimals)).toFixed(2);
        const totalDisplay = (Number(totalAvailable) / Math.pow(10, inputDecimals)).toFixed(2);
        
        // Check if total across all notes is enough
        if (totalAvailable < amountAtoms) {
          throw new Error(
            `Insufficient ${fromToken} balance. You have ${totalDisplay} ${fromToken} ` +
            `but need ${swapAmountDisplay} ${fromToken} for this swap.`
          );
        }
        
        // Check if we have consolidation callback
        if (!onConsolidateNotes) {
          throw new Error(
            `No single note large enough. Your largest note is ${largestDisplay} ${fromToken}, ` +
            `but swap needs ${swapAmountDisplay} ${fromToken}. ` +
            `Total across ${relevantNotes.length} notes: ${totalDisplay} ${fromToken}. ` +
            `Auto-consolidation not available.`
          );
        }
        
        // Select notes to consolidate (enough to cover the swap amount)
        console.log(`[ShieldedSwap] Auto-consolidating notes to cover ${swapAmountDisplay} ${fromToken}...`);
        onStatusUpdate(`🔄 Auto-consolidating ${relevantNotes.length} notes...`);
        
        // Select notes greedily until we have enough
        const notesToConsolidate: ShieldedNoteRecord[] = [];
        let accumulatedAmount = 0n;
        for (const note of sortedNotes) {
          notesToConsolidate.push(note);
          accumulatedAmount += BigInt(note.amount);
          if (accumulatedAmount >= amountAtoms) {
            break;
          }
        }
        
        console.log(`[ShieldedSwap] Consolidating ${notesToConsolidate.length} notes with total ${(Number(accumulatedAmount) / Math.pow(10, inputDecimals)).toFixed(2)} ${fromToken}`);
        
        // Call consolidation callback - this will generate proofs and submit to relayer
        const consolidatedNotes = await onConsolidateNotes(notesToConsolidate);
        
        if (!consolidatedNotes || consolidatedNotes.length === 0) {
          throw new Error('Consolidation failed - no consolidated notes returned');
        }
        
        // Use the first consolidated note (should be large enough now)
        finalNote = consolidatedNotes[0];
        console.log(`[ShieldedSwap] ✅ Consolidation complete. Using note with ${(Number(BigInt(finalNote.amount)) / Math.pow(10, inputDecimals)).toFixed(2)} ${fromToken}`);
        onStatusUpdate('✅ Notes consolidated! Continuing with swap...');
      } else {
        finalNote = suitableNote;
      }

      const noteAmount = BigInt(finalNote.amount);
      const swapAmount = amountAtoms; // User's requested swap amount
      const changeAmount = noteAmount - swapAmount; // Remainder goes back as change
      
      const swapDisplay = (Number(swapAmount) / Math.pow(10, inputDecimals)).toFixed(2);
      const changeDisplay = (Number(changeAmount) / Math.pow(10, inputDecimals)).toFixed(2);
      console.log(`[ShieldedSwap] Using note: ${(Number(noteAmount) / Math.pow(10, inputDecimals)).toFixed(2)} ${fromToken}`);
      console.log(`[ShieldedSwap] Swap: ${swapDisplay} ${fromToken}, Change: ${changeDisplay} ${fromToken}`);
      
      onStatusUpdate(`Swapping ${swapDisplay} ${fromToken}...`);

      // Step 1: Get pool reserves and calculate output
      onStatusUpdate('Calculating swap output...');
      const reserves = await getPoolReserves();
      if (!reserves) {
        throw new Error('Failed to get pool reserves');
      }

      const inputIsNoc = fromToken === 'NOC';
      // Calculate output based on swap amount (not full note)
      const outputAmount = calculateSwapOutput(swapAmount, inputIsNoc, reserves);
      const minOutputAmount = outputAmount * BigInt(10000 - slippageBps) / 10000n;

      const outputDecimals = toToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
      console.log('[ShieldedSwap] Pool quote:', {
        swapAmount: swapAmount.toString(),
        output: outputAmount.toString(),
        minOutput: minOutputAmount.toString(),
      });

      // Step 2: Create output notes (swapped token + change)
      const inTokenMint = fromToken === 'SOL' ? BigInt(EXPECTED_SOL_TOKEN_MINT_FIELD) : BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
      const outTokenMint = toToken === 'SOL' ? BigInt(EXPECTED_SOL_TOKEN_MINT_FIELD) : BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
      
      // Output note (swapped token)
      const outSecret = randomScalar();
      const outBlinding = randomScalar();
      const outRho = randomScalar();
      const outputNote = createNote({
        secret: outSecret,
        amount: outputAmount,
        tokenMint: outTokenMint,
        blinding: outBlinding,
        rho: outRho,
      });
      
      // Change note (same token as input)
      const changeSecret = randomScalar();
      const changeBlinding = randomScalar();
      const changeRho = randomScalar();
      const changeNote = createNote({
        secret: changeSecret,
        amount: changeAmount,
        tokenMint: inTokenMint,
        blinding: changeBlinding,
        rho: changeRho,
      });

      // Step 3: Build merkle proof for input note
      onStatusUpdate('Building merkle proof...');
      // If we consolidated, need to include the new consolidated note in the tree
      const allUnspent = shieldedNotes.filter(n => n.owner === walletAddress && !n.spent);
      const merkleNotes = finalNote === suitableNote ? allUnspent : [...allUnspent.filter(n => n.nullifier !== finalNote.nullifier), finalNote];
      const merkleProof = buildMerkleProof(merkleNotes, finalNote);

      const inputNoteStruct: Note = {
        secret: BigInt(finalNote.secret),
        amount: BigInt(finalNote.amount),
        tokenMint: BigInt(finalNote.tokenMintField),
        blinding: BigInt(finalNote.blinding),
        rho: BigInt(finalNote.rho),
        commitment: BigInt(finalNote.commitment),
        nullifier: BigInt(finalNote.nullifier),
      };

      // Step 4: Generate swap_v2 proof (supports partial swaps)
      onStatusUpdate('Generating ZK swap proof...');
      const swapWitness = serializeSwapV2Witness({
        inputNote: inputNoteStruct,
        merkleProof,
        swapAmount,
        expectedOutAmount: outputAmount,
        outTokenMint,
        outSecret,
        outBlinding,
        changeSecret,
        changeBlinding,
      });

      const swapProof = await proveCircuit('swap_v2', swapWitness);
      console.log('[ShieldedSwap] Swap V2 proof generated');

      // Step 5: Execute on-chain shielded pool swap V2
      onStatusUpdate('Executing private swap on-chain...');
      
      // Convert nullifier to bytes
      const nullBytes = BigInt(finalNote.nullifier).toString(16).padStart(64, '0');
      const inputNullifier = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        inputNullifier[i] = parseInt(nullBytes.substring(i * 2, i * 2 + 2), 16);
      }

      // Convert output commitment to bytes
      const outputCommitment = new Uint8Array(32);
      const outCommitBytes = outputNote.commitment.toString(16).padStart(64, '0');
      for (let i = 0; i < 32; i++) {
        outputCommitment[i] = parseInt(outCommitBytes.substring(i * 2, i * 2 + 2), 16);
      }

      // Convert change commitment to bytes
      const changeCommitment = new Uint8Array(32);
      const changeCommitBytes = changeNote.commitment.toString(16).padStart(64, '0');
      for (let i = 0; i < 32; i++) {
        changeCommitment[i] = parseInt(changeCommitBytes.substring(i * 2, i * 2 + 2), 16);
      }

      // Convert public signals to big-endian bytes
      console.log('[ShieldedSwap] Public signals from prover:', swapProof.publicSignals);
      console.log('[ShieldedSwap] Public signals count:', swapProof.publicSignals.length);
      
      const publicInputs = swapProof.publicSignals.map((sig: string) => {
        const bytes = new Uint8Array(32);
        const value = BigInt(sig);
        for (let i = 31; i >= 0; i--) {
          bytes[31 - i] = Number((value >> BigInt(i * 8)) & 0xffn);
        }
        return bytes;
      });

      // Convert proof bytes from base64
      const proofBytes = base64ToBytes(swapProof.proofBytes);
      console.log('[ShieldedSwap] Proof bytes length:', proofBytes.length);

      const swapSignature = await executeShieldedPoolSwapV2(
        keypair,
        swapAmount,
        minOutputAmount,
        inputIsNoc,
        inputNullifier,
        outputCommitment,
        changeCommitment,
        proofBytes,
        publicInputs
      );

      console.log('[ShieldedSwap] ✅ TRUE PRIVATE swap V2 complete:', swapSignature);

      // Step 6: Mark input note as spent, add output notes
      markNoteSpent(finalNote.nullifier);

      const outputNoteRecord = snapshotNote(outputNote, keypair.publicKey, toToken, {
        signature: swapSignature,
      });
      addShieldedNote(outputNoteRecord);

      // Add change note if there's any change
      let changeNoteRecord: ShieldedNoteRecord | undefined;
      if (changeAmount > 0n) {
        changeNoteRecord = snapshotNote(changeNote, keypair.publicKey, fromToken, {
          signature: swapSignature,
        });
        addShieldedNote(changeNoteRecord);
        console.log(`[ShieldedSwap] Added change note: ${changeDisplay} ${fromToken}`);
      }

      const inputFormatted = (Number(swapAmount) / Math.pow(10, inputDecimals)).toFixed(inputDecimals === 9 ? 4 : 2);
      const outputFormatted = (Number(outputAmount) / Math.pow(10, outputDecimals)).toFixed(outputDecimals === 9 ? 4 : 2);

      onStatusUpdate(`✅ TRUE PRIVATE swap complete! ${inputFormatted} ${fromToken} → ${outputFormatted} ${toToken}`);

      return {
        success: true,
        swapSignature,
        inputAmount: inputFormatted,
        outputAmount: outputFormatted,
        outputNote: outputNoteRecord,
        changeNote: changeNoteRecord,
        changeAmount: changeDisplay,
      };
    }
    
    // Shielded pool not available - cannot proceed with TRUE PRIVATE swap
    throw new Error(
      'Shielded pool is not available. Please ensure the pool is initialized and funded, ' +
      'or use regular swap mode for transparent swaps.'
    );
  } catch (err) {
    console.error('[ShieldedSwap] Failed:', err);
    onStatusUpdate('');
    return {
      success: false,
      inputAmount: amount,
      outputAmount: '0',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Estimate shielded swap output (includes fees)
 */
export async function estimateShieldedSwapOutput(
  fromToken: 'SOL' | 'NOC',
  toToken: 'SOL' | 'NOC',
  amount: string,
  slippageBps: number = 50
): Promise<{
  outputAmount: string;
  priceImpact: number;
  privacyFee: string;
  networkFee: string;
} | null> {
  try {
    const quote = await getSwapQuote(fromToken, amount, slippageBps);
    if (!quote) return null;

    const formatted = formatQuoteForDisplay(quote);

    return {
      outputAmount: formatted.outputAmount,
      priceImpact: formatted.priceImpact,
      privacyFee: '0.25', // NOC privacy fee
      networkFee: '0.000005', // SOL network fee
    };
  } catch {
    return null;
  }
}

/**
 * Check if user has sufficient shielded balance for swap
 */
export function canExecuteShieldedSwap(
  fromToken: 'SOL' | 'NOC',
  amount: string,
  shieldedNotes: ShieldedNoteRecord[],
  walletAddress: string
): { canSwap: boolean; reason?: string } {
  const inputDecimals = fromToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
  const amountAtoms = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, inputDecimals)));
  
  // Calculate total available
  const availableNotes = shieldedNotes.filter(n => 
    !n.spent && 
    n.owner === walletAddress && 
    n.tokenType === fromToken
  );
  
  const totalAvailable = availableNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
  
  // For NOC, need to include privacy fee
  const totalNeeded = fromToken === 'NOC' 
    ? amountAtoms + PRIVACY_FEE_ATOMS 
    : amountAtoms;

  if (totalAvailable < totalNeeded) {
    const shortfall = totalNeeded - totalAvailable;
    const shortfallFormatted = (Number(shortfall) / Math.pow(10, inputDecimals)).toFixed(
      inputDecimals === 9 ? 6 : 2
    );
    return {
      canSwap: false,
      reason: `Insufficient shielded ${fromToken}. Need ${shortfallFormatted} more ${fromToken}.`,
    };
  }

  return { canSwap: true };
}
