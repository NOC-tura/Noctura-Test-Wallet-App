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
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { NOC_TOKEN_MINT, WSOL_MINT, SOLANA_RPC, RELAYER_ADDRESS } from './constants';
import { getSwapQuote, formatQuoteForDisplay, SwapQuote } from './relayerSwap';
import { proveCircuit, ProverResponse } from './prover';
import { submitShieldedDeposit, submitShieldedWithdraw, submitShieldedWithdrawSol, PRIVACY_FEE_ATOMS, base64ToBytes } from './shieldProgram';
import { buildMerkleProof } from './merkle';
import { pubkeyToField, prepareDeposit, snapshotNote, createNoteFromSecrets, EXPECTED_NOC_TOKEN_MINT_FIELD, EXPECTED_SOL_TOKEN_MINT_FIELD, randomScalar } from './shield';
import { serializeWithdrawWitness, serializeDepositWitness, serializeSwapWitness, createNote } from '@zk-witness/index';
import type { Note } from '@zk-witness/index';
import { ShieldedNoteRecord } from '../types/shield';
import { getTokenBalance, getSolBalance } from './solana';
import { 
  shouldUseShieldedPool, 
  getPoolReserves, 
  getShieldedPoolQuote,
  calculateSwapOutput,
  executeShieldedPoolSwap 
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
}

export interface ShieldedSwapResult {
  success: boolean;
  withdrawSignature?: string;
  swapSignature?: string;
  depositSignature?: string;
  inputAmount: string;
  outputAmount: string;
  outputNote?: ShieldedNoteRecord;
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
      console.log('[ShieldedSwap] 🔒 Using TRUE PRIVATE mode (shielded pool)');
      onStatusUpdate('🔒 TRUE PRIVATE swap mode - tokens stay shielded');
      
      // ============================================
      // TRUE PRIVATE SWAP - No tokens leave shielded system!
      // ============================================
      
      // Step 1: Select input note
      onStatusUpdate('Selecting shielded note...');
      const relevantNotes = shieldedNotes.filter(n => 
        !n.spent && 
        n.owner === walletAddress && 
        n.tokenType === fromToken
      );

      if (relevantNotes.length === 0) {
        throw new Error(`No shielded ${fromToken} notes available`);
      }

      // Sort by amount descending, find a note that covers the amount
      relevantNotes.sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
      const inputNote = relevantNotes.find(n => BigInt(n.amount) >= amountAtoms);
      
      if (!inputNote) {
        throw new Error(`No single note covers ${amount} ${fromToken}. Consolidate notes first.`);
      }

      // Step 2: Get pool reserves and calculate output
      onStatusUpdate('Calculating swap output...');
      const reserves = await getPoolReserves();
      if (!reserves) {
        throw new Error('Failed to get pool reserves');
      }

      const inputIsNoc = fromToken === 'NOC';
      const outputAmount = calculateSwapOutput(amountAtoms, inputIsNoc, reserves);
      const minOutputAmount = outputAmount * BigInt(10000 - slippageBps) / 10000n;

      const outputDecimals = toToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
      console.log('[ShieldedSwap] Pool quote:', {
        input: amountAtoms.toString(),
        output: outputAmount.toString(),
        minOutput: minOutputAmount.toString(),
      });

