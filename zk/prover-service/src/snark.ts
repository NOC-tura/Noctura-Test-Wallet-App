import { join } from 'path';
import { performance } from 'node:perf_hooks';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as snarkjs from 'snarkjs';
import { CIRCUIT_BUILD_DIR, KEYS_DIR } from './config.js';

const cache = new Map<string, { wasm: string; zkey: string }>();

// Check if RapidSNARK is available
const USE_RAPIDSNARK = process.env.USE_RAPIDSNARK === 'true' && isRapidsnarkAvailable();

function isRapidsnarkAvailable(): boolean {
  try {
    execSync('which prover', { stdio: 'ignore' });
    console.log('[Prover] RapidSNARK detected - using native prover (10-15x faster)');
    return true;
  } catch {
    console.log('[Prover] RapidSNARK not found - using snarkjs (slower)');
    return false;
  }
}

type ProofResponse = {
  proof: unknown;
  publicSignals: unknown;
  proofBytes: string;
  publicInputs: string[];
  proverMs: number;
  privacyFeeNoc: number;
};

export async function generateProof(circuit: string, input: Record<string, unknown>): Promise<ProofResponse> {
  if (USE_RAPIDSNARK) {
    return generateProofRapidsnark(circuit, input);
  }
  return generateProofSnarkjs(circuit, input);
}

// Fast native prover using RapidSNARK (C++)
async function generateProofRapidsnark(circuit: string, input: Record<string, unknown>): Promise<ProofResponse> {
  const wasmPath = join(CIRCUIT_BUILD_DIR, circuit, `${circuit}_js`, `${circuit}.wasm`);
  const zkeyPath = join(KEYS_DIR, `${circuit}.zkey`);
  
  const timestamp = Date.now();
  const witnessPath = join(tmpdir(), `witness_${circuit}_${timestamp}.wtns`);
  const proofPath = join(tmpdir(), `proof_${circuit}_${timestamp}.json`);
  const publicPath = join(tmpdir(), `public_${circuit}_${timestamp}.json`);
  
  const start = performance.now();
  
  try {
    // Step 1: Calculate witness using snarkjs (still needed, but fast)
    const witnessStart = performance.now();
    const witnessCalculator = await snarkjs.wtns.newWtns(wasmPath, witnessPath, input);
    // Actually we need to use the calculate function properly
    await snarkjs.wtns.calculate(input, wasmPath, witnessPath);
    const witnessMs = performance.now() - witnessStart;
    console.log(`[prover:${circuit}] Witness calculated in ${Math.round(witnessMs)}ms`);
    
    // Step 2: Generate proof using RapidSNARK (the fast part!)
    const proveStart = performance.now();
    execSync(`prover ${zkeyPath} ${witnessPath} ${proofPath} ${publicPath}`, {
      timeout: 60000, // 60 second timeout
      stdio: 'pipe'
    });
    const proveMs = performance.now() - proveStart;
    console.log(`[prover:${circuit}] RapidSNARK proof generated in ${Math.round(proveMs)}ms`);
    
    // Step 3: Read results
    const proof = JSON.parse(readFileSync(proofPath, 'utf-8'));
    const publicSignals = JSON.parse(readFileSync(publicPath, 'utf-8'));
    
    const proverMs = performance.now() - start;
    
    // Serialize for on-chain verification
    const serializedProof = serializeProof(proof);
    const serializedInputs = serializePublicSignals(publicSignals);
    const proofBase64 = bufferToBase64(serializedProof);
    const publicInputsBase64 = serializedInputs.map(bufferToBase64);
    
    console.info(
      `[prover:${circuit}] RapidSNARK payload`,
      JSON.stringify(
        {
          ms: Math.round(proverMs),
          witnessMs: Math.round(witnessMs),
          proveMs: Math.round(proveMs),
          publicSignals,
          proofBytes: `${proofBase64.slice(0, 48)}…`,
        },
        null,
        2,
      ),
    );
    
    return {
      proof,
      publicSignals,
      proofBytes: proofBase64,
      publicInputs: publicInputsBase64,
      proverMs,
      privacyFeeNoc: estimatePrivacyFee(proverMs),
    };
  } finally {
    // Cleanup temp files
    try {
      if (existsSync(witnessPath)) unlinkSync(witnessPath);
      if (existsSync(proofPath)) unlinkSync(proofPath);
      if (existsSync(publicPath)) unlinkSync(publicPath);
    } catch (cleanupErr) {
      console.warn('[prover] Cleanup warning:', cleanupErr);
    }
  }
}

