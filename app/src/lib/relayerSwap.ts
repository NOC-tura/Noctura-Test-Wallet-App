/**
 * Relayer Swap Service
 * Handles token swaps via the Noctura relayer with oracle-based pricing
 * Replaces Jupiter integration for fully internal swaps
 */

import { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { NOC_TOKEN_MINT, SOLANA_RPC, RELAYER_ENDPOINTS } from './constants';

// Relayer swap API
const RELAYER_SWAP_BASE = `${RELAYER_ENDPOINTS[0]}/swap`;
console.log('[Swap] Using relayer endpoint:', RELAYER_SWAP_BASE);

export interface SwapQuote {
  inputToken: 'SOL' | 'NOC';
  inputAmount: number;
  outputToken: 'SOL' | 'NOC';
  outputAmount: number;
  fee: number;
  feePercent: number;
  rate: number;
  priceImpact: number;
  solUsd: number;
  nocUsd: number;
  expiresAt: number;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  inputAmount: string;
  outputAmount: string;
  error?: string;
}

export interface SwapPrice {
  solUsd: number;
  nocUsd: number;
  solPerNoc: number;
  nocPerSol: number;
  feePercent: number;
  timestamp: number;
}

export interface SwapLiquidity {
  sol?: number;
  noc?: number;
  solBalance?: number;
  nocBalance?: number;
  relayerPubkey?: string;
  relayerAddress?: string;
  canSwapSolToNoc?: boolean;
  canSwapNocToSol?: boolean;
}

/**
 * Get current swap prices from relayer
 */
export async function getSwapPrice(): Promise<SwapPrice | null> {
  try {
    const response = await fetch(`${RELAYER_SWAP_BASE}/price`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('[Swap] Price API error:', response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error('[Swap] Failed to get price:', err);
    return null;
  }
}

/**
 * Get swap quote from relayer
 */
export async function getSwapQuote(
  inputToken: 'SOL' | 'NOC',
  inputAmount: string,
  slippageBps: number = 50 // Not used for oracle-based pricing, but kept for API consistency
): Promise<SwapQuote | null> {
  try {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      console.warn('[Swap] Invalid amount:', inputAmount);
      return null;
    }

    const url = `${RELAYER_SWAP_BASE}/quote`;
    console.log('[Swap] Fetching quote from:', url, { inputToken, inputAmount });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputToken,
        inputAmount: amount,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Swap] Quote API error:', error);
      return null;
    }

    const quote: SwapQuote = await response.json();
    console.log('[Swap] Quote received:', {
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      rate: quote.rate,
    });

    return quote;
  } catch (err) {
    console.error('[Swap] Failed to get quote:', err);
    return null;
  }
}

/**
 * Format quote for display
 */
export function formatQuoteForDisplay(quote: SwapQuote): {
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;
  rate: number;
  route: string;
  fee: string;
} {
  const inputDecimals = quote.inputToken === 'SOL' ? 6 : 2;
  const outputDecimals = quote.outputToken === 'SOL' ? 6 : 2;

  return {
    inputAmount: quote.inputAmount.toFixed(inputDecimals),
    outputAmount: quote.outputAmount.toFixed(outputDecimals),
    priceImpact: quote.priceImpact,
    rate: quote.rate,
    route: 'Noctura Swap',
    fee: `${quote.feePercent}%`,
  };
}

/**
 * Execute swap via relayer
 * User sends inputToken to relayer, relayer sends outputToken back
 * 
 * Flow:
 * 1. User transfers inputToken to relayer
 * 2. Call relayer /swap/execute endpoint
 * 3. Relayer sends outputToken to user
 */
