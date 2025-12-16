import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const programId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
  const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
  
  const [verifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('verifier')],
    programId
  );
  
  console.log('Verifier PDA:', verifierPda.toBase58());
  
  const accountInfo = await connection.getAccountInfo(verifierPda);
  if (!accountInfo) {
    console.log('Account not found');
    return;
  }
  
  console.log('Account data length:', accountInfo.data.length);
  
  // Skip 8 byte discriminator, then read verifying_key vec
  const data = accountInfo.data.slice(8);
  const vecLen = data.readUInt32LE(0);
  console.log('Verifying key length:', vecLen);
  
  if (vecLen > 0) {
    const vkBytes = data.slice(4, 4 + vecLen);
    console.log('VK alpha_g1 (64 bytes):', vkBytes.slice(0, 64).toString('hex'));
    console.log('VK beta_g2 first 32 bytes:', vkBytes.slice(64, 96).toString('hex'));
    console.log('VK beta_g2 second 32 bytes:', vkBytes.slice(96, 128).toString('hex'));
  }
}

main().catch(console.error);
