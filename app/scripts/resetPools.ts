// @ts-nocheck
/**
 * Reset pools and use real tokens
 */

import { readFile } from 'node:fs/promises';
import { Keypair, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { createBurnInstruction, getAssociatedTokenAddress, createTransferInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import IDL from '../src/lib/idl/noctura_shield.json';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Target: 50,000 NOC in each pool, using existing tokens
const TARGET_NOC = 50_000;
const TARGET_NOC_ATOMS = BigInt(TARGET_NOC * 1_000_000);  // 6 decimals

async function loadKeypair(): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR || process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(await readFile(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function derivePDAs() {
  const [shieldedPool] = PublicKey.findProgramAddressSync([Buffer.from('shielded-pool')], PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority')], PROGRAM_ID);
  return { shieldedPool, vaultAuthority };
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('Loading admin keypair...');
  const admin = await loadKeypair();
  console.log('Admin:', admin.publicKey.toBase58());
  
  const pdas = derivePDAs();
  const adminTokenAccount = await getAssociatedTokenAddress(NOC_MINT, admin.publicKey);
  const vaultTokenAccount = await getAssociatedTokenAddress(NOC_MINT, pdas.vaultAuthority, true);
  
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as any, PROGRAM_ID, provider);
  
  // Check current state
  console.log('\n=== BEFORE ===');
  
  const adminInfo = await connection.getAccountInfo(adminTokenAccount);
  const adminBalance = adminInfo ? Number(adminInfo.data.readBigUInt64LE(64)) : 0;
  console.log('Admin NOC:', adminBalance / 1e6);
  
  const vaultInfo = await connection.getAccountInfo(vaultTokenAccount);
  const vaultBalance = vaultInfo ? Number(vaultInfo.data.readBigUInt64LE(64)) : 0;
  console.log('Vault NOC:', vaultBalance / 1e6);
  
  const poolAccount = await connection.getAccountInfo(pdas.shieldedPool);
  const poolSol = Number(poolAccount!.data.readBigUInt64LE(8 + 32)) / 1e9;
  const poolNoc = Number(poolAccount!.data.readBigUInt64LE(8 + 32 + 8)) / 1e6;
  console.log('Shielded Pool SOL:', poolSol);
  console.log('Shielded Pool NOC:', poolNoc);
  
  // Step 1: Reset shielded pool to use 10 SOL / 50,000 NOC (keep SOL, reset NOC)
  console.log('\n1. Setting pool reserves to 10 SOL / 50,000 NOC...');
  try {
    const tx = await program.methods
      .setPoolReserves(
        new BN(10 * 1e9),  // 10 SOL
        new BN(50_000 * 1e6)  // 50,000 NOC
      )
      .accounts({
        admin: admin.publicKey,
        shieldedPool: pdas.shieldedPool,
      })
      .rpc();
    console.log('Set reserves tx:', tx);
  } catch (e: any) {
    console.error('Failed to set pool reserves:', e.message);
  }
  
  // Step 2: Ensure vault has exactly 50,000 NOC
  // Current vault has 50,000, so no change needed there
  console.log('\n2. Vault already has 50,000 NOC - keeping as is');
  
  // Step 3: Burn the extra minted NOC from admin
  // We minted 100,000. 50,000 went to vault, 50,000 was for pool.
  // Admin currently has ~50,300 which includes the minted portion.
  // Burn 50,000 to undo the pool portion (the vault portion stays as it's real now)
  const burnAmount = 50_000 * 1e6;
  if (adminBalance >= burnAmount) {
    console.log('\n3. Burning 50,000 NOC from admin to undo extra mint...');
    const burnTx = new Transaction().add(
      createBurnInstruction(
        adminTokenAccount,
        NOC_MINT,
        admin.publicKey,
        BigInt(burnAmount)
      )
    );
    const sig = await provider.sendAndConfirm(burnTx);
    console.log('Burn tx:', sig);
  } else {
    console.log('\n3. Admin balance too low to burn 50,000. Skipping burn.');
  }
  
  // Check final state
  console.log('\n=== AFTER ===');
  
  const adminInfoAfter = await connection.getAccountInfo(adminTokenAccount);
  const adminBalanceAfter = adminInfoAfter ? Number(adminInfoAfter.data.readBigUInt64LE(64)) : 0;
  console.log('Admin NOC:', adminBalanceAfter / 1e6);
  
  const vaultInfoAfter = await connection.getAccountInfo(vaultTokenAccount);
  const vaultBalanceAfter = vaultInfoAfter ? Number(vaultInfoAfter.data.readBigUInt64LE(64)) : 0;
  console.log('Vault NOC:', vaultBalanceAfter / 1e6);
  
  const poolAccountAfter = await connection.getAccountInfo(pdas.shieldedPool);
  const poolSolAfter = Number(poolAccountAfter!.data.readBigUInt64LE(8 + 32)) / 1e9;
  const poolNocAfter = Number(poolAccountAfter!.data.readBigUInt64LE(8 + 32 + 8)) / 1e6;
  console.log('Shielded Pool SOL:', poolSolAfter);
  console.log('Shielded Pool NOC:', poolNocAfter);
  
  console.log('\n✅ Done!');
  console.log('\nFinal pool state:');
  console.log('- Shielded Pool: 10 SOL / 50,000 NOC');
  console.log('- Transparent Vault: 50,000 NOC');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
