// @ts-nocheck
/**
 * Upload swap verifier in chunks (for large verifier keys)
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import IDL from '../src/lib/idl/noctura_shield.json';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Chunk size - keep small enough to fit in transaction (~700 bytes to be safe)
const CHUNK_SIZE = 700;

interface VerifierKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string]];
  vk_gamma_2: [[string, string], [string, string], [string]];
  vk_delta_2: [[string, string], [string, string], [string]];
  vk_alphabeta_12: [[string, string], [string, string], [string]][];
  IC: [string, string, string][];
}

function serializeVerifierKey(vkey: VerifierKey): Uint8Array {
  // Pack G1 point (2 coordinates, each 32 bytes = 64 bytes)
  function packG1(point: [string, string, string]): Uint8Array {
    const buf = new Uint8Array(64);
    const x = BigInt(point[0]);
    const y = BigInt(point[1]);
    for (let i = 0; i < 32; i++) {
      buf[31 - i] = Number((x >> BigInt(8 * i)) & 0xffn);
      buf[63 - i] = Number((y >> BigInt(8 * i)) & 0xffn);
    }
    return buf;
  }

  // Pack G2 point in EIP-196 format: [x.c1, x.c0, y.c1, y.c0] (each 32 bytes BE)
  // snarkjs format: [[x.c0, x.c1], [y.c0, y.c1], [z]]
  function packG2(point: [[string, string], [string, string], [string]]): Uint8Array {
    const buf = new Uint8Array(128);
    // IMPORTANT: Reorder for EIP-196: [x.c1, x.c0, y.c1, y.c0]
    const coords = [
      BigInt(point[0][1]), // x.c1 first
      BigInt(point[0][0]), // x.c0 second
      BigInt(point[1][1]), // y.c1 third
      BigInt(point[1][0])  // y.c0 fourth
    ];
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < 32; i++) {
        buf[c * 32 + 31 - i] = Number((coords[c] >> BigInt(8 * i)) & 0xffn);
      }
    }
    return buf;
  }

  // Calculate size: alpha (64) + beta (128) + gamma (128) + delta (128) + nIC (4) + IC (64 * nIC)
  const nIC = vkey.IC.length;
  const size = 64 + 128 + 128 + 128 + 4 + (64 * nIC);
  const packed = new Uint8Array(size);
  let offset = 0;

  packed.set(packG1(vkey.vk_alpha_1), offset); offset += 64;
  packed.set(packG2(vkey.vk_beta_2), offset); offset += 128;
  packed.set(packG2(vkey.vk_gamma_2), offset); offset += 128;
  packed.set(packG2(vkey.vk_delta_2), offset); offset += 128;

  // Number of IC points (4 bytes little-endian)
  packed[offset++] = nIC & 0xff;
  packed[offset++] = (nIC >> 8) & 0xff;
  packed[offset++] = (nIC >> 16) & 0xff;
  packed[offset++] = (nIC >> 24) & 0xff;

  for (const ic of vkey.IC) {
    packed.set(packG1(ic), offset);
    offset += 64;
  }

  return packed;
}

async function loadKeypair(): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR || process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(await readFile(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function derivePDAs() {
  const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global-state')], PROGRAM_ID);
  const [swapVerifier] = PublicKey.findProgramAddressSync([Buffer.from('swap-verifier')], PROGRAM_ID);
  return { globalState, swapVerifier };
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('Loading admin keypair...');
  const admin = await loadKeypair();
  console.log('Admin:', admin.publicKey.toBase58());
  
  const pdas = derivePDAs();
  console.log('Global State:', pdas.globalState.toBase58());
  console.log('Swap Verifier:', pdas.swapVerifier.toBase58());
  
  // Check balance
  const balance = await connection.getBalance(admin.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL');
  
  if (balance < 0.1 * 1e9) {
    console.error('Insufficient balance. Need at least 0.1 SOL');
    process.exit(1);
  }
  
  // Load verifier key
  const vkeyPath = '../zk/keys/swap.vkey.json';
  if (!existsSync(vkeyPath)) {
    console.error('Swap verifier key not found at', vkeyPath);
    process.exit(1);
  }
  
  console.log('\nLoading swap verifier key...');
  const swapVkey: VerifierKey = JSON.parse(await readFile(vkeyPath, 'utf-8'));
  const serializedKey = serializeVerifierKey(swapVkey);
  console.log('Serialized key size:', serializedKey.length, 'bytes');
  
  // Set up anchor
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as any, PROGRAM_ID, provider);
  
  // Step 1: Initialize the verifier account
  console.log('\n1. Initializing swap verifier for chunked upload...');
  try {
    const initTx = await program.methods
      .initSwapVerifierChunked()
      .accounts({
        admin: admin.publicKey,
        globalState: pdas.globalState,
        swapVerifier: pdas.swapVerifier,
        systemProgram: PublicKey.default,
      })
      .rpc();
    console.log('Init tx:', initTx);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('Verifier account already exists, will append/overwrite');
    } else {
      throw e;
    }
  }
  
  // Step 2: Upload chunks
  const numChunks = Math.ceil(serializedKey.length / CHUNK_SIZE);
  console.log(`\n2. Uploading ${numChunks} chunks...`);
  
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, serializedKey.length);
    const chunk = Array.from(serializedKey.slice(start, end));
    
    console.log(`   Chunk ${i + 1}/${numChunks}: bytes ${start}-${end} (${chunk.length} bytes)`);
    
    const tx = await program.methods
      .appendSwapVerifierChunk(Buffer.from(chunk))
      .accounts({
        admin: admin.publicKey,
        globalState: pdas.globalState,
        swapVerifier: pdas.swapVerifier,
      })
      .rpc();
    console.log(`   Tx: ${tx}`);
    
    // Small delay between chunks
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Step 3: Finalize
  console.log('\n3. Finalizing swap verifier...');
  const finalizeTx = await program.methods
    .finalizeSwapVerifier()
    .accounts({
      admin: admin.publicKey,
      globalState: pdas.globalState,
      swapVerifier: pdas.swapVerifier,
    })
    .rpc();
  console.log('Finalize tx:', finalizeTx);
  
  console.log('\n✅ Swap verifier uploaded successfully!');
  console.log('Swap Verifier PDA:', pdas.swapVerifier.toBase58());
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
