// @ts-nocheck
/**
 * Initialize and seed the shielded pool
 * Run as admin: npx ts-node scripts/initShieldedPool.ts
 */

import { readFile } from 'node:fs/promises';
import { Keypair, Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import IDL from '../target/idl/noctura_shield.json' assert { type: 'json' };

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Pool configuration
const SWAP_FEE_BPS = 30; // 0.3% fee

// Initial liquidity - matching market rate (~283 NOC per SOL)
// SOL price: $85, NOC price: $0.30 → 283 NOC per SOL
const INITIAL_SOL_AMOUNT = 10 * LAMPORTS_PER_SOL; // 10 SOL
const INITIAL_NOC_AMOUNT = 2833 * 1_000_000;      // 2833 NOC (6 decimals) = ~283 NOC per SOL

async function loadKeypair(): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR || process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(await readFile(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function derivePDAs() {
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    PROGRAM_ID
  );
  const [shieldedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('shielded-pool')],
    PROGRAM_ID
  );
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  
  return { globalState, shieldedPool, swapVerifier };
}

async function main() {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log('='.repeat(60));
  console.log('SHIELDED POOL INITIALIZATION');
  console.log('='.repeat(60));
  
  console.log('\n📂 Loading admin keypair...');
  const admin = await loadKeypair();
  console.log('   Admin:', admin.publicKey.toBase58());
  
  const balance = await connection.getBalance(admin.publicKey);
  console.log('   Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance for transactions');
    process.exit(1);
  }
  
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as anchor.Idl, PROGRAM_ID, provider);
  
  const pdas = derivePDAs();
  console.log('\n📍 PDAs:');
  console.log('   Global State:', pdas.globalState.toBase58());
  console.log('   Shielded Pool:', pdas.shieldedPool.toBase58());
  console.log('   Swap Verifier:', pdas.swapVerifier.toBase58());
  
  // Check if pool already exists
  const poolAccount = await connection.getAccountInfo(pdas.shieldedPool);
  
  if (poolAccount) {
    console.log('\n⚠️  Pool already initialized. Checking state...');
    
    // Parse pool data (skip 8-byte discriminator)
    const data = poolAccount.data.slice(8);
    const nocReserve = new BN(data.slice(32, 40), 'le').toString();
    const solReserve = new BN(data.slice(40, 48), 'le').toString();
    const lpSupply = new BN(data.slice(48, 56), 'le').toString();
    const feeBps = data.readUInt16LE(56);
    const enabled = data[58] === 1;
    
    console.log('   NOC Reserve:', (Number(nocReserve) / 1e6).toFixed(2), 'NOC');
    console.log('   SOL Reserve:', (Number(solReserve) / 1e9).toFixed(4), 'SOL');
    console.log('   LP Supply:', lpSupply);
    console.log('   Fee:', feeBps, 'bps');
    console.log('   Enabled:', enabled);
    
    if (Number(solReserve) > 0 && Number(nocReserve) > 0) {
      console.log('\n✅ Pool already seeded. Nothing to do.');
      return;
    }
  } else {
    // Initialize the pool
    console.log('\n🚀 Initializing shielded pool...');
    console.log('   Swap Fee:', SWAP_FEE_BPS, 'bps (', (SWAP_FEE_BPS / 100).toFixed(2), '%)');
    
    try {
      const sig = await program.methods
        .initializeShieldedPool(SWAP_FEE_BPS)
        .accounts({
          admin: admin.publicKey,
          globalState: pdas.globalState,
          shieldedPool: pdas.shieldedPool,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log('   ✅ Pool initialized:', sig);
    } catch (err: any) {
      if (err.message?.includes('already in use')) {
        console.log('   Pool already exists, continuing...');
      } else {
        throw err;
      }
    }
  }
  
  // Seed the pool with initial liquidity
  console.log('\n💰 Seeding pool with initial liquidity...');
  console.log('   SOL:', (INITIAL_SOL_AMOUNT / LAMPORTS_PER_SOL).toFixed(2), 'SOL');
  console.log('   NOC:', (INITIAL_NOC_AMOUNT / 1e6).toFixed(2), 'NOC');
  
  try {
    const seedSig = await program.methods
      .seedShieldedPool(
        new BN(INITIAL_SOL_AMOUNT.toString()),
        new BN(INITIAL_NOC_AMOUNT.toString())
      )
      .accounts({
        admin: admin.publicKey,
        globalState: pdas.globalState,
        shieldedPool: pdas.shieldedPool,
      })
      .rpc();
    
    console.log('   ✅ Pool seeded:', seedSig);
  } catch (err: any) {
    console.error('   ❌ Seeding failed:', err.message);
    throw err;
  }
  
  // Verify final state
  console.log('\n📊 Final pool state:');
  const finalPoolAccount = await connection.getAccountInfo(pdas.shieldedPool);
  if (finalPoolAccount) {
    const data = finalPoolAccount.data.slice(8);
    const nocReserve = new BN(data.slice(32, 40), 'le').toString();
    const solReserve = new BN(data.slice(40, 48), 'le').toString();
    const lpSupply = new BN(data.slice(48, 56), 'le').toString();
    
    console.log('   NOC Reserve:', (Number(nocReserve) / 1e6).toFixed(2), 'NOC');
    console.log('   SOL Reserve:', (Number(solReserve) / 1e9).toFixed(4), 'SOL');
    console.log('   LP Supply:', lpSupply);
    
    // Calculate implied price
    const nocPerSol = Number(nocReserve) / Number(solReserve) * 1000; // NOC per 1 SOL
    console.log('   Implied Price:', nocPerSol.toFixed(2), 'NOC per SOL');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ SHIELDED POOL READY');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
