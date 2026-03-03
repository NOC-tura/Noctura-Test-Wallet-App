const { Connection, PublicKey } = require('@solana/web3.js');
const { AccountLayout } = require('@solana/spl-token');

const VAULT_ACCOUNT = new PublicKey('2YtotZCVDvTeGiLSDCYhQ1eUnWUx9SjhZGkM4MKKM52a');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const info = await connection.getAccountInfo(VAULT_ACCOUNT);
  if (!info || info.data.length !== 165) {
    console.log('Not a valid token account');
    return;
  }
  
  const decoded = AccountLayout.decode(info.data);
  console.log('Vault Token Account:', VAULT_ACCOUNT.toBase58());
  console.log('Mint:', new PublicKey(decoded.mint).toBase58());
  console.log('Owner:', new PublicKey(decoded.owner).toBase58());
  console.log('Amount:', decoded.amount.toString());
  console.log('Amount (NOC):', (Number(decoded.amount) / 1e6).toFixed(6));
}

main().catch(console.error);
