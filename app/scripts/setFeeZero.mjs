#!/usr/bin/env node
/**
 * Script to set on-chain deposit fee to 0%
 * The 0.25 NOC privacy fee is now collected off-chain during withdrawals/transfers
 */

import { AnchorProvider, Program, setProvider } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function derivePda(seed, programId) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], programId);
}

const DEFAULT_PROGRAM = '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz';

async function main() {
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME, 'config/solana/id.json');
  const rawKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  
  const cluster = process.env.SOLANA_CLUSTER || 'https://api.testnet.solana.com';
  const connection = new Connection(cluster, 'confirmed');
  const provider = new AnchorProvider(connection, { publicKey: adminKeypair.publicKey, signAllTransactions: (txs) => txs.map(tx => { tx.sign([adminKeypair]); return tx; }), signTransaction: (tx) => { tx.sign([adminKeypair]); return tx; } }, { commitment: 'confirmed' });
  setProvider(provider);

  // Load IDL
  const idlPath = path.join(__dirname, '../../target/idl/noctura_shield.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  
  const programId = new PublicKey(process.env.SHIELD_PROGRAM || DEFAULT_PROGRAM);
  const program = new Program(idl, programId, provider);

  const [globalState] = derivePda('global-state', programId);

  console.log('⚙️  Setting on-chain fee to 0%');
  console.log('  Program:', programId.toBase58());
  console.log('  Admin:', adminKeypair.publicKey.toBase58());
  console.log('  Global state:', globalState.toBase58());

  // Check current fee
  const globalAccount = await program.account.globalState.fetch(globalState);
  console.log('  Current shield fee (bps):', globalAccount.shieldFeeBps);
  console.log('  Current priority fee (bps):', globalAccount.priorityFeeBps);

  if (globalAccount.shieldFeeBps === 0 && globalAccount.priorityFeeBps === 0) {
    console.log('ℹ️  Fees are already set to 0%');
    return;
  }

  // Set fee to 0
  try {
    const sig = await program.methods
      .setFee(0, 0)
      .accounts({
        admin: adminKeypair.publicKey,
        globalState,
      })
      .signers([adminKeypair])
      .rpc();

    console.log('✅  Fees set to 0%');
    console.log('  Transaction:', sig);

    // Verify
    const updatedAccount = await program.account.globalState.fetch(globalState);
    console.log('  New shield fee (bps):', updatedAccount.shieldFeeBps);
    console.log('  New priority fee (bps):', updatedAccount.priorityFeeBps);
  } catch (err) {
    console.error('❌  Failed to set fee:', err.message);
    throw err;
  }
}

main().catch(console.error);
