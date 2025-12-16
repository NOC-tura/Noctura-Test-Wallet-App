import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_PROGRAM = '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz';
const DEFAULT_VKEY_PATH = resolve(REPO_ROOT, 'zk/keys/deposit.vkey.json');
const require = createRequire(import.meta.url);

function toBytes(value: bigint, length = 32, endian: 'be' | 'le' = 'le'): Uint8Array {
  const bytes = new Uint8Array(length);
  let tmp = value;
  if (endian === 'le') {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
  } else {
    for (let i = length - 1; i >= 0; i -= 1) {
      bytes[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
  }
  if (tmp !== 0n) {
    throw new Error('Field element exceeds allocated bytes');
  }
  return bytes;
}

function packG1(point: string[]): Uint8Array {
  const buffer = new Uint8Array(64);
  buffer.set(toBytes(BigInt(point[0]), 32, 'be'), 0);
  buffer.set(toBytes(BigInt(point[1]), 32, 'be'), 32);
  return buffer;
}

function packG2(point: string[][]): Uint8Array {
  const buffer = new Uint8Array(128);
  const [x, y] = point;
  buffer.set(toBytes(BigInt(x[0]), 32, 'be'), 0);
  buffer.set(toBytes(BigInt(x[1]), 32, 'be'), 32);
  buffer.set(toBytes(BigInt(y[0]), 32, 'be'), 64);
  buffer.set(toBytes(BigInt(y[1]), 32, 'be'), 96);
  return buffer;
}

async function buildVerifierBlob(filePath: string): Promise<Uint8Array> {
  const json = JSON.parse(await readFile(filePath, 'utf-8'));
  const packed = {
    alpha_g1: packG1(json.vk_alpha_1),
    beta_g2: packG2(json.vk_beta_2),
    gamma_g2: packG2(json.vk_gamma_2),
    delta_g2: packG2(json.vk_delta_2),
    ic: json.IC.map((point: string[]) => packG1(point)),
  };
  const icCount = packed.ic.length;
  const countBytes = new Uint8Array(4);
  const view = new DataView(countBytes.buffer);
  view.setUint32(0, icCount, true);
  const buffers = [packed.alpha_g1, packed.beta_g2, packed.gamma_g2, packed.delta_g2, countBytes, ...packed.ic];
  const total = buffers.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of buffers) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function main() {
  const provider = AnchorProvider.env();
  const idl = require('../src/lib/idl/noctura_shield.json');
  const programId = new PublicKey(process.env.VITE_SHIELD_PROGRAM || idl?.metadata?.address || DEFAULT_PROGRAM);
  const program = new Program(idl, programId, provider);
  const [verifier] = PublicKey.findProgramAddressSync([Buffer.from('verifier')], programId);
  const account = (await program.account.verifierAccount.fetch(verifier)) as { verifyingKey: number[] };
  const onchain = new Uint8Array(account.verifyingKey ?? []);
  const localPath = process.env.VERIFYING_KEY_PATH || DEFAULT_VKEY_PATH;
  const local = await buildVerifierBlob(localPath);
  console.log('On-chain bytes', onchain.length);
  console.log('Local bytes', local.length);
  const mismatches: Array<{ index: number; onchain: number; local: number }> = [];
  const max = Math.max(onchain.length, local.length);
  for (let i = 0; i < max; i += 1) {
    const a = onchain[i] ?? -1;
    const b = local[i] ?? -1;
    if (a !== b) {
      mismatches.push({ index: i, onchain: a, local: b });
      if (mismatches.length > 10) break;
    }
  }
  if (mismatches.length === 0) {
    console.log('Verifier bytes match exactly.');
    return;
  }
  console.log('Found mismatches:', mismatches);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
