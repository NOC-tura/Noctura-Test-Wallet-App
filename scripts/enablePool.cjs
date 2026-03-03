/**
 * Enable the shielded pool by setting reserves
 * This will set enabled = true
 */
const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const idl = require('../target/idl/noctura_shield.json');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

async function main() {
  // Load authority keypair
  const keypairPath = path.join(process.env.HOME, '.config', 'solana', 'noctura', 'wallet.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));
  
  console.log('Authority:', authority.publicKey.toBase58());

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // Get shielded pool PDA
  const [shieldedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('shielded-pool')],
    PROGRAM_ID
  );

  console.log('Shielded Pool:', shieldedPool.toBase58());

  // Check current state
  const poolData = await program.account.shieldedPool.fetch(shieldedPool);
  console.log('\nCurrent pool state:');
  console.log('  SOL reserve:', poolData.solReserve.toString() / 1e9);
  console.log('  NOC reserve:', poolData.nocReserve.toString() / 1e6);
  console.log('  Enabled:', poolData.enabled);

  if (poolData.enabled) {
    console.log('\nPool is already enabled!');
    return;
  }

  // Enable the pool by calling setPoolReserves with current values
  const solReserve = poolData.solReserve;
  const nocReserve = poolData.nocReserve;

  console.log('\nEnabling pool with setPoolReserves...');

  const tx = await program.methods
    .setPoolReserves(solReserve, nocReserve)
    .accounts({
      admin: authority.publicKey,
      shieldedPool: shieldedPool,
    })
    .signers([authority])
    .rpc();

  console.log('Transaction:', tx);

  // Verify
  const newPoolData = await program.account.shieldedPool.fetch(shieldedPool);
  console.log('\nPool enabled:', newPoolData.enabled);
}

main().catch(console.error);
