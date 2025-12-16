import { Connection, PublicKey } from '@solana/web3.js';
import { AIRDROP_LAMPORTS, AUTHORITY, NOC_MINT, RPC_ENDPOINT } from '../src/config.js';
import { sendNocAirdrop } from '../src/airdrop.js';

async function main(destination: string) {
  if (!destination) {
    console.error('Usage: tsx scripts/debug-airdrop.ts <destination>');
    process.exit(1);
  }

  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const destKey = new PublicKey(destination);

  try {
    const signature = await sendNocAirdrop(connection, AUTHORITY, new PublicKey(NOC_MINT), destKey, AIRDROP_LAMPORTS);
    console.log('Airdrop signature:', signature);
  } catch (err) {
    console.error('Airdrop failed:', err);
    process.exit(1);
  }
}

main(process.argv[2]).catch((err) => {
  console.error(err);
  process.exit(1);
});
