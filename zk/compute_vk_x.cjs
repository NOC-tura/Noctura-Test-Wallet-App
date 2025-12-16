const fs = require('fs');

// Read verification key
const vkey = JSON.parse(fs.readFileSync('keys/deposit.vkey.json', 'utf8'));
const publicInputs = JSON.parse(fs.readFileSync('keys/deposit-public.json', 'utf8'));

// BN128 field modulus
const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// Fq2 multiplication
function fq2_mul(a, b) {
    // a = a0 + a1*i, b = b0 + b1*i
    // result = (a0*b0 - a1*b1) + (a0*b1 + a1*b0)*i
    const c0 = (a[0] * b[0] - a[1] * b[1]) % p;
    const c1 = (a[0] * b[1] + a[1] * b[0]) % p;
    return [(c0 + p) % p, (c1 + p) % p];
}

// Modular inverse using extended Euclidean algorithm
function modInverse(a, m) {
    a = ((a % m) + m) % m;
    if (a === 0n) return 0n;
    let [old_r, r] = [a, m];
    let [old_s, s] = [1n, 0n];
    while (r !== 0n) {
        const quotient = old_r / r;
        [old_r, r] = [r, old_r - quotient * r];
        [old_s, s] = [s, old_s - quotient * s];
    }
    return ((old_s % m) + m) % m;
}

// Fq2 inverse
function fq2_inv(a) {
    // For a = a0 + a1*i, inverse is (a0 - a1*i) / (a0^2 + a1^2)
    const norm = (a[0] * a[0] + a[1] * a[1]) % p;
    const normInv = modInverse(norm, p);
    const c0 = (a[0] * normInv) % p;
    const c1 = (p - (a[1] * normInv) % p) % p;
    return [c0, c1];
}

// G1 point addition using affine coordinates
function g1_add(p1, p2) {
    if (p1[0] === 0n && p1[1] === 0n) return p2;
    if (p2[0] === 0n && p2[1] === 0n) return p1;
    
    if (p1[0] === p2[0]) {
        if (p1[1] === p2[1]) {
            // Point doubling
            const lambda = (3n * p1[0] * p1[0] * modInverse(2n * p1[1], p)) % p;
            const x3 = ((lambda * lambda - 2n * p1[0]) % p + p) % p;
            const y3 = ((lambda * (p1[0] - x3) - p1[1]) % p + p) % p;
            return [x3, y3];
        } else {
            // Point at infinity
            return [0n, 0n];
        }
    }
    
    const lambda = ((p2[1] - p1[1]) * modInverse((p2[0] - p1[0] + p) % p, p)) % p;
    const x3 = ((lambda * lambda - p1[0] - p2[0]) % p + p) % p;
    const y3 = ((lambda * (p1[0] - x3) - p1[1]) % p + p) % p;
    return [x3, y3];
}

// G1 scalar multiplication
function g1_scalar_mul(point, scalar) {
    let result = [0n, 0n];
    let temp = [point[0], point[1]];
    let s = scalar;
    
    while (s > 0n) {
        if (s & 1n) {
            result = g1_add(result, temp);
        }
        temp = g1_add(temp, temp);
        s >>= 1n;
    }
    
    return result;
}

// Convert from string to bigint
function toBigInt(str) {
    return BigInt(str);
}

// IC[0] (start point for vk_x accumulation)
const ic0 = [toBigInt(vkey.IC[0][0]), toBigInt(vkey.IC[0][1])];
console.log('IC[0]:');
console.log('  x:', ic0[0].toString());
console.log('  y:', ic0[1].toString());

// Compute vk_x = IC[0] + sum(IC[i] * public_input[i-1])
let vk_x = ic0;
for (let i = 0; i < publicInputs.length; i++) {
    const scalar = toBigInt(publicInputs[i]);
    const ic_i = [toBigInt(vkey.IC[i+1][0]), toBigInt(vkey.IC[i+1][1])];
    console.log(`\nIC[${i+1}]:`);
    console.log('  x:', ic_i[0].toString());
    console.log('  y:', ic_i[1].toString());
    console.log(`  scalar[${i}]:`, scalar.toString());
    
    const term = g1_scalar_mul(ic_i, scalar);
    console.log(`  IC[${i+1}] * scalar:`, term[0].toString(), term[1].toString());
    
    vk_x = g1_add(vk_x, term);
    console.log(`  vk_x after add:`, vk_x[0].toString(), vk_x[1].toString());
}

console.log('\nFinal vk_x:');
console.log('  x:', vk_x[0].toString());
console.log('  y:', vk_x[1].toString());

// Convert to big-endian bytes
function bigintToBuffer(num, len) {
    const buf = Buffer.alloc(len);
    let n = num;
    for (let i = len - 1; i >= 0; i--) {
        buf[i] = Number(n & 0xFFn);
        n >>= 8n;
    }
    return buf;
}

const x_be = bigintToBuffer(vk_x[0], 32);
const y_be = bigintToBuffer(vk_x[1], 32);
const vk_x_bytes = Buffer.concat([x_be, y_be]);
console.log('\nvk_x as base64 (BE):', vk_x_bytes.toString('base64'));
