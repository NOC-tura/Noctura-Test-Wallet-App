/**
 * On-chain Transparent Pool Swap
 * 
 * Executes swaps using the on-chain AMM pool.
 * No relayer needed - fully decentralized!
 */

import { 
  Connection, 
  PublicKey, 
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import { NOC_TOKEN_MINT, SOLANA_RPC, SHIELD_PROGRAM_ID } from './constants';
import { getProgramForKeypair, deriveShieldPdas } from './anchorClient';
import { getPoolReserves, calculateSwapOutput, PoolReserves } from './shieldedPool';

const NOC_DECIMALS = 6;
const SOL_DECIMALS = 9;

/**
 * Polling-based transaction confirmation that doesn't use blockheight
 * (which expires too quickly on slow devnet). Checks every 500ms for up to 45 seconds.
 */
async function pollForConfirmation(conn: Connection, signature: string, label: string): Promise<void> {
  let confirmed = false;
  let attempts = 0;
  const maxAttempts = 90; // 90 * 500ms = 45 second timeout
  console.log(`[${label}] Starting confirmation polling for sig: ${signature.slice(0, 16)}...`);
  
  while (!confirmed && attempts < maxAttempts) {
    try {
      const status = await conn.getSignatureStatus(signature);
      
      if (attempts % 10 === 0) {
        console.log(`[${label}] Poll attempt ${attempts}: status = ${status.value?.confirmationStatus || 'null'}`);
      }
      
      if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
        if (status.value.err) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
        }
        confirmed = true;
        console.log(`[${label}] ✅ Confirmed in ${(attempts * 0.5).toFixed(1)}s`);
        break;
      }
      if (status.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      }
    } catch (pollErr) {
      if (attempts % 20 === 0) {
        console.log(`[${label}] Poll error at attempt ${attempts}:`, (pollErr as Error).message);
      }
    }
    attempts++;
    if (!confirmed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!confirmed) {
    throw new Error(`${label}: Transaction not confirmed after ${(attempts * 0.5).toFixed(1)}s. Sig: ${signature}`);
  }
}

export interface OnChainSwapQuote {
  inputToken: 'SOL' | 'NOC';
  inputAmount: number;
  outputToken: 'SOL' | 'NOC';
  outputAmount: number;
  fee: number;
  feePercent: number;
  rate: number;
  priceImpact: number;
  minOutput: number;
}

export interface OnChainSwapResult {
  success: boolean;
  signature?: string;
  inputAmount: string;
  outputAmount: string;
  error?: string;
}

/**
 * Get a swap quote from the on-chain pool
 */
export async function getOnChainSwapQuote(
  inputToken: 'SOL' | 'NOC',
  inputAmount: string,
  slippageBps: number = 50 // 0.5% default slippage
): Promise<OnChainSwapQuote | null> {
  try {
    const reserves = await getPoolReserves();
    if (!reserves || !reserves.enabled) {
      console.log('[OnChainSwap] Pool not available');
      return null;
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      console.warn('[OnChainSwap] Invalid amount:', inputAmount);
      return null;
    }

    const inputDecimals = inputToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
    const outputDecimals = inputToken === 'SOL' ? NOC_DECIMALS : SOL_DECIMALS;
    const inputAtoms = BigInt(Math.floor(amount * Math.pow(10, inputDecimals)));

    const inputIsNoc = inputToken === 'NOC';
    const outputAtoms = calculateSwapOutput(inputAtoms, inputIsNoc, reserves);
    
    const outputAmount = Number(outputAtoms) / Math.pow(10, outputDecimals);
    const minOutput = outputAmount * (1 - slippageBps / 10000);

    // Calculate effective rate
    const rate = inputToken === 'SOL' 
      ? outputAmount / amount  // NOC per SOL
      : amount / outputAmount; // NOC per SOL (inverted)

    return {
      inputToken,
      inputAmount: amount,
      outputToken: inputToken === 'SOL' ? 'NOC' : 'SOL',
      outputAmount,
      fee: amount * (reserves.swapFeeBps / 10000),
      feePercent: reserves.swapFeeBps / 100,
      rate,
      priceImpact: 0, // AMM has built-in price impact
      minOutput,
    };
  } catch (err) {
    console.error('[OnChainSwap] Failed to get quote:', err);
    return null;
  }
}

/**
 * Execute a transparent swap on-chain (no relayer!)
 */
export async function executeOnChainSwap(
  quote: OnChainSwapQuote,
  keypair: Keypair,
  connection?: Connection
): Promise<OnChainSwapResult> {
  const conn = connection || new Connection(SOLANA_RPC, 'confirmed');

  try {
    console.log('[OnChainSwap] Executing on-chain swap...');

    const program = getProgramForKeypair(keypair);
    const pdas = deriveShieldPdas();

    const inputDecimals = quote.inputToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
    const outputDecimals = quote.outputToken === 'SOL' ? SOL_DECIMALS : NOC_DECIMALS;
    
    const inputAmount = new BN(
      Math.floor(quote.inputAmount * Math.pow(10, inputDecimals)).toString()
    );
    const minOutputAmount = new BN(
      Math.floor(quote.minOutput * Math.pow(10, outputDecimals)).toString()
    );
    const inputIsSol = quote.inputToken === 'SOL';

    // Get user's NOC token account
    const nocMint = new PublicKey(NOC_TOKEN_MINT);
    const userNocAccount = getAssociatedTokenAddressSync(
      nocMint,
      keypair.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Derive vault accounts
    const programId = new PublicKey(SHIELD_PROGRAM_ID);
    const [solVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('sol-vault')],
      programId
    );
    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault-token'), nocMint.toBuffer()],
      programId
    );
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault-authority'), nocMint.toBuffer()],
      programId
    );

    console.log('[OnChainSwap] Calling transparent_pool_swap instruction...', {
      inputAmount: inputAmount.toString(),
      minOutputAmount: minOutputAmount.toString(),
      inputIsSol,
    });

    // Build the swap instruction
    const swapIx = await program.methods
      .transparentPoolSwap(inputAmount, minOutputAmount, inputIsSol)
      .accounts({
        user: keypair.publicKey,
        shieldedPool: pdas.shieldedPool,
        solVault,
        nocMint,
        vaultTokenAccount,
        vaultAuthority,
        userNocAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // Request more compute units for swap logic
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });

    // Build transaction with compute budget
    const tx = new Transaction().add(computeBudgetIx).add(swapIx);
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);

    // Send with polling confirmation (handles slow devnet)
    const signature = await conn.sendRawTransaction(tx.serialize());
    await pollForConfirmation(conn, signature, 'OnChainSwap');

    console.log('[OnChainSwap] ✅ Swap successful:', signature);

    return {
      success: true,
      signature,
      inputAmount: quote.inputAmount.toString(),
      outputAmount: quote.outputAmount.toFixed(quote.outputToken === 'SOL' ? 9 : 6),
    };
  } catch (err) {
    console.error('[OnChainSwap] Execution failed:', err);
    return {
      success: false,
      inputAmount: quote.inputAmount.toString(),
      outputAmount: quote.outputAmount.toString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
