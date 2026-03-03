const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');

const VAULT = new PublicKey('2YtotZCVDvTeGiLSDCYhQ1eUnWUx9SjhZGkM4MKKM52a');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const AMOUNT = 100_000 * 1e6; // 100,000 NOC

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const keypairPath = process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  console.log('Authority:', authority.publicKey.toBase58());
  
  const authorityAta = getAssociatedTokenAddressSync(NOC_MINT, authority.publicKey);
  console.log('Authority ATA:', authorityAta.toBase58());
  console.log('Vault:', VAULT.toBase58());
  console.log('Funding with:', AMOUNT / 1e6, 'NOC');
  
  const tx = new Transaction().add(
    createTransferInstruction(
      authorityAta,
      VAULT,
      authority.publicKey,
      BigInt(AMOUNT),
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log('Funded vault! TX:', sig);
}

main().catch(console.error);
