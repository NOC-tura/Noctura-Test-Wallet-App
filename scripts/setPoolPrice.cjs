/**
 * Set pool reserves for NOC = $0.30 price
 * SOL = $129, NOC = $0.30 => 430 NOC per SOL
 */
const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const idl = require('../target/idl/noctura_shield.json');
const fs = require('fs');
const path = require('path');
const BN = require('bn.js');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

async function main() {
  const keypairPath = path.join(process.env.HOME, '.config', 'solana', 'noctura', 'wallet.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));
  
  console.log('Authority:', authority.publicKey.toBase58());

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  const [shieldedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('shielded-pool')],
    PROGRAM_ID
  );

  const poolData = await program.account.shieldedPool.fetch(shieldedPool);
  console.log('\nCurrent pool:');
  console.log('  SOL:', (Number(poolData.solReserve) / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
  console.log('  NOC:', (Number(poolData.nocReserve) / 1e6).toFixed(2), 'NOC');
  const currentRate = Number(poolData.nocReserve) / Number(poolData.solReserve) * (LAMPORTS_PER_SOL / 1e6);
  console.log('  Rate:', currentRate.toFixed(2), 'NOC per SOL');

  // Target: NOC = $0.30, SOL = $129 => 430 NOC per SOL
  // Set 20 SOL : 8600 NOC (430 * 20)
  const solReserve = new BN(20 * LAMPORTS_PER_SOL); // 20 SOL
  const nocReserve = new BN(8600 * 1e6);            // 8600 NOC

  console.log('\nSetting to $0.30 NOC price:');
  console.log('  SOL:', 20, 'SOL');
  console.log('  NOC:', 8600, 'NOC');
  console.log('  Rate: 430 NOC per SOL');
  console.log('  NOC price: $' + (129 / 430).toFixed(2));

  const tx = await program.methods
    .setPoolReserves(solReserve, nocReserve)
    .accounts({
      admin: authority.publicKey,
      shieldedPool: shieldedPool,
    })
    .signers([authority])
    .rpc();

  console.log('\nTransaction:', tx);

  const newPoolData = await program.account.shieldedPool.fetch(shieldedPool);
  console.log('\n✅ New pool:');
  console.log('  SOL:', (Number(newPoolData.solReserve) / LAMPORTS_PER_SOL), 'SOL');
  console.log('  NOC:', (Number(newPoolData.nocReserve) / 1e6), 'NOC');
  const newRate = Number(newPoolData.nocReserve) / Number(newPoolData.solReserve) * (LAMPORTS_PER_SOL / 1e6);
  console.log('  Rate:', newRate.toFixed(2), 'NOC per SOL');
  console.log('  NOC price: $' + (129 / newRate).toFixed(2));
}

main().catch(console.error);
