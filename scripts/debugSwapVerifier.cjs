/**
 * Debug swap verifier key
 */
const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const SOLANA_RPC = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  
  console.log('Swap Verifier PDA:', swapVerifier.toBase58());
  
  const info = await connection.getAccountInfo(swapVerifier);
  if (!info) {
    console.log('❌ Swap verifier account not found');
    return;
  }
  
  console.log('Account size:', info.data.length, 'bytes');
  
  // VerifierAccount layout: discriminator(8) + verifying_key Vec<u8>(4 + data)
  const discriminator = info.data.slice(0, 8);
  const keyLen = info.data.slice(8, 12).readUInt32LE(0);
  const keyData = info.data.slice(12, 12 + keyLen);
  
  console.log('Discriminator:', Array.from(discriminator));
  console.log('Verifier key length:', keyLen, 'bytes');
  console.log('Key data first 64 bytes (alpha_g1):', Array.from(keyData.slice(0, 64)));
  
  // Load expected vkey
  const vkeyPath = '/Users/banel/Noctura-Wallet/zk/keys/swap.vkey.json';
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf-8'));
  
  console.log('\n--- Expected from swap.vkey.json ---');
  console.log('nPublic:', vkey.nPublic);
  console.log('IC.length:', vkey.IC.length);
  
  // The expected size is:
  // alpha_g1(64) + beta_g2(128) + gamma_g2(128) + delta_g2(128) + IC(64 * IC.length)
  const expectedSize = 64 + 128 + 128 + 128 + 64 * vkey.IC.length;
  console.log('Expected key size:', expectedSize, 'bytes');
  console.log('Actual key size:', keyLen, 'bytes');
  console.log('Match:', expectedSize === keyLen ? '✅' : '❌');
}

main().catch(console.error);
