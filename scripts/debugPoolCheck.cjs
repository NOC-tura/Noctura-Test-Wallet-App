/**
 * Debug script to test shouldUseShieldedPool() conditions
 */
const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const SOLANA_RPC = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  
  // Derive PDAs exactly as app does
  const [shieldedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('shielded-pool')],
    PROGRAM_ID
  );
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  
  console.log('=== Shielded Pool Debug ===');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Shielded Pool PDA:', shieldedPool.toBase58());
  console.log('Swap Verifier PDA:', swapVerifier.toBase58());
  
  // Check pool
  console.log('\n--- Pool Check ---');
  const poolInfo = await connection.getAccountInfo(shieldedPool);
  if (!poolInfo) {
    console.log('❌ Pool account does NOT exist');
    console.log('=> shouldUseShieldedPool() will return FALSE');
    return;
  }
  
  console.log('✅ Pool account exists');
  const data = poolInfo.data.slice(8); // Skip discriminator
  // Layout: admin(32) + sol_reserve(8) + noc_reserve(8) + lp_total_supply(8) + swap_fee_bps(2) + bump(1) + enabled(1)
  const solReserve = BigInt(new BN(data.slice(32, 40), 'le').toString());
  const nocReserve = BigInt(new BN(data.slice(40, 48), 'le').toString());
  const enabled = data[59] === 1;
  
  console.log('  NOC Reserve:', nocReserve.toString(), `(${Number(nocReserve) / 1e6} NOC)`);
  console.log('  SOL Reserve:', solReserve.toString(), `(${Number(solReserve) / 1e9} SOL)`);
  console.log('  Enabled:', enabled);
  
  const poolAvailable = enabled && nocReserve > 0n && solReserve > 0n;
  console.log('  isShieldedPoolAvailable():', poolAvailable);
  
  if (!poolAvailable) {
    console.log('❌ Pool not available (enabled=false or zero reserves)');
    console.log('=> shouldUseShieldedPool() will return FALSE');
    return;
  }
  
  // Check swap verifier
  console.log('\n--- Swap Verifier Check ---');
  const verifierInfo = await connection.getAccountInfo(swapVerifier);
  if (!verifierInfo) {
    console.log('❌ Swap verifier does NOT exist');
    console.log('=> shouldUseShieldedPool() will return FALSE');
    return;
  }
  
  console.log('✅ Swap verifier exists');
  const keyLength = verifierInfo.data.slice(8, 12).readUInt32LE(0);
  console.log('  Verifier key length:', keyLength, 'bytes');
  
  // Final verdict
  console.log('\n=== RESULT ===');
  console.log('✅ shouldUseShieldedPool() should return TRUE');
  console.log('=> App should use TRUE PRIVATE swap mode');
}

main().catch(console.error);
