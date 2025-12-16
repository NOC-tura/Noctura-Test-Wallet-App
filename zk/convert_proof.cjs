const fs = require('fs');

// Read proof
const proof = JSON.parse(fs.readFileSync('keys/deposit-proof.json', 'utf8'));
const publicInputs = JSON.parse(fs.readFileSync('keys/deposit-public.json', 'utf8'));

function bigintToBuffer(numStr, len) {
    let bn = BigInt(numStr);
    const buf = Buffer.alloc(len);
    for (let i = len - 1; i >= 0; i--) {
        buf[i] = Number(bn & 0xFFn);
        bn >>= 8n;
    }
    return buf;
}

// G1 point: x (32 bytes BE) + y (32 bytes BE)
function encodeG1(point) {
    const x = bigintToBuffer(point[0], 32);
    const y = bigintToBuffer(point[1], 32);
    return Buffer.concat([x, y]);
}

// G2 point: x.c1 (32 BE) + x.c0 (32 BE) + y.c1 (32 BE) + y.c0 (32 BE)
// EIP-196 format: x.c1, x.c0, y.c1, y.c0
function encodeG2(point) {
    // point[0] is [c0, c1] for x coordinate
    // point[1] is [c0, c1] for y coordinate
    const x_c0 = bigintToBuffer(point[0][0], 32);
    const x_c1 = bigintToBuffer(point[0][1], 32);
    const y_c0 = bigintToBuffer(point[1][0], 32);
    const y_c1 = bigintToBuffer(point[1][1], 32);
    // EIP-196: x.c1, x.c0, y.c1, y.c0
    return Buffer.concat([x_c1, x_c0, y_c1, y_c0]);
}

// Encode proof: pi_a (G1), pi_b (G2), pi_c (G1)
const pi_a = encodeG1(proof.pi_a);
const pi_b = encodeG2(proof.pi_b);
const pi_c = encodeG1(proof.pi_c);

const proofBytes = Buffer.concat([pi_a, pi_b, pi_c]);

console.log('Proof base64:', proofBytes.toString('base64'));
console.log('Proof length:', proofBytes.length);

// Encode public inputs as 32-byte BE
console.log('\nPublic inputs:');
for (let i = 0; i < publicInputs.length; i++) {
    const buf = bigintToBuffer(publicInputs[i], 32);
    console.log(`  [${i}]: ${buf.toString('base64')}`);
}
