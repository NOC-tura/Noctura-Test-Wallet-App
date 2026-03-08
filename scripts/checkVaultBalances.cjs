/**
 * Check actual vault balances
 */
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAccount } = require('@solana/spl-token');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // SOL vault
  const [solVault] = PublicKey.findProgramAddressSync([Buffer.from('sol-vault')], PROGRAM_ID);
  console.log('SOL Vault:', solVault.toBase58());
  const solBal = await conn.getBalance(solVault);
  console.log('SOL Vault Balance:', solBal / LAMPORTS_PER_SOL, 'SOL');
  
  // NOC vault token account
  const [nocVaultToken] = PublicKey.findProgramAddressSync([Buffer.from('vault-token'), NOC_MINT.toBuffer()], PROGRAM_ID);
  console.log('\nNOC Vault Token:', nocVaultToken.toBase58());
  
  try {
    const nocAcc = await getAccount(conn, nocVaultToken);
    console.log('NOC Vault Balance:', Number(nocAcc.amount) / 1e6, 'NOC');
  } catch (e) {
    console.log('NOC Vault Token not found or empty');
  }
  
  console.log('\n--- Summary ---');
  console.log('SOL available for withdrawals:', solBal / LAMPORTS_PER_SOL, 'SOL');
}

main().catch(console.error);
