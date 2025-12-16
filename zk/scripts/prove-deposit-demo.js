import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as snarkjs from 'snarkjs';
import { createNote, serializeDepositWitness } from '../witness/index.js';
const globals = globalThis;
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
function randomScalar() {
    let value = 0n;
    const buf = randomBytes(32);
    for (const byte of buf) {
        value = (value << 8n) | BigInt(byte);
    }
    return value % FIELD_MODULUS;
}
function toBytesBE(value, length = 32) {
    const out = new Uint8Array(length);
    let tmp = value;
    for (let i = length - 1; i >= 0; i -= 1) {
        out[i] = Number(tmp & 0xffn);
        tmp >>= 8n;
    }
    if (tmp !== 0n) {
        throw new Error('value exceeds field size');
    }
    return out;
}
function toBytesLE(value, length = 32) {
    const out = new Uint8Array(length);
    let tmp = value;
    for (let i = 0; i < length; i += 1) {
        out[i] = Number(tmp & 0xffn);
        tmp >>= 8n;
    }
    if (tmp !== 0n) {
        throw new Error('value exceeds field size');
    }
    return out;
}
function serializeProof(proof) {
    const ax = toBytesBE(BigInt(proof.pi_a[0]));
    const ay = toBytesBE(BigInt(proof.pi_a[1]));
    const bxReal = toBytesBE(BigInt(proof.pi_b[0][0]));
    const bxImag = toBytesBE(BigInt(proof.pi_b[0][1]));
    const byReal = toBytesBE(BigInt(proof.pi_b[1][0]));
    const byImag = toBytesBE(BigInt(proof.pi_b[1][1]));
    const cx = toBytesBE(BigInt(proof.pi_c[0]));
    const cy = toBytesBE(BigInt(proof.pi_c[1]));
    const g2 = new Uint8Array(128);
    g2.set(bxReal, 0);
    g2.set(bxImag, 32);
    g2.set(byReal, 64);
    g2.set(byImag, 96);
    return Buffer.concat([Buffer.from(ax), Buffer.from(ay), Buffer.from(g2), Buffer.from(cx), Buffer.from(cy)]);
}
function serializePublicSignals(signals) {
    return signals.map((value) => {
        const bytes = toBytesLE(BigInt(value));
        return Buffer.from(bytes).toString('base64');
    });
}
async function main() {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const wasm = join(root, 'build', 'deposit', 'deposit_js', 'deposit.wasm');
    const zkey = join(root, 'keys', 'deposit.zkey');
    const note = createNote({
        secret: randomScalar(),
        amount: 1000000n,
        tokenMint: 123456789n,
        blinding: randomScalar(),
        rho: randomScalar(),
    });
    const witness = serializeDepositWitness({ note });
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, wasm, zkey);
    const proofBytes = serializeProof(proof);
    const publicInputs = serializePublicSignals(publicSignals);
    console.log('proofBytes(base64)=', Buffer.from(proofBytes).toString('base64'));
    console.log('publicInputs=', publicInputs);
    // snarkjs/ffjavascript caches the curve on the global object; terminate its worker pool so tsx can exit
    if (globals.curve_bn128?.terminate) {
        await globals.curve_bn128.terminate();
    }
}
main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
