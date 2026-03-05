import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
const splToken = spl as Record<string, any>;
import bodyParser from 'body-parser';
import { AUTHORITY, PORT, RPC_ENDPOINT, NOC_MINT, AIRDROP_LAMPORTS, FEE_COLLECTOR, HELIUS_API_KEY } from './config.js';
import { generateProof } from './snark.js';
import { sendNocAirdrop } from './airdrop.js';
import { relayWithdraw, relayTransfer, relayConsolidate, RelayWithdrawParams, RelayTransferParams, RelayConsolidateParams } from './relayer.js';

// ============================================
// Swap Configuration
// ============================================
const NOC_MINT_PUBKEY = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const SWAP_FEE_BPS = 12; // 0.12%
const NOC_PRICE_USD = 0.30; // Fixed NOC price

interface PriceCache {
  solUsd: number;
  nocUsd: number;
  timestamp: number;
}
let priceCache: PriceCache | null = null;
const PRICE_CACHE_TTL = 5000;

async function fetchPrices(): Promise<{ solUsd: number; nocUsd: number }> {
  if (priceCache && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
    return { solUsd: priceCache.solUsd, nocUsd: priceCache.nocUsd };
  }
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    const solUsd = data.solana?.usd || 85;
    priceCache = { solUsd, nocUsd: NOC_PRICE_USD, timestamp: Date.now() };
    return { solUsd, nocUsd: NOC_PRICE_USD };
  } catch {
    return priceCache || { solUsd: 85, nocUsd: NOC_PRICE_USD };
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch (_) {
    return String(err);
  }
}

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

const connection = new Connection(RPC_ENDPOINT, 'confirmed');

app.get('/health', (_: Request, res: Response) => {
  res.json({ ok: true, slot: Date.now() });
});

// ============================================
// RPC PROXY: Forward RPC calls from frontend
// ============================================
// This solves CORS issues when frontend tries to call Helius directly
// The frontend will call /rpc instead of https://devnet.helius-rpc.com/?api-key=...
app.post('/rpc', async (req: Request, res: Response) => {
  try {
    const rpcPayload = req.body; // Should be a JSON-RPC 2.0 request
    
    // Determine which RPC endpoint to use
    let actuallRpcUrl = RPC_ENDPOINT;
    if (HELIUS_API_KEY && RPC_ENDPOINT.includes('helius')) {
      actuallRpcUrl = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
    }
    
    // Forward the RPC request to the backend RPC provider
    const rpcResponse = await fetch(actuallRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rpcPayload),
    });
    
    const result = await rpcResponse.json();
    res.json(result);
  } catch (err) {
    console.error('[RPC Proxy] Error:', err);
    res.status(400).json({ error: formatError(err), jsonrpc: '2.0', id: null });
  }
});

app.post('/prove/:circuit', async (req: Request, res: Response) => {
  try {
    const circuit = req.params.circuit;
    const input = req.body || {};
    
    // Log consolidate witness structure for debugging
    if (circuit === 'consolidate') {
      console.log(`[Prover] Consolidate witness received:`);
      console.log(`  - inSecrets length: ${input.inSecrets?.length || 'MISSING'}`);
      console.log(`  - inAmounts length: ${input.inAmounts?.length || 'MISSING'}`);
      console.log(`  - blindings length: ${input.blindings?.length || 'MISSING'}`);
      console.log(`  - rhos length: ${input.rhos?.length || 'MISSING'}`);
      console.log(`  - pathElements length: ${input.pathElements?.length || 'MISSING'}`);
      console.log(`  - pathElements[0] length: ${input.pathElements?.[0]?.length || 'MISSING'}`);
      console.log(`  - nullifiers length: ${input.nullifiers?.length || 'MISSING'}`);
      console.log(`  - merkleRoot: ${input.merkleRoot?.slice?.(0, 20) || 'MISSING'}...`);
      console.log(`  - tokenMint: ${input.tokenMint?.slice?.(0, 20) || 'MISSING'}...`);
      console.log(`  - outSecret: ${input.outSecret?.slice?.(0, 20) || 'MISSING'}...`);
      console.log(`  - outBlinding: ${input.outBlinding?.slice?.(0, 20) || 'MISSING'}...`);
    }
    
    const proof = await generateProof(circuit, input);
    res.json(proof);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: formatError(err) });
  }
});

