/**
 * Fix the shielded pool reserves to match market rate
 * Market rate: ~283 NOC per SOL (SOL=$85, NOC=$0.30)
 */
const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const idl = require('../target/idl/noctura_shield.json');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Target ratio: 283 NOC per SOL (based on SOL=$85, NOC=$0.30)
const TARGET_NOC_PER_SOL = 283;
const NOC_DECIMALS = 6;

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
  const currentSol = Number(poolData.solReserve.toString()) / LAMPORTS_PER_SOL;
  const currentNoc = Number(poolData.nocReserve.toString()) / Math.pow(10, NOC_DECIMALS);
  const currentRatio = currentNoc / currentSol;
  
  console.log('\nCurrent pool state:');
  console.log('  SOL reserve:', currentSol.toFixed(4), 'SOL');
  console.log('  NOC reserve:', currentNoc.toFixed(2), 'NOC');
  console.log('  Current ratio:', currentRatio.toFixed(2), 'NOC/SOL');
  console.log('  Target ratio:', TARGET_NOC_PER_SOL, 'NOC/SOL');
  console.log('  Enabled:', poolData.enabled);

  // Calculate new reserves - keep SOL the same, reduce NOC
  const newSolAmount = currentSol * LAMPORTS_PER_SOL; // Keep same SOL
  const newNocAmount = currentSol * TARGET_NOC_PER_SOL * Math.pow(10, NOC_DECIMALS); // Adjust NOC

  console.log('\nNew reserves (fixing ratio):');
  console.log('  SOL:', currentSol.toFixed(4), 'SOL (unchanged)');
  console.log('  NOC:', (newNocAmount / Math.pow(10, NOC_DECIMALS)).toFixed(2), 'NOC');
  console.log('  New ratio:', TARGET_NOC_PER_SOL, 'NOC/SOL');

  // Confirm before proceeding
  console.log('\n⚠️  This will change the pool reserves!');
  console.log('Press Ctrl+C to cancel or wait 5 seconds to continue...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\nUpdating pool reserves...');

  const tx = await program.methods
    .setPoolReserves(
      new anchor.BN(Math.floor(newSolAmount).toString()),
      new anchor.BN(Math.floor(newNocAmount).toString())
    )
    .accounts({
      admin: authority.publicKey,
      shieldedPool: shieldedPool,
    })
    .signers([authority])
    .rpc();

  console.log('Transaction:', tx);

  // Verify
  const newPoolData = await program.account.shieldedPool.fetch(shieldedPool);
  const finalSol = Number(newPoolData.solReserve.toString()) / LAMPORTS_PER_SOL;
  const finalNoc = Number(newPoolData.nocReserve.toString()) / Math.pow(10, NOC_DECIMALS);
  
  console.log('\n✅ Pool updated:');
  console.log('  SOL reserve:', finalSol.toFixed(4), 'SOL');
  console.log('  NOC reserve:', finalNoc.toFixed(2), 'NOC');
  console.log('  Ratio:', (finalNoc / finalSol).toFixed(2), 'NOC/SOL');
  console.log('  Enabled:', newPoolData.enabled);
}

main().catch(console.error);
