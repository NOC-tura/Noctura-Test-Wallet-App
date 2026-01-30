/**
 * Script to reset the nullifier set on devnet
 * Run with: npx ts-node scripts/resetNullifiers.ts
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Seeds for PDAs
const GLOBAL_STATE_SEED = Buffer.from('global_state');
const NULLIFIER_SEED = Buffer.from('nullifiers');

// Instruction discriminator for reset_nullifiers (first 8 bytes of sha256("global:reset_nullifiers"))
// This is how Anchor generates instruction discriminators
async function getInstructionDiscriminator(name: string): Promise<Buffer> {
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256');
  hash.update(`global:${name}`);
  return hash.digest().slice(0, 8);
}

async function main() {
  // Load wallet keypair
  const walletPath = process.env.SOLANA_KEY || path.join(process.env.HOME!, 'config/solana/id.json');
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('Admin wallet:', walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Derive PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [nullifierSetPda] = PublicKey.findProgramAddressSync([NULLIFIER_SEED], PROGRAM_ID);
  
  console.log('Global State PDA:', globalStatePda.toBase58());
  console.log('Nullifier Set PDA:', nullifierSetPda.toBase58());
  
  // Check current nullifier count
  const nullifierAccount = await connection.getAccountInfo(nullifierSetPda);
  if (nullifierAccount) {
    // First 8 bytes are discriminator, next 4 bytes are vec length (u32 little-endian)
    const vecLength = nullifierAccount.data.readUInt32LE(8);
    console.log('Current nullifier count:', vecLength);
  }
  
  // Create reset_nullifiers instruction
  const discriminator = await getInstructionDiscriminator('reset_nullifiers');
  
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },  // admin
      { pubkey: globalStatePda, isSigner: false, isWritable: false },          // global_state
      { pubkey: nullifierSetPda, isSigner: false, isWritable: true },          // nullifier_set
    ],
    data: discriminator,
  });
  
  // Send transaction
  const tx = new Transaction().add(instruction);
  
  console.log('Sending reset_nullifiers transaction...');
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
    console.log('✅ Nullifiers reset successfully!');
    console.log('Transaction signature:', signature);
    
    // Verify reset
    const updatedAccount = await connection.getAccountInfo(nullifierSetPda);
    if (updatedAccount) {
      const newVecLength = updatedAccount.data.readUInt32LE(8);
      console.log('New nullifier count:', newVecLength);
    }
  } catch (err) {
    console.error('❌ Failed to reset nullifiers:', err);
  }
}

main().catch(console.error);