app.post('/airdrop', async (req: Request, res: Response) => {
  try {
    const { destination } = req.body;
    if (!destination) {
      return res.status(400).json({ error: 'Destination is required' });
    }
    const signature = await sendNocAirdrop(
      connection,
      AUTHORITY,
      new PublicKey(NOC_MINT),
      new PublicKey(destination),
      AIRDROP_LAMPORTS,
    );
    res.json({ signature });
  } catch (err) {
    console.error('Shielded faucet request failed', err);
    res.status(400).json({ error: formatError(err) });
  }
});

// Relayer endpoint: Submit shielded withdrawal via relayer
// This preserves privacy - the relayer signs, not the user's wallet
// If collectFee=true, the relayer will split the withdrawal between recipient and fee collector
app.post('/relay/withdraw', async (req: Request, res: Response) => {
  try {
    const params: RelayWithdrawParams = req.body;
    if (!params.proof || !params.amount || !params.nullifier || !params.recipientAta) {
      return res.status(400).json({ error: 'Missing required parameters: proof, amount, nullifier, recipientAta' });
    }
    console.log('[Relayer] Received withdrawal request, collectFee:', params.collectFee);
    const signature = await relayWithdraw(connection, AUTHORITY, params, FEE_COLLECTOR);
    res.json({ signature });
  } catch (err) {
    console.error('[Relayer] Withdrawal failed:', err);
    res.status(400).json({ error: formatError(err) });
  }
});

// Relayer endpoint: Submit shielded transfer (note split) via relayer
app.post('/relay/transfer', async (req: Request, res: Response) => {
  try {
    const params: RelayTransferParams = req.body;
    if (!params.proof || !params.nullifier || !params.outputCommitment1 || !params.outputCommitment2) {
      return res.status(400).json({ error: 'Missing required parameters: proof, nullifier, outputCommitment1, outputCommitment2' });
    }
    console.log('[Relayer] Received transfer request');
    const signature = await relayTransfer(connection, AUTHORITY, params);
    res.json({ signature });
  } catch (err) {
    console.error('[Relayer] Transfer failed:', err);
    res.status(400).json({ error: formatError(err) });
  }
});

// Relayer endpoint: Submit consolidation (merge multiple notes) via relayer
app.post('/relay/consolidate', async (req: Request, res: Response) => {
  try {
    const params: RelayConsolidateParams = req.body;
    if (!params.proof || !params.publicInputs || !params.inputNullifiers || !params.outputCommitment) {
      return res.status(400).json({ error: 'Missing required parameters: proof, publicInputs, inputNullifiers, outputCommitment' });
    }
    console.log('[Relayer] Received consolidation request, inputs:', params.inputNullifiers.length);
    const signature = await relayConsolidate(connection, AUTHORITY, params);
    res.json({ signature });
  } catch (err) {
    console.error('[Relayer] Consolidation failed:', err);
    res.status(400).json({ error: formatError(err) });
  }
});

// Relayer endpoint: Send encrypted note memo in a separate transaction
// Used when the main transfer transaction is too large to include the memo
app.post('/relay/memo', async (req: Request, res: Response) => {
  try {
    const { encryptedNote, transferSignature } = req.body;
    if (!encryptedNote) {
      return res.status(400).json({ error: 'Missing encryptedNote' });
    }
    
    console.log('[Relayer] Received memo request for transfer:', transferSignature?.slice(0, 20));
    console.log('[Relayer] Memo data length:', encryptedNote.length);
    
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    
    // Include reference to the transfer transaction if provided
    const memoData = transferSignature 
      ? `noctura:${transferSignature.slice(0, 20)}:${encryptedNote}`
      : `noctura:${encryptedNote}`;
    
    const memoIx = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoData, 'utf-8'),
    });
    
    const tx = new Transaction().add(memoIx);
    tx.feePayer = AUTHORITY.publicKey;
    const latestBlockhash = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBlockhash.blockhash;
    tx.sign(AUTHORITY);
    
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    
    console.log('[Relayer] Memo sent:', signature);
    res.json({ signature });
  } catch (err) {
    console.error('[Relayer] Memo failed:', err);
    res.status(400).json({ error: formatError(err) });
  }
});

