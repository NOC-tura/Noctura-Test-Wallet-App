import { join } from 'path';
import { performance } from 'node:perf_hooks';
import * as snarkjs from 'snarkjs';
import { CIRCUIT_BUILD_DIR, KEYS_DIR } from './config.js';

const cache = new Map<string, { wasm: string; zkey: string }>();

type ProofResponse = {
  proof: unknown;
  publicSignals: unknown;
  proofBytes: string;
  publicInputs: string[];
  proverMs: number;
  privacyFeeNoc: number;
};

export async function generateProof(circuit: string, input: Record<string, unknown>): Promise<ProofResponse> {
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
    `[prover:${circuit}] payload`,
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
