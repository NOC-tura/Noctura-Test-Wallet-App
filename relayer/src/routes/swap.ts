import { Router, Request, Response } from 'express';
import { HeliusClient } from '../helius.js';
import { 
  PublicKey, 
  Transaction, 
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { config } from '../config.js';

const router = Router();

// Token mints
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Price cache (5 second TTL)
interface PriceCache {
  solUsd: number;
  nocUsd: number;
  timestamp: number;
}
let priceCache: PriceCache | null = null;
const PRICE_CACHE_TTL = 5000; // 5 seconds

// Swap fee (0.12%)
const SWAP_FEE_BPS = 12; // 0.12% = 12 basis points

/**
 * Fetch prices from CoinGecko
 */
async function fetchPrices(): Promise<{ solUsd: number; nocUsd: number }> {
  // Check cache
  if (priceCache && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
    return { solUsd: priceCache.solUsd, nocUsd: priceCache.nocUsd };
  }

  try {
    // Fetch SOL price from CoinGecko
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json() as { solana?: { usd?: number } };
    const solUsd = data.solana?.usd || 100; // Fallback to $100 if API fails

    // NOC price - fixed at $0.30 (not on exchanges yet)
    const nocUsd = config.nocPriceUsd || 0.30;

    // Update cache
    priceCache = {
      solUsd,
      nocUsd,
      timestamp: Date.now()
    };

    console.log(`[Swap] Prices updated - SOL: $${solUsd}, NOC: $${nocUsd}`);
    return { solUsd, nocUsd };
  } catch (error: any) {
    console.error('[Swap] Price fetch error:', error.message);
    
    // Use cached prices if available, otherwise fallback
    if (priceCache) {
      return { solUsd: priceCache.solUsd, nocUsd: priceCache.nocUsd };
    }
    
    // Fallback prices
    return { solUsd: 100, nocUsd: config.nocPriceUsd || 0.01 };
  }
}

/**
 * Calculate swap output
 */
function calculateSwapOutput(
  inputAmount: number,
  inputToken: 'SOL' | 'NOC',
  solUsd: number,
  nocUsd: number
): { outputAmount: number; fee: number; rate: number } {
  // Calculate value in USD
  const inputValueUsd = inputToken === 'SOL' 
    ? inputAmount * solUsd 
    : inputAmount * nocUsd;

  // Apply swap fee
  const feeUsd = inputValueUsd * (SWAP_FEE_BPS / 10000);
  const outputValueUsd = inputValueUsd - feeUsd;

  // Convert to output token
  const outputToken = inputToken === 'SOL' ? 'NOC' : 'SOL';
  const outputAmount = outputToken === 'SOL'
    ? outputValueUsd / solUsd
    : outputValueUsd / nocUsd;

  // Calculate effective rate (input per output)
  const rate = inputToken === 'SOL'
    ? solUsd / nocUsd  // SOL -> NOC: how many NOC per SOL
    : nocUsd / solUsd; // NOC -> SOL: how many SOL per NOC

  // Fee in output token terms
  const feeInOutputToken = outputToken === 'SOL'
    ? feeUsd / solUsd
    : feeUsd / nocUsd;

  return {
    outputAmount,
    fee: feeInOutputToken,
    rate
  };
}

/**
 * GET /swap/price
 * Get current SOL/NOC price
 */
router.get('/price', async (_req: Request, res: Response) => {
  try {
    const prices = await fetchPrices();
    const solPerNoc = prices.nocUsd / prices.solUsd;
    const nocPerSol = prices.solUsd / prices.nocUsd;

    res.json({
      solUsd: prices.solUsd,
      nocUsd: prices.nocUsd,
      solPerNoc,
      nocPerSol,
      feePercent: SWAP_FEE_BPS / 100,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('[Swap] Price endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /swap/quote
 * Get a swap quote without executing
 */
router.post('/quote', async (req: Request, res: Response) => {
  try {
    const { inputToken, inputAmount } = req.body;

    if (!inputToken || !inputAmount) {
      return res.status(400).json({ error: 'Missing inputToken or inputAmount' });
    }

    if (inputToken !== 'SOL' && inputToken !== 'NOC') {
      return res.status(400).json({ error: 'inputToken must be SOL or NOC' });
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid inputAmount' });
    }

    const prices = await fetchPrices();
    const { outputAmount, fee, rate } = calculateSwapOutput(
      amount, 
      inputToken,
      prices.solUsd,
      prices.nocUsd
    );

    const outputToken = inputToken === 'SOL' ? 'NOC' : 'SOL';

    res.json({
      inputToken,
      inputAmount: amount,
      outputToken,
      outputAmount,
      fee,
      feePercent: SWAP_FEE_BPS / 100,
      rate,
      priceImpact: 0, // No price impact since we use oracle pricing
      solUsd: prices.solUsd,
      nocUsd: prices.nocUsd,
      expiresAt: Date.now() + 30000, // Quote valid for 30 seconds
    });
  } catch (error: any) {
    console.error('[Swap] Quote error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /swap/execute
 * Execute a swap transaction
 * 
 * For transparent swaps:
 * - User sends inputToken to relayer
 * - Relayer sends outputToken to user
 * 
 * For shielded swaps:
 * - Called after user withdraws from shielded pool
 * - Relayer receives inputToken and sends outputToken to specified address
 * - User then deposits outputToken back to shielded pool
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const { 
      inputToken, 
      inputAmount, 
      minOutputAmount,
      userPubkey,
      userInputSignature, // Signature of user's transfer to relayer (for verification)
    } = req.body;

    if (!inputToken || !inputAmount || !userPubkey) {
      return res.status(400).json({ 
        error: 'Missing required fields: inputToken, inputAmount, userPubkey' 
      });
    }

    if (inputToken !== 'SOL' && inputToken !== 'NOC') {
      return res.status(400).json({ error: 'inputToken must be SOL or NOC' });
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid inputAmount' });
    }

    const client = new HeliusClient();
    const connection = client.getConnection();
    const feePayer = client.getFeePayer();
    const userPubkeyObj = new PublicKey(userPubkey);

    // Calculate expected output
    const prices = await fetchPrices();
    const { outputAmount, fee, rate } = calculateSwapOutput(
      amount,
      inputToken,
      prices.solUsd,
      prices.nocUsd
    );

    // Check min output if specified
    if (minOutputAmount && outputAmount < parseFloat(minOutputAmount)) {
      return res.status(400).json({
        error: 'Slippage exceeded',
        expectedOutput: outputAmount,
        minOutput: parseFloat(minOutputAmount)
      });
    }

    const outputToken = inputToken === 'SOL' ? 'NOC' : 'SOL';
    console.log(`[Swap] Executing: ${amount} ${inputToken} -> ${outputAmount} ${outputToken}`);

    // Build transaction based on output token type
    const transaction = new Transaction();

    if (outputToken === 'SOL') {
      // Send SOL to user
      const lamports = Math.floor(outputAmount * LAMPORTS_PER_SOL);
      
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: feePayer.publicKey,
          toPubkey: userPubkeyObj,
          lamports,
        })
      );
    } else {
      // Send NOC tokens to user
      const userNocAta = await getAssociatedTokenAddress(
        NOC_MINT,
        userPubkeyObj,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const relayerNocAta = await getAssociatedTokenAddress(
        NOC_MINT,
        feePayer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check if user's ATA exists, create if needed
      try {
        await getAccount(connection, userNocAta);
      } catch {
        // ATA doesn't exist, create it
        transaction.add(
          createAssociatedTokenAccountInstruction(
            feePayer.publicKey, // payer
            userNocAta,         // ata
            userPubkeyObj,      // owner
            NOC_MINT,           // mint
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // NOC has 6 decimals
      const nocAtoms = BigInt(Math.floor(outputAmount * 1_000_000));

      transaction.add(
        createTransferInstruction(
          relayerNocAta,      // source
          userNocAta,         // destination
          feePayer.publicKey, // owner
          nocAtoms,           // amount
          [],                 // multiSigners
          TOKEN_PROGRAM_ID
        )
      );
    }

    // Submit transaction
    const signature = await client.submitTransaction(transaction);

    console.log(`[Swap] Success: ${signature}`);
    res.json({
      status: 'success',
      signature,
      inputToken,
      inputAmount: amount,
      outputToken,
      outputAmount,
      fee,
      rate,
    });
  } catch (error: any) {
    console.error('[Swap] Execute error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /swap/liquidity
 * Get relayer's available liquidity for swaps
 */
router.get('/liquidity', async (_req: Request, res: Response) => {
  try {
    const client = new HeliusClient();
    const connection = client.getConnection();
    const feePayer = client.getFeePayer();

    // Get SOL balance
    const solBalance = await connection.getBalance(feePayer.publicKey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;

    // Get NOC balance
    let nocAmount = 0;
    try {
      const relayerNocAta = await getAssociatedTokenAddress(
        NOC_MINT,
        feePayer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const nocAccount = await getAccount(connection, relayerNocAta);
      nocAmount = Number(nocAccount.amount) / 1_000_000; // 6 decimals
    } catch {
      // ATA doesn't exist, balance is 0
    }

    res.json({
      sol: solAmount,
      noc: nocAmount,
      relayerPubkey: feePayer.publicKey.toBase58(),
    });
  } catch (error: any) {
    console.error('[Swap] Liquidity error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /swap/shielded
 * Execute a shielded swap (for internal use by shielded swap flow)
 * This endpoint handles the swap portion after withdrawal and before re-deposit
 */
router.post('/shielded', async (req: Request, res: Response) => {
  try {
    const { 
      inputToken, 
      inputAmount,
      recipientPubkey, // Where to send the output (usually a temp address for re-deposit)
    } = req.body;

    if (!inputToken || !inputAmount || !recipientPubkey) {
      return res.status(400).json({ 
        error: 'Missing required fields: inputToken, inputAmount, recipientPubkey' 
      });
    }

    if (inputToken !== 'SOL' && inputToken !== 'NOC') {
      return res.status(400).json({ error: 'inputToken must be SOL or NOC' });
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid inputAmount' });
    }

    const client = new HeliusClient();
    const connection = client.getConnection();
    const feePayer = client.getFeePayer();
    const recipientPubkeyObj = new PublicKey(recipientPubkey);

    // Calculate output
    const prices = await fetchPrices();
    const { outputAmount, fee, rate } = calculateSwapOutput(
      amount,
      inputToken,
      prices.solUsd,
      prices.nocUsd
    );

    const outputToken = inputToken === 'SOL' ? 'NOC' : 'SOL';
    console.log(`[Swap/Shielded] Executing: ${amount} ${inputToken} -> ${outputAmount} ${outputToken}`);

    const transaction = new Transaction();

    if (outputToken === 'SOL') {
      const lamports = Math.floor(outputAmount * LAMPORTS_PER_SOL);
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: feePayer.publicKey,
          toPubkey: recipientPubkeyObj,
          lamports,
        })
      );
    } else {
      const recipientNocAta = await getAssociatedTokenAddress(
        NOC_MINT,
        recipientPubkeyObj,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const relayerNocAta = await getAssociatedTokenAddress(
        NOC_MINT,
        feePayer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      try {
        await getAccount(connection, recipientNocAta);
      } catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            feePayer.publicKey,
            recipientNocAta,
            recipientPubkeyObj,
            NOC_MINT,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      const nocAtoms = BigInt(Math.floor(outputAmount * 1_000_000));
      transaction.add(
        createTransferInstruction(
          relayerNocAta,
          recipientNocAta,
          feePayer.publicKey,
          nocAtoms,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    const signature = await client.submitTransaction(transaction);

    console.log(`[Swap/Shielded] Success: ${signature}`);
    res.json({
      status: 'success',
      signature,
      inputToken,
      inputAmount: amount,
      outputToken,
      outputAmount,
      fee,
      rate,
    });
  } catch (error: any) {
    console.error('[Swap/Shielded] Execute error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