// Fallback to snarkjs (slower but works everywhere)
async function generateProofSnarkjs(circuit: string, input: Record<string, unknown>): Promise<ProofResponse> {
  if (!cache.has(circuit)) {
    const wasmPath = join(CIRCUIT_BUILD_DIR, circuit, `${circuit}_js`, `${circuit}.wasm`);
    cache.set(circuit, {
      wasm: wasmPath,
      zkey: join(KEYS_DIR, `${circuit}.zkey`),
    });
  }
  const artifacts = cache.get(circuit)!;
  const start = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, artifacts.wasm, artifacts.zkey);
  const proverMs = performance.now() - start;
  const serializedProof = serializeProof(proof);
  const serializedInputs = serializePublicSignals(publicSignals);
  const proofBase64 = bufferToBase64(serializedProof);
  const publicInputsBase64 = serializedInputs.map(bufferToBase64);

  console.info(
    `[prover:${circuit}] snarkjs payload`,
    JSON.stringify(
      {
        ms: Math.round(proverMs),
        publicSignals,
        publicInputsHex: serializedInputs.map((bytes) => Buffer.from(bytes).toString('hex')),
        proofBytes: `${proofBase64.slice(0, 48)}…`,
      },
      null,
      2,
    ),
  );

  return {
    proof,
    publicSignals,
    proofBytes: proofBase64,
    publicInputs: publicInputsBase64,
    proverMs,
    privacyFeeNoc: estimatePrivacyFee(proverMs),
  };
}

function estimatePrivacyFee(durationMs: number): number {
  const base = 0.05;
  const ceiling = 0.1;
  const perSecondSlope = 0.01; // add 0.01 NOC per second of prover work
  const extra = Math.min((durationMs / 1000) * perSecondSlope, ceiling - base);
  return Math.round((base + extra) * 1_000) / 1_000; // round to the nearest milli NOC
}

function bigintToBytesBE(value: bigint, length = 32): Uint8Array {
  if (value < 0n) {
    throw new Error('Negative field elements are not supported');
  }
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error('Field element does not fit in allocated bytes');
  }
  return bytes;
}

function bigintToBytesLE(value: bigint, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error('Field element does not fit in allocated bytes');
  }
  return bytes;
}

type GrothProof = {
  pi_a: [string, string, string?];
  pi_b: [[string, string, string?], [string, string, string?]];
  pi_c: [string, string, string?];
};

function serializeProof(proof: unknown): Uint8Array {
  const typed = proof as GrothProof;
  const ax = bigintToBytesBE(BigInt(typed.pi_a[0]));
  const ay = bigintToBytesBE(BigInt(typed.pi_a[1]));
  // snarkjs pi_b format: [[x.c0, x.c1], [y.c0, y.c1]]
  // EIP-196 G2 format: [x.c1, x.c0, y.c1, y.c0] each 32 bytes BE
  const bx_c0 = bigintToBytesBE(BigInt(typed.pi_b[0][0]));
  const bx_c1 = bigintToBytesBE(BigInt(typed.pi_b[0][1]));
  const by_c0 = bigintToBytesBE(BigInt(typed.pi_b[1][0]));
  const by_c1 = bigintToBytesBE(BigInt(typed.pi_b[1][1]));
  const cx = bigintToBytesBE(BigInt(typed.pi_c[0]));
  const cy = bigintToBytesBE(BigInt(typed.pi_c[1]));

  // Pack G2 in EIP-196 order: [x.c1, x.c0, y.c1, y.c0]
  const g2 = new Uint8Array(128);
  g2.set(bx_c1, 0);   // x.c1
  g2.set(bx_c0, 32);  // x.c0
  g2.set(by_c1, 64);  // y.c1
  g2.set(by_c0, 96);  // y.c0

  return concatBytes([ax, ay, g2, cx, cy]);
}

function serializePublicSignals(signals: unknown): Uint8Array[] {
  // EIP-196 requires big-endian format for field elements
  const list = Array.isArray(signals) ? signals : [];
  return list.map((value) => bigintToBytesBE(BigInt(value)));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
