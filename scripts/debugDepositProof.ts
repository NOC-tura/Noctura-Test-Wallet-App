import path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as snarkjs from '../zk/prover-service/node_modules/snarkjs';
import { createNote } from '../zk/witness/note.ts';
import { serializeDepositWitness } from '../zk/witness/builders/deposit.ts';

async function main() {
  const note = createNote({
    secret: 1234n,
    amount: 1_000_000n,
    tokenMint: 42n,
    blinding: 5678n,
    rho: 91011n,
  });

  const witness = serializeDepositWitness({ note });
  const wasm = path.resolve('zk/build/deposit/deposit_js/deposit.wasm');
  const zkey = path.resolve('zk/keys/deposit.zkey');
  const vkey = JSON.parse(await readFile(path.resolve('zk/keys/deposit.vkey.json'), 'utf-8'));

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, wasm, zkey);
  console.log('publicSignals', publicSignals);
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log('verify ok?', ok);

  const normalized = normalizeProof(proof as GrothProofRaw);
  const serialized = serializeProof(normalized);
  const roundTrip = deserializeProof(serialized);
  const matches = JSON.stringify(roundTrip) === JSON.stringify(normalized);
  console.log('round trip matches?', matches);
  if (!matches) {
    printProofDiff(normalized, roundTrip);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

type GrothProofRaw = {
  pi_a: [string, string, string?];
  pi_b: [[string, string, string?], [string, string, string?]];
  pi_c: [string, string, string?];
};

type GrothProof = {
  pi_a: [string, string, string?];
  pi_b: [[string, string, string?], [string, string, string?]];
  pi_c: [string, string, string?];
};

function normalizeProof(proof: GrothProofRaw): GrothProof {
  return {
    pi_a: [proof.pi_a[0], proof.pi_a[1], proof.pi_a[2]],
    pi_b: [
      [proof.pi_b[0][0], proof.pi_b[0][1], proof.pi_b[0][2]],
      [proof.pi_b[1][0], proof.pi_b[1][1], proof.pi_b[1][2]],
    ],
    pi_c: [proof.pi_c[0], proof.pi_c[1], proof.pi_c[2]],
  };
}

function bigintToBytesBE(value: bigint, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error('Overflow');
  }
  return bytes;
}

function bytesToBigintBE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function serializeProof(proof: GrothProof): Uint8Array {
  const ax = bigintToBytesBE(BigInt(proof.pi_a[0]));
  const ay = bigintToBytesBE(BigInt(proof.pi_a[1]));
  const bxReal = bigintToBytesBE(BigInt(proof.pi_b[0][0]));
  const bxImag = bigintToBytesBE(BigInt(proof.pi_b[0][1]));
  const byReal = bigintToBytesBE(BigInt(proof.pi_b[1][0]));
  const byImag = bigintToBytesBE(BigInt(proof.pi_b[1][1]));
  const cx = bigintToBytesBE(BigInt(proof.pi_c[0]));
  const cy = bigintToBytesBE(BigInt(proof.pi_c[1]));

  const g2 = new Uint8Array(128);
  g2.set(bxReal, 0);
  g2.set(bxImag, 32);
  g2.set(byReal, 64);
  g2.set(byImag, 96);

  return concatBytes([ax, ay, g2, cx, cy]);
}

function deserializeProof(bytes: Uint8Array): GrothProof {
  const ax = bytes.slice(0, 32);
  const ay = bytes.slice(32, 64);
  const g2 = bytes.slice(64, 192);
  const cx = bytes.slice(192, 224);
  const cy = bytes.slice(224, 256);
  const bxReal = g2.slice(0, 32);
  const bxImag = g2.slice(32, 64);
  const byReal = g2.slice(64, 96);
  const byImag = g2.slice(96, 128);
  return {
    pi_a: [bytesToBigintBE(ax).toString(), bytesToBigintBE(ay).toString(), '1'],
    pi_b: [
      [bytesToBigintBE(bxReal).toString(), bytesToBigintBE(bxImag).toString(), undefined],
      [bytesToBigintBE(byReal).toString(), bytesToBigintBE(byImag).toString(), undefined],
    ],
    pi_c: [bytesToBigintBE(cx).toString(), bytesToBigintBE(cy).toString(), '1'],
  };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

function printProofDiff(expected: GrothProof, actual: GrothProof) {
  const sections: Array<[string, unknown, unknown]> = [
    ['pi_a[0]', expected.pi_a[0], actual.pi_a[0]],
    ['pi_a[1]', expected.pi_a[1], actual.pi_a[1]],
    ['pi_a[2]', expected.pi_a[2], actual.pi_a[2]],
    ['pi_b[0][0]', expected.pi_b[0][0], actual.pi_b[0][0]],
    ['pi_b[0][1]', expected.pi_b[0][1], actual.pi_b[0][1]],
    ['pi_b[0][2]', expected.pi_b[0][2], actual.pi_b[0][2]],
    ['pi_b[1][0]', expected.pi_b[1][0], actual.pi_b[1][0]],
    ['pi_b[1][1]', expected.pi_b[1][1], actual.pi_b[1][1]],
    ['pi_b[1][2]', expected.pi_b[1][2], actual.pi_b[1][2]],
    ['pi_c[0]', expected.pi_c[0], actual.pi_c[0]],
    ['pi_c[1]', expected.pi_c[1], actual.pi_c[1]],
    ['pi_c[2]', expected.pi_c[2], actual.pi_c[2]],
  ];
  for (const [label, exp, act] of sections) {
    if (exp !== act) {
      console.log(`${label} differs`, { expected: exp, actual: act });
    }
  }
}
