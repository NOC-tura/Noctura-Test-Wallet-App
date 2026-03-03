import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { readFileSync } from 'fs';

const IDL = JSON.parse(readFileSync('./src/lib/idl/noctura_shield.json', 'utf-8'));

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NEW_NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const OLD_NOC_MINT = new PublicKey('2aFVaSy29RZ5V7D6cPBf59sVwJB34nETF6piwjT7AYUb');

// Shielded Pool PDAs
const [newShieldedPoolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('shielded_pool'), NEW_NOC_MINT.toBuffer()],
  PROGRAM_ID
);

const [oldShieldedPoolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('shielded_pool'), OLD_NOC_MINT.toBuffer()],
  PROGRAM_ID
);

async function main() {
  const provider = new anchor.AnchorProvider(connection as any, {} as any, {});
  const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);

  console.log('=== NEW SHIELDED POOL (new mint) ===');
  console.log('PDA:', newShieldedPoolPda.toBase58());
  try {
    const shieldedPool = await program.account.shieldedPool.fetch(newShieldedPoolPda) as any;
    console.log('SOL Reserve:', Number(shieldedPool.solReserve) / 1e9, 'SOL');
    console.log('NOC Reserve:', Number(shieldedPool.nocReserve) / 1e6, 'NOC');
    console.log('Fee:', Number(shieldedPool.feeBps), 'bps');
    console.log('Enabled:', shieldedPool.enabled);
  } catch (e: any) {
    console.log('Not initialized:', e.message);
  }

  console.log('\n=== OLD SHIELDED POOL (old mint) ===');
  console.log('PDA:', oldShieldedPoolPda.toBase58());
  try {
    const shieldedPool = await program.account.shieldedPool.fetch(oldShieldedPoolPda) as any;
    console.log('SOL Reserve:', Number(shieldedPool.solReserve) / 1e9, 'SOL');
    console.log('NOC Reserve:', Number(shieldedPool.nocReserve) / 1e6, 'NOC');
    console.log('Fee:', Number(shieldedPool.feeBps), 'bps');
    console.log('Enabled:', shieldedPool.enabled);
  } catch (e: any) {
    console.log('Not initialized:', e.message);
  }
}

main().catch(console.error);
