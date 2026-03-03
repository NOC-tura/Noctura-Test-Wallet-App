/**
 * Add liquidity to the shielded pool
 */
const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const idl = require('../target/idl/noctura_shield.json');
const fs = require('fs');
const path = require('path');
const BN = require('bn.js');

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
  console.log('  SOL reserve:', poolData.solReserve.toString(), '(' + (Number(poolData.solReserve) / LAMPORTS_PER_SOL) + ' SOL)');
  console.log('  NOC reserve:', poolData.nocReserve.toString(), '(' + (Number(poolData.nocReserve) / 1e6) + ' NOC)');
  console.log('  Enabled:', poolData.enabled);

  // Set proper reserves for testing
  // 10 SOL and 100,000 NOC gives a rate of 10,000 NOC per SOL
  const solReserve = new BN(10 * LAMPORTS_PER_SOL); // 10 SOL
  const nocReserve = new BN(100000 * 1e6);          // 100,000 NOC

  console.log('\nSetting pool reserves to:');
  console.log('  SOL:', 10, 'SOL');
  console.log('  NOC:', 100000, 'NOC');

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
  console.log('\nNew pool state:');
  console.log('  SOL reserve:', (Number(newPoolData.solReserve) / LAMPORTS_PER_SOL), 'SOL');
  console.log('  NOC reserve:', (Number(newPoolData.nocReserve) / 1e6), 'NOC');
  console.log('  Enabled:', newPoolData.enabled);
}

main().catch(console.error);
