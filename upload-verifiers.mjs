#!/usr/bin/env node
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read keypair from Solana CLI default location
const keypairPath = process.env.HOME + '/.config/solana/id.json';
console.log('Loading keypair from:', keypairPath);
const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
console.log('Admin pubkey:', adminKeypair.publicKey.toBase58());

// Load verifier keys
const vkeysDir = join(__dirname, 'app/public');
console.log('Loading verifier keys from:', vkeysDir);

const depositVkey = JSON.parse(fs.readFileSync(join(vkeysDir, 'deposit.vkey.json'), 'utf-8'));
const withdrawVkey = JSON.parse(fs.readFileSync(join(vkeysDir, 'withdraw.vkey.json'), 'utf-8'));
const transferVkey = JSON.parse(fs.readFileSync(join(vkeysDir, 'transfer.vkey.json'), 'utf-8'));

console.log('\n✅ All verifier keys loaded');
console.log('- Deposit vkey loaded');
console.log('- Withdraw vkey loaded');
console.log('- Transfer vkey loaded');

// Dynamic import of the shield program module
const { uploadVerifierKeys } = await import('./app/dist/assets/index-n3CD6Kmz.js');

console.log('\n📤 Uploading verifiers to on-chain program...');

try {
  const result = await uploadVerifierKeys(adminKeypair, depositVkey, withdrawVkey, transferVkey);
  console.log('\n✅ Upload complete!');
  console.log('Deposit signature:', result.deposit);
  console.log('Withdraw signature:', result.withdraw);
  console.log('Transfer signature:', result.transfer);
  console.log('\n🎉 All verifiers are now active on-chain!');
} catch (error) {
  console.error('\n❌ Upload failed:', error.message);
  process.exit(1);
}
