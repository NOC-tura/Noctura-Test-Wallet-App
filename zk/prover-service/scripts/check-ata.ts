import { Connection, PublicKey } from '@solana/web3.js';
import * as spl from '@solana/spl-token';

async function main() {
  const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
  const mint = new PublicKey('EvPfUBA97CWnKP6apRqmJYSzudonTCZCzH5tQZ7fk649');
  const owner = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
  const ata = spl.getAssociatedTokenAddressSync(mint, owner);
  console.log('ATA', ata.toBase58());
  const account = await spl.getAccount(connection, ata);
  console.log('Account amount', account.amount.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
