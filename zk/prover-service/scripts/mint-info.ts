import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

async function main() {
  const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
  const mint = await getMint(connection, new PublicKey('EvPfUBA97CWnKP6apRqmJYSzudonTCZCzH5tQZ7fk649'));
  console.log({ decimals: mint.decimals, supply: mint.supply.toString() });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
