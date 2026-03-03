// @ts-nocheck
/**
 * Upload swap verifier using raw transaction
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'crypto';
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as borsh from 'borsh';

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

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

const G1_BYTES = 64;
const G2_BYTES = 128;

function bigintToBytesBE(value: bigint, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
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
  const xc0 = bigintToBytesBE(BigInt(point[0][0]));
  const xc1 = bigintToBytesBE(BigInt(point[0][1]));
  const yc0 = bigintToBytesBE(BigInt(point[1][0]));
  const yc1 = bigintToBytesBE(BigInt(point[1][1]));
  
  const result = new Uint8Array(G2_BYTES);
  result.set(xc1, 0);
  result.set(xc0, 32);
  result.set(yc1, 64);
  result.set(yc0, 96);
  return result;
}

function serializeVerifierKey(vkey: VerifierKey): Uint8Array {
  const alpha = serializeG1Point(vkey.vk_alpha_1);
  const beta = serializeG2Point(vkey.vk_beta_2);
  const gamma = serializeG2Point(vkey.vk_gamma_2);
  const delta = serializeG2Point(vkey.vk_delta_2);
  
  const icPoints = vkey.IC.map(point => serializeG1Point(point));
  const icCount = new Uint8Array(4);
  new DataView(icCount.buffer).setUint32(0, vkey.IC.length, true);
  
  const totalSize = G1_BYTES + G2_BYTES + G2_BYTES + G2_BYTES + 4 + (G1_BYTES * vkey.IC.length);
  const packed = new Uint8Array(totalSize);
  let offset = 0;
  
  packed.set(alpha, offset); offset += G1_BYTES;
  packed.set(beta, offset); offset += G2_BYTES;
  packed.set(gamma, offset); offset += G2_BYTES;
  packed.set(delta, offset); offset += G2_BYTES;
  packed.set(icCount, offset); offset += 4;
  
  for (const icPoint of icPoints) {
    packed.set(icPoint, offset);
    offset += G1_BYTES;
  }
  
  return packed;
}

// Anchor instruction discriminator for set_swap_verifier
// sha256("global:set_swap_verifier")[0..8]
function getInstructionDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return Buffer.from(hash.slice(0, 8));
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
  
  // Load verifier key
  const vkeyPath = '../zk/keys/swap.vkey.json';
  if (!existsSync(vkeyPath)) {
    console.error('Swap verifier key not found');
    process.exit(1);
  }
  
  console.log('\nLoading swap verifier key...');
  const swapVkey: VerifierKey = JSON.parse(await readFile(vkeyPath, 'utf-8'));
  const serializedKey = serializeVerifierKey(swapVkey);
  console.log('Serialized key size:', serializedKey.length, 'bytes');
  
  // Build instruction data:
  // - 8 bytes: discriminator
  // - 4 bytes: vector length (little-endian u32)
  // - N bytes: verifier key data
  const discriminator = getInstructionDiscriminator('set_swap_verifier');
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32LE(serializedKey.length, 0);
  
  const instructionData = Buffer.concat([
    discriminator,
    lengthBytes,
    Buffer.from(serializedKey)
  ]);
  
  console.log('Instruction data size:', instructionData.length, 'bytes');
  
  // Build instruction
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: pdas.globalState, isSigner: false, isWritable: false },
      { pubkey: pdas.swapVerifier, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: instructionData,
  });
  
  console.log('\nSending transaction...');
  const tx = new Transaction().add(instruction);
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [admin], {
      commitment: 'confirmed',
    });
    console.log('✅ Swap verifier uploaded:', sig);
  } catch (err: any) {
    console.error('❌ Failed:', err.message);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
    throw err;
  }
  
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
