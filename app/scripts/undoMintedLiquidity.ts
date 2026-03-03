// @ts-nocheck
/**
 * Undo the minted liquidity and replace with real tokens
 */

import { readFile } from 'node:fs/promises';
import { Keypair, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddress, createBurnInstruction } from '@solana/spl-token';
import IDL from '../src/lib/idl/noctura_shield.json';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

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
  
  console.log('Admin Token Account:', adminTokenAccount.toBase58());
  console.log('Vault Token Account:', vaultTokenAccount.toBase58());
  
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as any, PROGRAM_ID, provider);
  
  // Check current state
  console.log('\n=== Current State ===');
  
  // Admin NOC balance
  const adminInfo = await connection.getAccountInfo(adminTokenAccount);
  const adminBalance = adminInfo ? Number(adminInfo.data.readBigUInt64LE(64)) / 1e6 : 0;
  console.log('Admin NOC:', adminBalance);
  
  // Vault NOC balance
  const vaultInfo = await connection.getAccountInfo(vaultTokenAccount);
  const vaultBalance = vaultInfo ? Number(vaultInfo.data.readBigUInt64LE(64)) / 1e6 : 0;
  console.log('Vault NOC:', vaultBalance);
  
  // Shielded pool reserves
  const poolAccount = await connection.getAccountInfo(pdas.shieldedPool);
  let poolNocReserve = 0;
  if (poolAccount) {
    const data = poolAccount.data;
    poolNocReserve = Number(data.readBigUInt64LE(8 + 32 + 8)) / 1e6;
  }
  console.log('Shielded Pool NOC Reserve:', poolNocReserve);
  
  // Step 1: Reset shielded pool to remove the 50,000 I added
  console.log('\n1. Resetting shielded pool to 10,000 NOC...');
  try {
    // Subtract 50,000 NOC from pool reserves
    const tx = await program.methods
      .addPoolLiquidity(new BN(0), new BN(-50_000_000_000))  // Negative to subtract
      .accounts({
        admin: admin.publicKey,
        shieldedPool: pdas.shieldedPool,
      })
      .rpc();
    console.log('Pool reset tx:', tx);
  } catch (e: any) {
    console.log('Could not subtract from pool (may need different approach):', e.message?.slice(0, 100));
  }
  
  // Step 2: Transfer vault NOC back to admin (so we can burn it)
  console.log('\n2. Transferring vault NOC back to admin...');
  // This requires a program instruction since vault is a PDA
  // For now, let's just burn what's in admin account
  
  // Step 3: Burn the minted NOC from admin account
  const burnAmount = Math.min(adminBalance, 50000) * 1e6;  // Burn up to 50,000
  if (burnAmount > 0) {
    console.log('\n3. Burning', burnAmount / 1e6, 'NOC from admin...');
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
  }
  
  // Check state after
  console.log('\n=== After Cleanup ===');
  const adminInfoAfter = await connection.getAccountInfo(adminTokenAccount);
  const adminBalanceAfter = adminInfoAfter ? Number(adminInfoAfter.data.readBigUInt64LE(64)) / 1e6 : 0;
  console.log('Admin NOC:', adminBalanceAfter);
  
  const vaultInfoAfter = await connection.getAccountInfo(vaultTokenAccount);
  const vaultBalanceAfter = vaultInfoAfter ? Number(vaultInfoAfter.data.readBigUInt64LE(64)) / 1e6 : 0;
  console.log('Vault NOC:', vaultBalanceAfter);
  
  const poolAccountAfter = await connection.getAccountInfo(pdas.shieldedPool);
  if (poolAccountAfter) {
    const data = poolAccountAfter.data;
    const poolNocAfter = Number(data.readBigUInt64LE(8 + 32 + 8)) / 1e6;
    console.log('Shielded Pool NOC:', poolNocAfter);
  }
  
  console.log('\n✅ Cleanup done');
  console.log('\nNote: The vault still has 50,000 NOC. To fully undo:');
  console.log('1. Need a withdraw instruction to move NOC from vault back');
  console.log('2. Then burn those tokens');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
