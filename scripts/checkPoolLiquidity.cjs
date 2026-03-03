const { Connection, PublicKey } = require('@solana/web3.js');

async function checkPool() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const programId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from('shielded-pool')], programId);
  
  const acc = await conn.getAccountInfo(poolPda);
  if (!acc) {
    console.log('Pool not found');
    return;
  }
  
  const data = acc.data;
  // Layout: discriminator(8) + admin(32) + sol_reserve(8) + noc_reserve(8) + lp_total_supply(8) + swap_fee_bps(2) + bump(1) + enabled(1)
  const solReserve = data.readBigUInt64LE(40);
  const nocReserve = data.readBigUInt64LE(48);
  const lpTotalSupply = data.readBigUInt64LE(56);
  const swapFeeBps = data.readUInt16LE(64);
  const bump = data[66];
  const enabled = data[67] === 1;
  
  console.log('=== POOL LIQUIDITY ===');
  console.log('Enabled:', enabled);
  console.log('Swap Fee:', swapFeeBps / 100, '%');
  console.log('SOL Reserve:', Number(solReserve) / 1e9, 'SOL');
  console.log('NOC Reserve:', Number(nocReserve) / 1e6, 'NOC');
  console.log('LP Total Supply:', Number(lpTotalSupply));
  console.log('Rate:', (Number(nocReserve) / 1e6) / (Number(solReserve) / 1e9), 'NOC per SOL');
}

checkPool().catch(console.error);
