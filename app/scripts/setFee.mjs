#!/usr/bin/env node
/**
 * Script to update the on-chain shield fee using the set_fee instruction.
 * Sets deposit fee to 0% since we collect the 0.25 NOC privacy fee in the app.
 */

import { AnchorProvider, Program, setProvider } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function derivePda(seed, programId) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], programId);
}

async function main() {
  const idlPath = path.resolve(__dirname, '../src/lib/idl/noctura_shield.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  
  const keyPath = process.env.ANCHOR_WALLET || '/Users/banel/config/solana/id.json';
  const secretKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  const rpcUrl = process.env.RPC_URL || clusterApiUrl('testnet');
  const connection = new Connection(rpcUrl, 'confirmed');
  
  const provider = new AnchorProvider(
    connection,
    { publicKey: wallet.publicKey, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs },
    { commitment: 'confirmed' }
  );
  setProvider(provider);
  
  const DEFAULT_PROGRAM = '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz';
  const programId = new PublicKey(process.env.SHIELD_PROGRAM || DEFAULT_PROGRAM);
  const program = new Program(idl, programId, provider);
  
  const [globalState] = derivePda('global-state', programId);
  
  // New fee settings: 0 bps (0%) since we collect 0.25 NOC in the app
  const newShieldFeeBps = Number(process.env.SHIELD_FEE_BPS ?? 0);
  const newPriorityFeeBps = Number(process.env.PRIORITY_FEE_BPS ?? 0);
  
  console.log('⚙️  Updating shield fee');
  console.log('  Program:', programId.toBase58());
  console.log('  Admin wallet:', wallet.publicKey.toBase58());
  console.log('  New shield fee (bps):', newShieldFeeBps);
  console.log('  New priority fee (bps):', newPriorityFeeBps);
  
  // Check current state
  const currentState = await program.account.globalState.fetch(globalState);
  console.log('\n📊 Current on-chain state:');
  console.log('  Admin:', currentState.admin.toBase58());
  console.log('  Fee collector:', currentState.feeCollector.toBase58());
  console.log('  Current shield fee (bps):', currentState.shieldFeeBps);
  console.log('  Current priority fee (bps):', currentState.priorityFeeBps);
  
  if (currentState.admin.toBase58() !== wallet.publicKey.toBase58()) {
    throw new Error(`Not authorized. Admin is ${currentState.admin.toBase58()}, but wallet is ${wallet.publicKey.toBase58()}`);
  }
  
  // Call set_fee
  console.log('\n🔄 Calling set_fee...');
  const sig = await program.methods
    .setFee(newShieldFeeBps, newPriorityFeeBps)
    .accounts({
      admin: wallet.publicKey,
      globalState,
    })
    .signers([wallet])
    .rpc();
  
  console.log('✅ Fee updated! Signature:', sig);
  
  // Verify
  const newState = await program.account.globalState.fetch(globalState);
  console.log('\n📊 New on-chain state:');
  console.log('  Shield fee (bps):', newState.shieldFeeBps);
  console.log('  Priority fee (bps):', newState.priorityFeeBps);
}

main().catch(console.error);