export async function executeSwap(
  quote: SwapQuote,
  keypair: Keypair,
  connection?: Connection
): Promise<SwapResult> {
  const conn = connection || new Connection(SOLANA_RPC, 'confirmed');

  try {
    console.log('[Swap] Executing swap...');

    // First, transfer input tokens to relayer
    const relayerPubkey = await getRelayerPubkey();
    if (!relayerPubkey) {
      throw new Error('Could not get relayer public key');
    }

    const inputAmount = quote.inputAmount;
    const inputToken = quote.inputToken;

    console.log(`[Swap] Transferring ${inputAmount} ${inputToken} to relayer...`);

    let transferSignature: string;

    if (inputToken === 'SOL') {
      // Transfer SOL to relayer
      const lamports = Math.floor(inputAmount * LAMPORTS_PER_SOL);
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(relayerPubkey),
          lamports,
        })
      );

      transaction.feePayer = keypair.publicKey;
      const { blockhash } = await conn.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.sign(keypair);

      transferSignature = await conn.sendRawTransaction(transaction.serialize());
      await conn.confirmTransaction(transferSignature, 'confirmed');
    } else {
      // Transfer NOC tokens to relayer
      const nocMint = new PublicKey(NOC_TOKEN_MINT);
      const userNocAta = await getAssociatedTokenAddress(
        nocMint,
        keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const relayerNocAta = await getAssociatedTokenAddress(
        nocMint,
        new PublicKey(relayerPubkey),
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // NOC has 6 decimals
      const nocAtoms = BigInt(Math.floor(inputAmount * 1_000_000));

      const transaction = new Transaction().add(
        createTransferInstruction(
          userNocAta,          // source
          relayerNocAta,       // destination
          keypair.publicKey,   // owner
          nocAtoms,            // amount
          [],                  // multiSigners
          TOKEN_PROGRAM_ID
        )
      );

      transaction.feePayer = keypair.publicKey;
      const { blockhash } = await conn.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.sign(keypair);

      transferSignature = await conn.sendRawTransaction(transaction.serialize());
      await conn.confirmTransaction(transferSignature, 'confirmed');
    }

    console.log('[Swap] Transfer complete:', transferSignature);

    // Now call relayer to execute the swap (send output tokens)
    const response = await fetch(`${RELAYER_SWAP_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputToken: quote.inputToken,
        inputAmount: quote.inputAmount,
        minOutputAmount: quote.outputAmount * 0.995, // 0.5% slippage tolerance
        userPubkey: keypair.publicKey.toBase58(),
        userInputSignature: transferSignature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Swap] Execute API error:', error);
      return {
        success: false,
        inputAmount: quote.inputAmount.toString(),
        outputAmount: quote.outputAmount.toString(),
        error: `Swap execution failed: ${error}`,
      };
    }

    const result = await response.json();

    console.log('[Swap] ✅ Swap successful:', result.signature);

    return {
      success: true,
      signature: result.signature,
      inputAmount: quote.inputAmount.toString(),
      outputAmount: result.outputAmount.toString(),
    };
  } catch (err) {
    console.error('[Swap] Execution failed:', err);
    return {
      success: false,
      inputAmount: quote.inputAmount.toString(),
      outputAmount: quote.outputAmount.toString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Execute swap for shielded flow
 * Input tokens are already withdrawn to a temp address
 * Output tokens go to a specified recipient for re-deposit
 */
export async function executeShieldedSwap(
  inputToken: 'SOL' | 'NOC',
  inputAmount: number,
  recipientPubkey: string
): Promise<SwapResult> {
  try {
    console.log('[Swap/Shielded] Executing shielded swap...');

    const response = await fetch(`${RELAYER_SWAP_BASE}/shielded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputToken,
        inputAmount,
        recipientPubkey,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Swap/Shielded] Execute API error:', error);
      return {
        success: false,
        inputAmount: inputAmount.toString(),
        outputAmount: '0',
        error: `Shielded swap failed: ${error}`,
      };
    }

    const result = await response.json();

    console.log('[Swap/Shielded] ✅ Swap successful:', result.signature);

    return {
      success: true,
      signature: result.signature,
      inputAmount: inputAmount.toString(),
      outputAmount: result.outputAmount.toString(),
    };
  } catch (err) {
    console.error('[Swap/Shielded] Execution failed:', err);
    return {
      success: false,
      inputAmount: inputAmount.toString(),
      outputAmount: '0',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Get estimated output amount for a swap (quick quote)
 */
export async function getEstimatedOutput(
  inputToken: 'SOL' | 'NOC',
  inputAmount: string,
  slippageBps: number = 50
): Promise<string | null> {
  const quote = await getSwapQuote(inputToken, inputAmount, slippageBps);
  if (!quote) return null;

  const outputDecimals = quote.outputToken === 'SOL' ? 6 : 2;
  return quote.outputAmount.toFixed(outputDecimals);
}

/**
 * Check if relayer swap is available
 */
export async function isSwapAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${RELAYER_SWAP_BASE}/price`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get relayer's available liquidity for swaps
 */
export async function getSwapLiquidity(): Promise<SwapLiquidity | null> {
  try {
    const response = await fetch(`${RELAYER_SWAP_BASE}/liquidity`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('[Swap] Liquidity API error:', response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error('[Swap] Failed to get liquidity:', err);
    return null;
  }
}

/**
 * Helper to get relayer public key for transfers
 */
async function getRelayerPubkey(): Promise<string | null> {
  try {
    const liquidity = await getSwapLiquidity();
    // API returns relayerAddress, not relayerPubkey
    return liquidity?.relayerAddress || liquidity?.relayerPubkey || null;
  } catch {
    return null;
  }
}

// Re-export types for compatibility
export type { SwapQuote as JupiterQuote };
