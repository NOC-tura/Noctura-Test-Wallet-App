import { Router, Request, Response } from 'express';
import { HeliusClient } from '../helius.js';
import { PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { config } from '../config.js';

const router = Router();

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

export default router;
