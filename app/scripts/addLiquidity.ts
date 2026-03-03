// @ts-nocheck
/**
 * Add liquidity to shielded pool and transparent vault
 */

import { readFile } from 'node:fs/promises';
import { Keypair, Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import IDL from '../src/lib/idl/noctura_shield.json';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');  // Devnet NOC mint
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Add 50,000 NOC to each pool
const NOC_AMOUNT = 50_000 * 1_000_000;  // 50,000 NOC in atomic units (6 decimals)

async function loadKeypair(): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR || process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(await readFile(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function derivePDAs() {
  const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global-state')], PROGRAM_ID);
  const [shieldedPool] = PublicKey.findProgramAddressSync([Buffer.from('shielded-pool')], PROGRAM_ID);
  const [vaultToken] = PublicKey.findProgramAddressSync([Buffer.from('vault-token')], PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority')], PROGRAM_ID);
  return { globalState, shieldedPool, vaultToken, vaultAuthority };
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('Loading admin keypair...');
  const admin = await loadKeypair();
  console.log('Admin:', admin.publicKey.toBase58());
  
  const pdas = derivePDAs();
  console.log('Shielded Pool:', pdas.shieldedPool.toBase58());
  console.log('Vault Token:', pdas.vaultToken.toBase58());
  
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as any, PROGRAM_ID, provider);
  
  // Check admin's NOC balance
  const adminTokenAccount = await getAssociatedTokenAddress(NOC_MINT, admin.publicKey);
  let adminNocBalance = 0n;
  try {
    const tokenAccountInfo = await connection.getAccountInfo(adminTokenAccount);
    if (tokenAccountInfo && tokenAccountInfo.data.length >= 72) {
      adminNocBalance = tokenAccountInfo.data.readBigUInt64LE(64);
    }
  } catch (e) {
    console.log('Admin NOC account not found');
  }
  console.log('Admin NOC Balance:', Number(adminNocBalance) / 1e6, 'NOC');
  
  const totalNeeded = BigInt(NOC_AMOUNT * 2);  // 100,000 NOC total
  if (adminNocBalance < totalNeeded) {
    console.error(`Insufficient NOC. Need ${Number(totalNeeded) / 1e6} NOC but only have ${Number(adminNocBalance) / 1e6}`);
    console.log('\nTo get NOC, you need to either:');
    console.log('1. Transfer from another account that has NOC');
    console.log('2. Use a NOC faucet if available');
    console.log('3. Buy NOC on a DEX');
    process.exit(1);
  }
  
  // 1. Add NOC to Shielded Pool
  console.log('\n1. Adding 50,000 NOC to Shielded Pool...');
  try {
    const tx = await program.methods
      .addPoolLiquidity(new BN(0), new BN(NOC_AMOUNT))  // 0 SOL, 50,000 NOC
      .accounts({
        admin: admin.publicKey,
        shieldedPool: pdas.shieldedPool,
      })
      .rpc();
    console.log('Shielded Pool updated:', tx);
  } catch (e: any) {
    console.error('Failed to add to shielded pool:', e.message);
  }
  
  // 2. Transfer NOC to Transparent Vault
  console.log('\n2. Transferring 50,000 NOC to Transparent Vault...');
  
  // First ensure the vault token account exists
  try {
    const vaultAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      NOC_MINT,
      pdas.vaultAuthority,
      true  // allowOwnerOffCurve for PDA
    );
    console.log('Vault Token Account:', vaultAccount.address.toBase58());
    
    // Transfer NOC to vault
    const transferTx = new Transaction().add(
      createTransferInstruction(
        adminTokenAccount,
        vaultAccount.address,
        admin.publicKey,
        BigInt(NOC_AMOUNT),
        [],
        TOKEN_PROGRAM_ID
      )
    );
    
    const sig = await provider.sendAndConfirm(transferTx);
    console.log('Transferred to vault:', sig);
  } catch (e: any) {
    console.error('Failed to transfer to vault:', e.message);
  }
  
  // Verify final state
  console.log('\n=== Final State ===');
  
  // Check shielded pool
  const poolAccount = await connection.getAccountInfo(pdas.shieldedPool);
  if (poolAccount) {
    const data = poolAccount.data;
    const solReserve = data.readBigUInt64LE(8 + 32);
    const nocReserve = data.readBigUInt64LE(8 + 32 + 8);
    console.log('Shielded Pool - SOL:', Number(solReserve) / 1e9, 'SOL');
    console.log('Shielded Pool - NOC:', Number(nocReserve) / 1e6, 'NOC');
  }
  
  // Check vault
  const adminAta = await getAssociatedTokenAddress(NOC_MINT, pdas.vaultAuthority, true);
  try {
    const vaultInfo = await connection.getAccountInfo(adminAta);
    if (vaultInfo && vaultInfo.data.length >= 72) {
      const vaultNoc = vaultInfo.data.readBigUInt64LE(64);
      console.log('Transparent Vault - NOC:', Number(vaultNoc) / 1e6, 'NOC');
    }
  } catch (e) {
    console.log('Could not read vault NOC balance');
  }
  
  console.log('\n✅ Done!');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
