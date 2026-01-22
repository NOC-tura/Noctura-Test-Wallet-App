import { Router, Request, Response } from 'express';
import { HeliusClient } from '../helius.js';
import { PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { config } from '../config.js';

const router = Router();

// Memo program ID
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * Health check endpoint
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const client = new HeliusClient();
    const balance = await client.getBalance(client.getFeePayer().publicKey);
    res.json({
      status: 'healthy',
      feePayerBalance: balance / 1e9,
      feePayerPubkey: client.getFeePayer().publicKey.toBase58(),
      shieldProgramId: config.shieldProgramId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /relay/deposit
 * Relays a shielded deposit transaction
 */
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const { proof, publicInputs, userPubkey, tokenMint, amount } = req.body;

    if (!proof || !publicInputs || !userPubkey || !tokenMint || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = new HeliusClient();
    
    // Get validity proof from Helius
    const validityProof = await client.getValidityProof({
      hashes: [publicInputs.nullifierHash || publicInputs.commitment],
    });

    // Build shield program instruction (deposit)
    const programId = new PublicKey(config.shieldProgramId);
    const userPubkeyObj = new PublicKey(userPubkey);
    const tokenMintObj = new PublicKey(tokenMint);

    // This is a simplified instruction - adjust according to your program's actual interface
    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: userPubkeyObj, isSigner: true, isWritable: true },
        { pubkey: tokenMintObj, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(JSON.stringify({
        instruction: 'deposit',
        proof,
        publicInputs,
        validityProof,
        amount,
      })),
    });

    const transaction = new Transaction().add(instruction);
    const signature = await client.submitTransaction(transaction);

    res.json({ signature, status: 'success' });
  } catch (error: any) {
    console.error('Deposit relay error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /relay/withdraw
 * Relays a shielded withdrawal transaction
 */
router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const { proof, publicInputs, recipientPubkey, tokenMint, amount } = req.body;

    if (!proof || !publicInputs || !recipientPubkey || !tokenMint || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = new HeliusClient();
    
    // Get validity proof from Helius
    const validityProof = await client.getValidityProof({
      hashes: publicInputs.nullifiers || [publicInputs.nullifierHash],
    });

    const programId = new PublicKey(config.shieldProgramId);
    const recipientPubkeyObj = new PublicKey(recipientPubkey);
    const tokenMintObj = new PublicKey(tokenMint);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: recipientPubkeyObj, isSigner: false, isWritable: true },
        { pubkey: tokenMintObj, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(JSON.stringify({
        instruction: 'withdraw',
        proof,
        publicInputs,
        validityProof,
        amount,
      })),
    });

    const transaction = new Transaction().add(instruction);
    const signature = await client.submitTransaction(transaction);

    res.json({ signature, status: 'success' });
  } catch (error: any) {
    console.error('Withdraw relay error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /relay/transfer
 * Relays a shielded transfer transaction
 */
router.post('/transfer', async (req: Request, res: Response) => {
  try {
    const { proof, publicInputs, tokenMint } = req.body;

    if (!proof || !publicInputs || !tokenMint) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = new HeliusClient();
    
    // Get validity proof from Helius
    const validityProof = await client.getValidityProof({
      hashes: publicInputs.nullifiers || [],
      newAddresses: publicInputs.commitments || [],
    });

    const programId = new PublicKey(config.shieldProgramId);
    const tokenMintObj = new PublicKey(tokenMint);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: tokenMintObj, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(JSON.stringify({
        instruction: 'transfer',
        proof,
        publicInputs,
        validityProof,
      })),
    });

    const transaction = new Transaction().add(instruction);
    const signature = await client.submitTransaction(transaction);

    res.json({ signature, status: 'success' });
  } catch (error: any) {
    console.error('Transfer relay error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /relay/consolidate
 * Relays a consolidation transaction (8 notes → 1 note)
 */
router.post('/consolidate', async (req: Request, res: Response) => {
  try {
    const { proof, publicInputs, tokenMint } = req.body;

    if (!proof || !publicInputs || !tokenMint) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = new HeliusClient();
    
    // Get validity proof from Helius
    const validityProof = await client.getValidityProof({
      hashes: publicInputs.nullifiers || [],
      newAddresses: [publicInputs.outputCommitment],
    });

    const programId = new PublicKey(config.shieldProgramId);
    const tokenMintObj = new PublicKey(tokenMint);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: tokenMintObj, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(JSON.stringify({
        instruction: 'consolidate',
        proof,
        publicInputs,
        validityProof,
      })),
    });

    const transaction = new Transaction().add(instruction);
    const signature = await client.submitTransaction(transaction);

    res.json({ signature, status: 'success' });
  } catch (error: any) {
    console.error('Consolidate relay error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /relay/memo
 * Sends an encrypted note as a memo transaction for recipient discovery.
 * This is used for shielded-to-shielded transfers where the encrypted note
 * data is too large to include in the main transfer transaction.
 */
router.post('/memo', async (req: Request, res: Response) => {
  try {
    const { encryptedNote, transferSignature } = req.body;

    if (!encryptedNote) {
      return res.status(400).json({ error: 'Missing encryptedNote field' });
    }

    console.log('[Relay/Memo] Sending encrypted memo, length:', encryptedNote.length);
    if (transferSignature) {
      console.log('[Relay/Memo] Associated with transfer:', transferSignature.slice(0, 20) + '...');
    }

    const client = new HeliusClient();

    // Build a memo instruction with the encrypted note data
    // Format: noctura:<txRef>:<encryptedData> or noctura:<encryptedData>
    let memoData: string;
    if (transferSignature && transferSignature.length >= 20) {
      // Include first 20 chars of transfer signature as reference
      memoData = `noctura:${transferSignature.slice(0, 20)}:${encryptedNote}`;
    } else {
      memoData = `noctura:${encryptedNote}`;
    }

    // Check memo size - Solana memos have a limit
    const memoBytes = Buffer.from(memoData, 'utf-8');
    if (memoBytes.length > 566) {
      // Standard memo size limit is around 566 bytes
      console.warn('[Relay/Memo] Memo size warning:', memoBytes.length, 'bytes (limit ~566)');
      // Try without transaction reference to save space
      memoData = `noctura:${encryptedNote}`;
    }

    const memoInstruction = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoData, 'utf-8'),
    });

    const transaction = new Transaction().add(memoInstruction);
    const signature = await client.submitTransaction(transaction);

    console.log('[Relay/Memo] Memo sent successfully:', signature);
    res.json({ signature, status: 'success' });
  } catch (error: any) {
    console.error('[Relay/Memo] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
