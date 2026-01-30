/**
 * Script to emergency reset the nullifier set on devnet
 * Run with: node scripts/emergencyResetNullifiers.mjs
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Seeds for PDAs (must match the Rust program constants)
const NULLIFIER_SEED = Buffer.from('nullifiers');

// Instruction discriminator for emergency_reset_nullifiers
function getInstructionDiscriminator(name) {
  const hash = createHash('sha256');
  hash.update(`global:${name}`);
  return hash.digest().slice(0, 8);
}

async function main() {
  // Load wallet keypair
  const walletPath = process.env.SOLANA_KEY || path.join(process.env.HOME, 'config/solana/id.json');
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('Payer wallet:', walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Derive PDA
  const [nullifierSetPda] = PublicKey.findProgramAddressSync([NULLIFIER_SEED], PROGRAM_ID);
  
  console.log('Nullifier Set PDA:', nullifierSetPda.toBase58());
  
  // Check current nullifier count
  const nullifierAccount = await connection.getAccountInfo(nullifierSetPda);
  if (nullifierAccount) {
    // First 8 bytes are discriminator, next 4 bytes are vec length (u32 little-endian)
    const vecLength = nullifierAccount.data.readUInt32LE(8);
    console.log('Current nullifier count:', vecLength);
  } else {
    console.log('Nullifier set account not found');
    return;
  }
  
  // Create emergency_reset_nullifiers instruction
  const discriminator = getInstructionDiscriminator('emergency_reset_nullifiers');
  
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },  // payer
      { pubkey: nullifierSetPda, isSigner: false, isWritable: true },          // nullifier_set
    ],
    data: discriminator,
  });
  
  // Create and send transaction
  const transaction = new Transaction().add(instruction);
  
  console.log('Sending emergency_reset_nullifiers transaction...');
  
  try {
    const signature = await sendAndConfirmTransaction(connection, transaction, [walletKeypair], {
      commitment: 'confirmed',
    });
    console.log('✅ Nullifiers reset successfully!');
    console.log('Transaction signature:', signature);
    
    // Verify the reset
    const updatedAccount = await connection.getAccountInfo(nullifierSetPda);
    if (updatedAccount) {
      const newVecLength = updatedAccount.data.readUInt32LE(8);
      console.log('New nullifier count:', newVecLength);
    }
  } catch (error) {
    console.error('Error resetting nullifiers:', error);
    if (error.logs) {
      console.error('Transaction logs:', error.logs);
    }
  }
}

main().catch(console.error);
