/**
 * Shielded Pool Client
 * 
 * Interacts with the on-chain shielded AMM pool for TRUE private swaps.
 * No tokens ever leave the shielded system during swaps!
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import { connection } from './solana';
import { getProgramForKeypair, deriveShieldPdas } from './anchorClient';
import { SOLANA_RPC } from './constants';

// Pool fee in basis points (e.g., 30 = 0.3%)
export const DEFAULT_SWAP_FEE_BPS = 30;

export interface PoolReserves {
  nocReserve: bigint;
  solReserve: bigint;
  lpTotalSupply: bigint;
  swapFeeBps: number;
  enabled: boolean;
}

/**
 * Get the current reserves of the shielded pool
 */
export async function getPoolReserves(): Promise<PoolReserves | null> {
  try {
    const pdas = deriveShieldPdas();
    const shieldedPool = pdas.shieldedPool;
    const conn = new Connection(SOLANA_RPC, 'confirmed');
    
    // Fetch the pool account data
    const accountInfo = await conn.getAccountInfo(shieldedPool);
    if (!accountInfo) {
      console.log('[ShieldedPool] Pool not initialized');
      return null;
    }

    // Parse the account data (skip 8-byte discriminator)
    const data = accountInfo.data.slice(8);
    
    // ShieldedPool layout (from state.rs):
    // admin: Pubkey (32)
    // sol_reserve: u64 (8)
    // noc_reserve: u64 (8)
    // lp_total_supply: u64 (8)
    // swap_fee_bps: u16 (2)
    // bump: u8 (1)
    // enabled: bool (1)
    
    const solReserve = BigInt(new BN(data.slice(32, 40), 'le').toString());
    const nocReserve = BigInt(new BN(data.slice(40, 48), 'le').toString());
    const lpTotalSupply = BigInt(new BN(data.slice(48, 56), 'le').toString());
    const swapFeeBps = data.readUInt16LE(56);
    const enabled = data[59] === 1;

    return {
      nocReserve,
      solReserve,
      lpTotalSupply,
      swapFeeBps,
      enabled,
    };
  } catch (error) {
    console.error('[ShieldedPool] Error fetching reserves:', error);
    return null;
  }
}

/**
 * Calculate expected output amount using constant-product AMM formula
 * output = (input * output_reserve * (10000 - fee)) / (input_reserve * 10000 + input * (10000 - fee))
 */
export function calculateSwapOutput(
  inputAmount: bigint,
  inputIsNoc: boolean,
  reserves: PoolReserves
): bigint {
  const inputReserve = inputIsNoc ? reserves.nocReserve : reserves.solReserve;
  const outputReserve = inputIsNoc ? reserves.solReserve : reserves.nocReserve;
  
  const feeMultiplier = 10000n - BigInt(reserves.swapFeeBps);
  const inputWithFee = inputAmount * feeMultiplier;
  const numerator = inputWithFee * outputReserve;
  const denominator = inputReserve * 10000n + inputWithFee;
  
  return numerator / denominator;
}

/**
 * Get a swap quote from the shielded pool
 */
export function getShieldedPoolQuote(
  inputAmount: bigint,
  inputIsNoc: boolean,
  reserves: PoolReserves,
  slippageBps: number = 100
): { outputAmount: bigint; minOutput: bigint; priceImpact: number } {
  const outputAmount = calculateSwapOutput(inputAmount, inputIsNoc, reserves);
  
  // Calculate minimum output with slippage
  const minOutput = outputAmount * (10000n - BigInt(slippageBps)) / 10000n;
  
  // Calculate price impact
  const inputReserve = inputIsNoc ? reserves.nocReserve : reserves.solReserve;
  const priceImpact = Number(inputAmount * 100n / inputReserve) / 100;
  
  return { outputAmount, minOutput, priceImpact };
}

/**
 * Initialize the shielded pool (admin only)
 */
export async function initializeShieldedPool(
  adminKeypair: Keypair,
  swapFeeBps: number = DEFAULT_SWAP_FEE_BPS
): Promise<string> {
  const program = getProgramForKeypair(adminKeypair);
  const pdas = deriveShieldPdas();
  const { globalState, shieldedPool } = pdas;

  const tx = await program.methods
    .initializeShieldedPool(swapFeeBps)
    .accounts({
      admin: adminKeypair.publicKey,
      globalState,
      shieldedPool,
      systemProgram: PublicKey.default,
    })
    .transaction();

  const sig = await sendAndConfirmTransaction(connection, tx, [adminKeypair], {
    commitment: 'confirmed',
  });

  console.log('[ShieldedPool] Initialized:', sig);
  return sig;
}

/**
 * Seed the shielded pool with initial liquidity (admin only)
 * Note: This updates the virtual reserves tracked in the pool.
 * The actual tokens should already be in the vault from deposits.
 */
