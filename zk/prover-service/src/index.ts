import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { Connection, PublicKey } from '@solana/web3.js';
import bodyParser from 'body-parser';
import { AUTHORITY, PORT, RPC_ENDPOINT, NOC_MINT, AIRDROP_LAMPORTS, FEE_COLLECTOR } from './config.js';
import { generateProof } from './snark.js';
import { sendNocAirdrop } from './airdrop.js';
import { relayWithdraw, relayTransfer, relayConsolidate, RelayWithdrawParams, RelayTransferParams, RelayConsolidateParams } from './relayer.js';

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

app.post('/prove/:circuit', async (req: Request, res: Response) => {
  try {
    const circuit = req.params.circuit;
    const proof = await generateProof(circuit, req.body || {});
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
import { Transaction, TransactionInstruction, Keypair } from '@solana/web3.js';
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

const server = app.listen(PORT, () => {
  console.log(`Noctura prover listening on ${PORT}`);
});

// Keep the process alive
server.on('error', (err) => {
  console.error('[Server Error]', err);
});
