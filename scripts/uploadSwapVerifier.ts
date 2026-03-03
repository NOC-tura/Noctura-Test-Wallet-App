// @ts-nocheck
/**
 * Upload the swap verifier key to the shield program
 * Must be run by the program admin
 * 
 * Usage: npx ts-node scripts/uploadSwapVerifier.ts
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Keypair, Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import IDL from '../target/idl/noctura_shield.json' assert { type: 'json' };

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

interface VerifierKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string]];
  vk_gamma_2: [[string, string], [string, string], [string]];
  vk_delta_2: [[string, string], [string, string], [string]];
  IC: [string, string, string][];
}

// Constants for BN128 curve
const G1_BYTES = 64; // 2 x 32 bytes (x, y)
const G2_BYTES = 128; // 4 x 32 bytes (x.c1, x.c0, y.c1, y.c0)

function bigintToBytesBE(value: bigint, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error(`Field element ${value} does not fit in ${length} bytes`);
  }
  return bytes;
}

function serializeG1Point(point: [string, string, string]): Uint8Array {
  const x = bigintToBytesBE(BigInt(point[0]));
  const y = bigintToBytesBE(BigInt(point[1]));
  const result = new Uint8Array(G1_BYTES);
  result.set(x, 0);
  result.set(y, 32);
  return result;
}

function serializeG2Point(point: [[string, string], [string, string], [string]]): Uint8Array {
  // snarkjs format: [[x.c0, x.c1], [y.c0, y.c1], [z]]
  // EIP-196/Solana format: [x.c1, x.c0, y.c1, y.c0] each 32 bytes BE
  const xc0 = bigintToBytesBE(BigInt(point[0][0]));
  const xc1 = bigintToBytesBE(BigInt(point[0][1]));
  const yc0 = bigintToBytesBE(BigInt(point[1][0]));
  const yc1 = bigintToBytesBE(BigInt(point[1][1]));
  
  const result = new Uint8Array(G2_BYTES);
  result.set(xc1, 0);   // x.c1
  result.set(xc0, 32);  // x.c0
  result.set(yc1, 64);  // y.c1
  result.set(yc0, 96);  // y.c0
  return result;
}

function serializeVerifierKey(vkey: VerifierKey): Buffer {
  console.log(`Serializing verifier key with ${vkey.IC.length} IC points`);
  
  const alpha = serializeG1Point(vkey.vk_alpha_1);
  const beta = serializeG2Point(vkey.vk_beta_2);
  const gamma = serializeG2Point(vkey.vk_gamma_2);
  const delta = serializeG2Point(vkey.vk_delta_2);
  
  // Serialize IC points
  const icPoints = vkey.IC.map(point => serializeG1Point(point));
  const icCount = new Uint8Array(4);
  new DataView(icCount.buffer).setUint32(0, vkey.IC.length, true); // little-endian
  
  // Pack everything: alpha(64) + beta(128) + gamma(128) + delta(128) + ic_count(4) + ic_points(64*n)
  const totalSize = G1_BYTES + G2_BYTES + G2_BYTES + G2_BYTES + 4 + (G1_BYTES * vkey.IC.length);
  const packed = new Uint8Array(totalSize);
  let offset = 0;
  
  packed.set(alpha, offset);
  offset += G1_BYTES;
  
  packed.set(beta, offset);
  offset += G2_BYTES;
  
  packed.set(gamma, offset);
  offset += G2_BYTES;
  
  packed.set(delta, offset);
  offset += G2_BYTES;
  
  packed.set(icCount, offset);
  offset += 4;
  
  for (const icPoint of icPoints) {
    packed.set(icPoint, offset);
    offset += G1_BYTES;
  }
  
  console.log(`Serialized verifier key: ${packed.length} bytes`);
  return Buffer.from(packed);
}

async function loadKeypair(): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR || process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(await readFile(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function derivePDAs() {
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    PROGRAM_ID
  );
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  
  return { globalState, swapVerifier };
}

async function main() {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log('='.repeat(60));
  console.log('SWAP VERIFIER UPLOAD');
  console.log('='.repeat(60));
  
  // Check if swap verifier key exists
  const vkeyPath = 'zk/keys/swap.vkey.json';
  if (!existsSync(vkeyPath)) {
    console.error(`\n❌ Swap verifier key not found at ${vkeyPath}`);
    console.log('\nTo generate the swap circuit and verifier key:');
    console.log('  1. cd zk');
    console.log('  2. npm run build  # Compile circuits');
    console.log('  3. npm run setup  # Generate proving/verification keys');
    process.exit(1);
  }
  
  console.log('\n📂 Loading admin keypair...');
  const admin = await loadKeypair();
  console.log('   Admin:', admin.publicKey.toBase58());
  
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as anchor.Idl, PROGRAM_ID, provider);
  
  const pdas = derivePDAs();
  console.log('\n📍 PDAs:');
  console.log('   Global State:', pdas.globalState.toBase58());
  console.log('   Swap Verifier:', pdas.swapVerifier.toBase58());
  
  // Load and serialize verifier key
  console.log('\n📥 Loading swap verifier key...');
  const swapVkey: VerifierKey = JSON.parse(await readFile(vkeyPath, 'utf-8'));
  console.log('   Protocol:', swapVkey.protocol);
  console.log('   Curve:', swapVkey.curve);
  console.log('   Public inputs:', swapVkey.nPublic);
  console.log('   IC points:', swapVkey.IC.length);
  
  const swapBytes = serializeVerifierKey(swapVkey);
  
  console.log('\n🚀 Uploading swap verifier...');
  try {
    const sig = await program.methods
      .setSwapVerifier(swapBytes)
      .accounts({
        admin: admin.publicKey,
        globalState: pdas.globalState,
        swapVerifier: pdas.swapVerifier,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('   ✅ Swap verifier uploaded:', sig);
  } catch (err: any) {
    console.error('   ❌ Failed to upload swap verifier:', err.message);
    throw err;
  }
  
  // Verify upload
  const verifierAccount = await connection.getAccountInfo(pdas.swapVerifier);
  if (verifierAccount) {
    console.log('\n📊 Verifier account:');
    console.log('   Size:', verifierAccount.data.length, 'bytes');
    console.log('   Owner:', verifierAccount.owner.toBase58());
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ SWAP VERIFIER READY');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