// Handle uncaught errors to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

// ============================================
// SWAP ENDPOINTS
// ============================================

// GET /swap/price - Get current prices
app.get('/swap/price', async (_req: Request, res: Response) => {
  try {
    const prices = await fetchPrices();
    res.json({
      solUsd: prices.solUsd,
      nocUsd: prices.nocUsd,
      solPerNoc: prices.nocUsd / prices.solUsd,
      nocPerSol: prices.solUsd / prices.nocUsd,
      feePercent: SWAP_FEE_BPS / 100,
      timestamp: Date.now()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /swap/quote - Get swap quote
app.post('/swap/quote', async (req: Request, res: Response) => {
  try {
    const { inputToken, inputAmount } = req.body;
    if (!inputToken || !inputAmount) {
      return res.status(400).json({ error: 'Missing inputToken or inputAmount' });
    }

    const prices = await fetchPrices();
    const amount = parseFloat(inputAmount);
    
    const inputValueUsd = inputToken === 'SOL' ? amount * prices.solUsd : amount * prices.nocUsd;
    const feeUsd = inputValueUsd * (SWAP_FEE_BPS / 10000);
    const outputValueUsd = inputValueUsd - feeUsd;
    
    const outputToken = inputToken === 'SOL' ? 'NOC' : 'SOL';
    const outputAmount = outputToken === 'SOL' ? outputValueUsd / prices.solUsd : outputValueUsd / prices.nocUsd;
    const fee = outputToken === 'SOL' ? feeUsd / prices.solUsd : feeUsd / prices.nocUsd;
    const rate = inputToken === 'SOL' ? prices.nocUsd / prices.solUsd : prices.solUsd / prices.nocUsd;

    res.json({
      inputToken,
      inputAmount: amount,
      outputToken,
      outputAmount,
      fee,
      feePercent: SWAP_FEE_BPS / 100,
      rate,
      priceImpact: 0,
      solUsd: prices.solUsd,
      nocUsd: prices.nocUsd,
      expiresAt: Date.now() + 30000
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /swap/execute - Execute swap (relayer sends output tokens)
app.post('/swap/execute', async (req: Request, res: Response) => {
  try {
    // Accept parameters from frontend (relayerSwap.ts)
    const { 
      inputToken, 
      inputAmount, 
      minOutputAmount,
      userPubkey,       // Frontend sends userPubkey
      userWallet,       // Legacy: some callers might use userWallet
      userInputSignature,  // Frontend sends this
      depositSignature,    // Legacy: some callers might use this
      outputAmount: providedOutputAmount, // Legacy: some callers provide output directly
    } = req.body;
    
    // Handle both new and legacy parameter names
    const walletAddress = userPubkey || userWallet;
    const transferSig = userInputSignature || depositSignature;
    
    if (!inputToken || !inputAmount || !walletAddress) {
      return res.status(400).json({ 
        error: 'Missing required fields: inputToken, inputAmount, userPubkey' 
      });
    }

    // Calculate output amount based on current prices (same as quote endpoint)
    const amount = parseFloat(inputAmount);
    
    // Fixed prices: NOC = $0.30, SOL from Pyth
    const NOC_USD_PRICE = 0.30;
    const SWAP_FEE_BPS = 12; // 0.12%
    
    // Fetch SOL price (simplified - in production use Pyth)
    let solUsdPrice = 100; // Default fallback
    try {
      const pythResp = await fetch('https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d');
      const pythData = await pythResp.json() as any;
      if (pythData?.[0]?.price?.price) {
        solUsdPrice = Number(pythData[0].price.price) * Math.pow(10, pythData[0].price.expo);
      }
    } catch {
      console.warn('[Swap] Failed to fetch SOL price, using fallback');
    }

    // Calculate output
    let outputAmount: number;
    const outputToken = inputToken === 'SOL' ? 'NOC' : 'SOL';
    
    if (inputToken === 'SOL') {
      const inputUsdValue = amount * solUsdPrice;
      const feeUsd = inputUsdValue * (SWAP_FEE_BPS / 10000);
      outputAmount = (inputUsdValue - feeUsd) / NOC_USD_PRICE;
    } else {
      const inputUsdValue = amount * NOC_USD_PRICE;
      const feeUsd = inputUsdValue * (SWAP_FEE_BPS / 10000);
      outputAmount = (inputUsdValue - feeUsd) / solUsdPrice;
    }

    console.log(`[Swap] Executing: ${amount} ${inputToken} -> ${outputAmount} ${outputToken}`);
    console.log(`[Swap] User wallet: ${walletAddress.slice(0, 12)}...`);

    const userPubkeyObj = new PublicKey(walletAddress);
    
    let tx = new Transaction();
    
    if (outputToken === 'SOL') {
      // Send SOL to user
      const lamports = Math.floor(outputAmount * LAMPORTS_PER_SOL);
      tx.add(SystemProgram.transfer({
        fromPubkey: AUTHORITY.publicKey,
        toPubkey: userPubkeyObj,
        lamports
      }));
    } else {
      // Send NOC to user
      const userAta = splToken.getAssociatedTokenAddressSync(NOC_MINT_PUBKEY, userPubkeyObj);
      const atoms = Math.floor(outputAmount * 1_000_000);
      
      // Check if user has ATA
      try {
        await splToken.getAccount(connection, userAta);
      } catch {
        tx.add(splToken.createAssociatedTokenAccountInstruction(
          AUTHORITY.publicKey, userAta, userPubkeyObj, NOC_MINT_PUBKEY
        ));
      }
      
      const relayerAta = splToken.getAssociatedTokenAddressSync(NOC_MINT_PUBKEY, AUTHORITY.publicKey);
      tx.add(splToken.createTransferInstruction(relayerAta, userAta, AUTHORITY.publicKey, BigInt(atoms)));
    }

    tx.feePayer = AUTHORITY.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(AUTHORITY);

    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`[Swap] ✅ Sent ${outputAmount} ${outputToken} to ${walletAddress.slice(0, 8)}..., tx: ${signature}`);
    res.json({ 
      success: true, 
      status: 'success',
      signature, 
      inputToken,
      inputAmount: amount,
      outputToken,
      outputAmount: outputAmount.toString(),
    });
  } catch (error: any) {
    console.error('[Swap] Execute error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /swap/liquidity - Check relayer liquidity
app.get('/swap/liquidity', async (_req: Request, res: Response) => {
  try {
    const solBalance = await connection.getBalance(AUTHORITY.publicKey) / LAMPORTS_PER_SOL;
    let nocBalance = 0;
    try {
      const ata = splToken.getAssociatedTokenAddressSync(NOC_MINT_PUBKEY, AUTHORITY.publicKey);
      const account = await splToken.getAccount(connection, ata);
      nocBalance = Number(account.amount) / 1_000_000;
    } catch {}
    
    res.json({
      solBalance,
      nocBalance,
      relayerAddress: AUTHORITY.publicKey.toBase58(),
      canSwapSolToNoc: nocBalance > 0,
      canSwapNocToSol: solBalance > 0.01
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Relay health endpoint (for relayer manager)
app.get('/relay/health', async (_req: Request, res: Response) => {
  try {
    const balance = await connection.getBalance(AUTHORITY.publicKey);
    res.json({
      status: 'healthy',
      feePayerBalance: balance / LAMPORTS_PER_SOL,
      feePayerPubkey: AUTHORITY.publicKey.toBase58(),
      shieldProgramId: '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz'
    });
  } catch (error: any) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Noctura prover listening on ${PORT}`);
});

// Keep the process alive
server.on('error', (err) => {
  console.error('[Server Error]', err);
});
