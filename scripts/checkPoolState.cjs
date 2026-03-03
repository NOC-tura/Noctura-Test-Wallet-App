const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const [shieldedPool] = PublicKey.findProgramAddressSync([Buffer.from('shielded-pool')], PROGRAM_ID);
  const [swapVerifier] = PublicKey.findProgramAddressSync([Buffer.from('swap-verifier')], PROGRAM_ID);
  
  console.log('Shielded Pool PDA:', shieldedPool.toBase58());
  console.log('Swap Verifier PDA:', swapVerifier.toBase58());
  
  const poolInfo = await connection.getAccountInfo(shieldedPool);
  console.log('\nPool exists:', !!poolInfo);
  if (poolInfo) {
    const data = poolInfo.data.slice(8); // Skip discriminator
    // Layout: admin(32) + sol_reserve(8) + noc_reserve(8) + lp_total_supply(8) + swap_fee_bps(2) + bump(1) + enabled(1)
    const solReserve = new BN(data.slice(32, 40), 'le').toString();
    const nocReserve = new BN(data.slice(40, 48), 'le').toString();
    const enabled = data[59] === 1;
    console.log('Pool reserves: SOL=' + (Number(solReserve)/1e9) + ', NOC=' + (Number(nocReserve)/1e6));
    console.log('Pool enabled:', enabled);
  }
  
  const verifierInfo = await connection.getAccountInfo(swapVerifier);
  console.log('\nSwap verifier exists:', !!verifierInfo);
  if (verifierInfo) {
    const keyLength = verifierInfo.data.slice(8, 12).readUInt32LE(0);
    console.log('Verifier key length:', keyLength, 'bytes');
  }
}

main().catch(console.error);