export async function seedShieldedPool(
  adminKeypair: Keypair,
  solAmount: bigint,
  nocAmount: bigint
): Promise<string> {
  const program = getProgramForKeypair(adminKeypair);
  const pdas = deriveShieldPdas();
  const { globalState, shieldedPool } = pdas;

  const tx = await program.methods
    .seedShieldedPool(new BN(solAmount.toString()), new BN(nocAmount.toString()))
    .accounts({
      admin: adminKeypair.publicKey,
      globalState,
      shieldedPool,
    })
    .transaction();

  const sig = await sendAndConfirmTransaction(connection, tx, [adminKeypair], {
    commitment: 'confirmed',
  });

  console.log('[ShieldedPool] Seeded with', solAmount.toString(), 'SOL and', nocAmount.toString(), 'NOC');
  return sig;
}

/**
 * Execute a shielded pool swap
 * 
 * This is the TRUE private swap - tokens never leave the shielded system.
 * 
 * Requirements:
 * 1. User must have a shielded note with sufficient balance
 * 2. A ZK proof proving the swap is valid
 * 3. Swap verifier must be set up on-chain
 * 
 * NOTE: This requires a specialized swap ZK circuit.
 * For initial implementation, we fall back to withdraw→swap→deposit flow.
 */
export async function executeShieldedPoolSwap(
  keypair: Keypair,
  inputAmount: bigint,
  minOutputAmount: bigint,
  inputIsNoc: boolean,
  inputNullifier: Uint8Array,
  outputCommitment: Uint8Array,
  proof: Uint8Array,
  publicInputs: Uint8Array[]
): Promise<string> {
  const program = getProgramForKeypair(keypair);
  const pdas = deriveShieldPdas();
  const { merkleTree, nullifierSet, shieldedPool, swapVerifier } = pdas;

  // Debug: log what we're sending
  console.log('[executeShieldedPoolSwap] inputAmount:', inputAmount.toString());
  console.log('[executeShieldedPoolSwap] minOutputAmount:', minOutputAmount.toString());
  console.log('[executeShieldedPoolSwap] inputIsNoc:', inputIsNoc, '-> input_is_sol:', !inputIsNoc);
  console.log('[executeShieldedPoolSwap] proof length:', proof.length);
  console.log('[executeShieldedPoolSwap] publicInputs count:', publicInputs.length);
  publicInputs.forEach((pi, i) => {
    const hex = Array.from(pi).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`[executeShieldedPoolSwap] publicInput[${i}]:`, hex.slice(0, 32) + '...');
  });

  // Build transaction with compute budget
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));

  const swapIx = await program.methods
    .shieldedPoolSwap(
      new BN(inputAmount.toString()),
      new BN(minOutputAmount.toString()),
      !inputIsNoc, // input_is_sol on-chain
      Array.from(inputNullifier),
      Array.from(outputCommitment),
      Buffer.from(proof),
      publicInputs.map(pi => Array.from(pi))
    )
    .accounts({
      shieldedPool,
      merkleTree,
      nullifierSet,
      swapVerifier,
    })
    .instruction();

  tx.add(swapIx);

  const sig = await sendAndConfirmTransaction(connection, tx, [keypair], {
    commitment: 'confirmed',
  });

  console.log('[ShieldedPool] Swap executed:', sig);
  return sig;
}

/**
 * Check if the shielded pool is available and has liquidity
 */
export async function isShieldedPoolAvailable(): Promise<boolean> {
  try {
    const reserves = await getPoolReserves();
    if (!reserves) return false;
    return reserves.enabled && reserves.nocReserve > 0n && reserves.solReserve > 0n;
  } catch {
    return false;
  }
}

/**
 * Check if we should use the on-chain shielded pool for TRUE private swaps.
 * Returns true if pool is available, has good rates, and swap verifier is set.
 */
export async function shouldUseShieldedPool(): Promise<boolean> {
  // Check if pool exists and has liquidity
  const poolAvailable = await isShieldedPoolAvailable();
  if (!poolAvailable) {
    console.log('[ShieldedPool] Pool not available, using fallback');
    return false;
  }

  // Check pool rate is within acceptable range of market rate (283 NOC/SOL)
  const reserves = await getPoolReserves();
  if (reserves) {
    const poolRatio = Number(reserves.nocReserve) / Number(reserves.solReserve) * 1000; // NOC per 1 SOL
    const marketRatio = 283;
    const deviation = Math.abs(poolRatio - marketRatio) / marketRatio;
    
    if (deviation > 0.10) { // More than 10% off market rate
      console.log('[ShieldedPool] Pool rate', poolRatio.toFixed(0), 'NOC/SOL deviates', (deviation * 100).toFixed(1), '% from market', marketRatio, '- using fallback');
      return false;
    }
    console.log('[ShieldedPool] Pool rate', poolRatio.toFixed(0), 'NOC/SOL is within', (deviation * 100).toFixed(1), '% of market');
  }

  // Check if swap verifier is set up
  try {
    const pdas = deriveShieldPdas();
    const swapVerifier = pdas.swapVerifier;
    const conn = new Connection(SOLANA_RPC, 'confirmed');
    const verifierInfo = await conn.getAccountInfo(swapVerifier);
    if (!verifierInfo) {
      console.log('[ShieldedPool] Swap verifier not set, using fallback');
      return false;
    }
    console.log('[ShieldedPool] ✅ Using TRUE private swap mode');
    return true;
  } catch {
    return false;
  }
}
