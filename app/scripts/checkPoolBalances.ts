import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function main() {
  // Shielded Pool PDA
  const [shieldedPool] = PublicKey.findProgramAddressSync([Buffer.from('shielded-pool')], PROGRAM_ID);
  
  console.log('=== SHIELDED (PRIVATE) POOL ===');
  console.log('PDA:', shieldedPool.toBase58());
  
  try {
    const accountInfo = await connection.getAccountInfo(shieldedPool);
    if (accountInfo) {
      const data = accountInfo.data;
      // Layout: 8 discriminator + 32 admin + 8 sol_reserve + 8 noc_reserve + 8 lp_supply + 2 fee + 1 bump + 1 enabled
      const solReserve = data.readBigUInt64LE(8 + 32);  // offset 40
      const nocReserve = data.readBigUInt64LE(8 + 32 + 8);  // offset 48
      const lpSupply = data.readBigUInt64LE(8 + 32 + 16);  // offset 56
      const feeBps = data.readUInt16LE(8 + 32 + 24);  // offset 64
      
      console.log('SOL Reserve:', Number(solReserve) / 1e9, 'SOL');
      console.log('NOC Reserve:', Number(nocReserve) / 1e6, 'NOC');
      console.log('LP Supply:', Number(lpSupply));
      console.log('Fee:', feeBps, 'bps');
    } else {
      console.log('Account not found');
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  
  // Check transparent pool / vault balances
  console.log('\n=== TRANSPARENT MODE (Vault Balances) ===');
  
  const [solVault] = PublicKey.findProgramAddressSync([Buffer.from('sol-vault')], PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority')], PROGRAM_ID);
  
  console.log('SOL Vault:', solVault.toBase58());
  const solBalance = await connection.getBalance(solVault);
  console.log('SOL in Vault:', solBalance / 1e9, 'SOL');
  
  // NOC token vault - check ATA of vault authority
  try {
    const vaultNocAta = await getAssociatedTokenAddress(NOC_MINT, vaultAuthority, true);
    const tokenAccountInfo = await connection.getAccountInfo(vaultNocAta);
    if (tokenAccountInfo && tokenAccountInfo.data.length >= 72) {
      const amount = tokenAccountInfo.data.readBigUInt64LE(64);
      console.log('NOC Vault ATA:', vaultNocAta.toBase58());
      console.log('NOC in Vault:', Number(amount) / 1e6, 'NOC');
    } else {
      console.log('NOC Vault not initialized');
    }
  } catch (e) {
    console.log('NOC Vault not found or error');
  }
}

main();
