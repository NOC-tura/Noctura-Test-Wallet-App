const { Connection, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

const IDL = JSON.parse(fs.readFileSync('./src/lib/idl/noctura_shield.json', 'utf-8'));
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

async function main() {
  // The seed is just "shielded-pool" without mint
  const [shieldedPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('shielded-pool')], 
    PROGRAM_ID
  );

  const provider = new anchor.AnchorProvider(connection, {}, {});
  const program = new anchor.Program(IDL, PROGRAM_ID, provider);

  console.log('=== SHIELDED POOL ===');
  console.log('PDA:', shieldedPoolPda.toBase58());
  try {
    const p = await program.account.shieldedPool.fetch(shieldedPoolPda);
    console.log('SOL Reserve:', Number(p.solReserve)/1e9, 'SOL');
    console.log('NOC Reserve:', Number(p.nocReserve)/1e6, 'NOC');
    console.log('Fee:', Number(p.feeBps), 'bps');
    console.log('Enabled:', p.enabled);
  } catch(e) {
    console.log('Not found:', e.message);
  }
}

main().catch(console.error);