      // Step 3: Create output note
      const outTokenMint = toToken === 'SOL' ? BigInt(EXPECTED_SOL_TOKEN_MINT_FIELD) : BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD);
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

      // Step 4: Build merkle proof for input note
      onStatusUpdate('Building merkle proof...');
      const allUnspent = shieldedNotes.filter(n => n.owner === walletAddress && !n.spent);
      const merkleProof = buildMerkleProof(allUnspent, inputNote);

      const inputNoteStruct: Note = {
        secret: BigInt(inputNote.secret),
        amount: BigInt(inputNote.amount),
        tokenMint: BigInt(inputNote.tokenMintField),
        blinding: BigInt(inputNote.blinding),
        rho: BigInt(inputNote.rho),
        commitment: BigInt(inputNote.commitment),
        nullifier: BigInt(inputNote.nullifier),
      };

      // Step 5: Generate swap proof
      onStatusUpdate('Generating ZK swap proof...');
      const swapWitness = serializeSwapWitness({
        inputNote: inputNoteStruct,
        merkleProof,
        outAmount: outputAmount,
        outTokenMint,
        outSecret,
        outBlinding,
      });

      const swapProof = await proveCircuit('swap', swapWitness);
      console.log('[ShieldedSwap] Swap proof generated');

      // Step 6: Execute on-chain shielded pool swap
      onStatusUpdate('Executing private swap on-chain...');
      
      const inputNullifier = new Uint8Array(32);
      const nullifierBigInt = BigInt(inputNote.nullifier);
      for (let i = 31; i >= 0; i--) {
        inputNullifier[i] = Number(nullifierBigInt & 0xffn);
        nullifierBigInt >> 8n;
      }
      // Actually convert correctly
      const nullBytes = BigInt(inputNote.nullifier).toString(16).padStart(64, '0');
      for (let i = 0; i < 32; i++) {
        inputNullifier[i] = parseInt(nullBytes.substring(i * 2, i * 2 + 2), 16);
      }

      const outputCommitment = new Uint8Array(32);
      const commitBytes = outputNote.commitment.toString(16).padStart(64, '0');
      for (let i = 0; i < 32; i++) {
        outputCommitment[i] = parseInt(commitBytes.substring(i * 2, i * 2 + 2), 16);
      }

      // Convert ALL public signals to bytes (not just 3 - circuit has inputs + outputs)
      // publicSignals order: [merkleRoot, nullifier, expectedOutAmount, inputCommitment, outputCommitment, inputAmount, inputTokenMint, outputTokenMint]
      console.log('[ShieldedSwap] Public signals from prover:', swapProof.publicSignals);
      console.log('[ShieldedSwap] Public signals count:', swapProof.publicSignals.length);
      
      // Convert public signals to big-endian bytes (EIP-196 format for alt_bn128)
      const publicInputs = swapProof.publicSignals.map((sig: string) => {
        const bytes = new Uint8Array(32);
        const value = BigInt(sig);
        // Convert to big-endian (EIP-196 standard)
        for (let i = 31; i >= 0; i--) {
          bytes[31 - i] = Number((value >> BigInt(i * 8)) & 0xffn);
        }
        return bytes;
      });

      // Convert proof bytes from base64 (prover service returns base64)
      const proofBytes = base64ToBytes(swapProof.proofBytes);
      console.log('[ShieldedSwap] Proof bytes length:', proofBytes.length);

      const swapSignature = await executeShieldedPoolSwap(
        keypair,
        amountAtoms,
        minOutputAmount,
        inputIsNoc,
        inputNullifier,
        outputCommitment,
        proofBytes,
        publicInputs
      );

      console.log('[ShieldedSwap] ✅ TRUE PRIVATE swap complete:', swapSignature);

      // Step 7: Mark input note as spent, add output note
      markNoteSpent(inputNote.nullifier);

      const outputNoteRecord = snapshotNote(outputNote, keypair.publicKey, toToken, {
        signature: swapSignature,
      });
      addShieldedNote(outputNoteRecord);

      const inputFormatted = (Number(amountAtoms) / Math.pow(10, inputDecimals)).toFixed(inputDecimals === 9 ? 4 : 2);
      const outputFormatted = (Number(outputAmount) / Math.pow(10, outputDecimals)).toFixed(outputDecimals === 9 ? 4 : 2);

      onStatusUpdate(`✅ TRUE PRIVATE swap complete! ${inputFormatted} ${fromToken} → ${outputFormatted} ${toToken}`);

      return {
        success: true,
        swapSignature,
        inputAmount: inputFormatted,
        outputAmount: outputFormatted,
        outputNote: outputNoteRecord,
      };
    }
    
    // ============================================
    // FALLBACK MODE - Withdraw → Swap → Re-deposit
    // ============================================
    console.log('[ShieldedSwap] 🔄 Using RELAYER mode (withdraw→swap→deposit)');
    onStatusUpdate('Using relayer swap mode...');

    // ============================================
    // STEP 1: Get quote from relayer first
    // ============================================
    onStatusUpdate('Getting swap quote from Noctura...');
    
    const quote = await getSwapQuote(fromToken, amount, slippageBps);
    if (!quote) {
      throw new Error('Failed to get swap quote from Noctura relayer');
    }

    const formattedQuote = formatQuoteForDisplay(quote);
    console.log('[ShieldedSwap] Quote:', formattedQuote);

    // ============================================
    // STEP 2: Find and select notes to withdraw
    // ============================================
    onStatusUpdate('Selecting notes for withdrawal...');

    const relevantNotes = shieldedNotes.filter(n => 
      !n.spent && 
      n.owner === walletAddress && 
      n.tokenType === fromToken
    );

    if (relevantNotes.length === 0) {
      throw new Error(`No shielded ${fromToken} notes available`);
    }

    // Sort by amount descending to prefer larger notes
    relevantNotes.sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));

    // Find notes that cover the amount
    let selectedNotes: ShieldedNoteRecord[] = [];
    let totalSelected = 0n;
    
    // For NOC, we need to include privacy fee
    const totalNeeded = fromToken === 'NOC' 
      ? amountAtoms + PRIVACY_FEE_ATOMS 
      : amountAtoms;

    for (const note of relevantNotes) {
      selectedNotes.push(note);
      totalSelected += BigInt(note.amount);
      if (totalSelected >= totalNeeded) break;
    }

    if (totalSelected < totalNeeded) {
      throw new Error(`Insufficient shielded ${fromToken}. Have ${totalSelected}, need ${totalNeeded}`);
    }

    console.log('[ShieldedSwap] Selected notes:', selectedNotes.length, 'total:', totalSelected.toString());

    // ============================================
    // STEP 3: Withdraw from shielded pool
    // ============================================
    onStatusUpdate(`Withdrawing ${amount} ${fromToken} from shielded pool (ZK proof 1/2)...`);

    // For simplicity, we'll withdraw the first note that covers the amount
    // In production, you might want to consolidate notes first if needed
    const withdrawNote = selectedNotes[0];
    const withdrawAmount = BigInt(withdrawNote.amount);

    // Build merkle proof
    const allUnspent = shieldedNotes.filter(n => n.owner === walletAddress && !n.spent);
    const merkleProof = buildMerkleProof(allUnspent, withdrawNote);

    const inputNote: Note = {
      secret: BigInt(withdrawNote.secret),
      amount: withdrawAmount,
      tokenMint: fromToken === 'SOL' ? 1n : BigInt(EXPECTED_NOC_TOKEN_MINT_FIELD),
      blinding: BigInt(withdrawNote.blinding),
      rho: BigInt(withdrawNote.rho),
      commitment: BigInt(withdrawNote.commitment),
      nullifier: BigInt(withdrawNote.nullifier),
    };

    // Withdraw to user's own address for the swap
    const withdrawWitness = serializeWithdrawWitness({
      inputNote,
      merkleProof,
      receiver: pubkeyToField(keypair.publicKey),
    });

    console.log('[ShieldedSwap] Generating withdrawal proof...');
    const withdrawProof = await proveCircuit('withdraw', withdrawWitness);

    // Submit withdrawal - use appropriate function based on token type
    let withdrawSignature: string;
    
    if (fromToken === 'SOL') {
      // For SOL, use the native SOL withdrawal function
      withdrawSignature = await submitShieldedWithdrawSol({
        keypair,
        proof: withdrawProof,
        amount: withdrawAmount,
        recipient: keypair.publicKey,
        nullifier: BigInt(withdrawNote.nullifier),
      });
    } else {
      // For NOC, use the token withdrawal function
      const nocMint = new PublicKey(NOC_TOKEN_MINT);
      const targetAta = getAssociatedTokenAddressSync(
        nocMint,
        keypair.publicKey,
        false
      );
      
      withdrawSignature = await submitShieldedWithdraw({
        keypair,
        proof: withdrawProof,
        amount: withdrawAmount,
        targetAta,
        nullifier: BigInt(withdrawNote.nullifier),
        mint: nocMint,
        recipient: keypair.publicKey,
      });
    }

    console.log('[ShieldedSwap] ✅ Withdrawal complete:', withdrawSignature);
    markNoteSpent(withdrawNote.nullifier);

    // Wait a moment for the funds to arrive
    onStatusUpdate('Waiting for funds to arrive...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ============================================
    // STEP 4: Execute swap (tokens are now in transparent wallet)
    // ============================================
    onStatusUpdate(`Swapping ${amount} ${fromToken} → ${toToken} via Noctura...`);

    // Calculate change: how much of fromToken we withdrew vs how much we're swapping
    const withdrawnFloat = Number(withdrawAmount) / Math.pow(10, inputDecimals);
    const requestedFloat = parseFloat(amount);
    const changeFloat = withdrawnFloat - requestedFloat;
    const changeAtoms = withdrawAmount - amountAtoms;
    
    console.log('[ShieldedSwap] Swap amounts:', { 
      withdrawn: withdrawnFloat, 
      requested: requestedFloat, 
      change: changeFloat,
      changeAtoms: changeAtoms.toString()
    });

    // Import executeSwap which handles tokens in user's transparent wallet
    const { executeSwap, getSwapQuote: getQuote } = await import('./relayerSwap');
    
    // Get fresh quote for the REQUESTED amount (not the full withdrawn amount)
    const swapQuote = await getQuote(fromToken, amount, slippageBps);
    if (!swapQuote) {
      throw new Error('Failed to get swap quote');
    }
    
    // Execute swap - transfers from user to relayer, then relayer sends output
    const swapResult = await executeSwap(swapQuote, keypair);

    if (!swapResult.success) {
      throw new Error(`Swap failed: ${swapResult.error}`);
    }

    console.log('[ShieldedSwap] ✅ Swap complete:', swapResult.signature);

    // Wait for swap to settle
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ============================================
    // STEP 5: Re-deposit CHANGE to shielded pool (if any)
    // ============================================
    let changeNote: ShieldedNoteRecord | undefined;
    if (changeAtoms > 0n) {
      onStatusUpdate(`Re-depositing ${changeFloat.toFixed(2)} ${fromToken} change to shielded pool...`);
      console.log('[ShieldedSwap] Re-depositing change:', changeAtoms.toString(), fromToken);

      // Prepare change deposit
      const changeDeposit = prepareDeposit(changeAtoms, fromToken);

      // Generate change deposit proof
      const changeDepositWitness = serializeDepositWitness({ note: changeDeposit.note });
      const changeDepositProof = await proveCircuit('deposit', changeDepositWitness);

      // Submit change deposit
      const changeMint = fromToken === 'SOL' ? undefined : new PublicKey(NOC_TOKEN_MINT);
      const changeDepositResult = await submitShieldedDeposit({
        keypair,
        prepared: changeDeposit,
        proof: changeDepositProof,
        mint: changeMint,
        tokenType: fromToken,
      });

      console.log('[ShieldedSwap] ✅ Change deposit complete:', changeDepositResult.signature);

      // Save the change note
      changeNote = snapshotNote(changeDeposit.note, keypair.publicKey, fromToken, {
        signature: changeDepositResult.signature,
        leafIndex: changeDepositResult.leafIndex,
      });
      addShieldedNote(changeNote);
    }

    // ============================================
    // STEP 6: Re-deposit SWAP OUTPUT to shielded pool
    // ============================================
    onStatusUpdate(`Depositing ${toToken} back to shielded pool...`);

    // Get the output amount from the swap
    const outputDecimals = toToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
    const outputAmountFloat = parseFloat(swapResult.outputAmount);
    const outputAtoms = BigInt(Math.floor(outputAmountFloat * Math.pow(10, outputDecimals)));

    // Prepare deposit
    const deposit = prepareDeposit(outputAtoms, toToken);

    // Generate deposit proof
    const depositWitness = serializeDepositWitness({ note: deposit.note });
    const depositProof = await proveCircuit('deposit', depositWitness);

    // Submit deposit
    const depositMint = toToken === 'SOL' ? undefined : new PublicKey(NOC_TOKEN_MINT);
    const depositResult = await submitShieldedDeposit({
      keypair,
      prepared: deposit,
      proof: depositProof,
      mint: depositMint,
      tokenType: toToken,
    });

    console.log('[ShieldedSwap] ✅ Deposit complete:', depositResult.signature);

    // Save the new shielded note
    const outputNote = snapshotNote(deposit.note, keypair.publicKey, toToken, { 
      signature: depositResult.signature,
      leafIndex: depositResult.leafIndex,
    });
    addShieldedNote(outputNote);

    // ============================================
    // SUCCESS
    // ============================================
    onStatusUpdate('');

    const outputAmountFormatted = (Number(outputAtoms) / Math.pow(10, outputDecimals)).toFixed(
      outputDecimals === 9 ? 6 : 2
    );

    return {
      success: true,
      withdrawSignature,
      swapSignature: swapResult.signature,
      depositSignature: depositResult.signature,
      inputAmount: amount,
      outputAmount: outputAmountFormatted,
      outputNote,
    };
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
