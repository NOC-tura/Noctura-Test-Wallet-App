const fs = require('fs');
const vkey = JSON.parse(fs.readFileSync('keys/deposit.vkey.json', 'utf8'));

const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function toBigInt(str) { return BigInt(str); }

function bigintToBuffer(num, len) {
    const buf = Buffer.alloc(len);
    let n = ((num % p) + p) % p;
    for (let i = len - 1; i >= 0; i--) {
        buf[i] = Number(n & 0xFFn);
        n >>= 8n;
    }
    return buf;
}

// EIP-196 G2 encoding: [x.c1, x.c0, y.c1, y.c0] each 32 bytes BE
function encodeG2(point) {
    const x_c0 = bigintToBuffer(toBigInt(point[0][0]), 32);
    const x_c1 = bigintToBuffer(toBigInt(point[0][1]), 32);
    const y_c0 = bigintToBuffer(toBigInt(point[1][0]), 32);
    const y_c1 = bigintToBuffer(toBigInt(point[1][1]), 32);
    // EIP-196: x_imag, x_real, y_imag, y_real
    return Buffer.concat([x_c1, x_c0, y_c1, y_c0]);
}

function negateG2(point) {
    // Negate G2: keep x, negate y (y' = p - y)
    const y_c0_neg = (p - toBigInt(point[1][0])) % p;
    const y_c1_neg = (p - toBigInt(point[1][1])) % p;
    return [point[0], [y_c0_neg.toString(), y_c1_neg.toString()]];
}

console.log('gamma (BE):');
console.log('  encoded:', encodeG2(vkey.vk_gamma_2).toString('base64'));

console.log('\n-gamma (BE):');
const gamma_neg = negateG2(vkey.vk_gamma_2);
console.log('  encoded:', encodeG2(gamma_neg).toString('base64'));

console.log('\nbeta (BE):');
console.log('  encoded:', encodeG2(vkey.vk_beta_2).toString('base64'));

console.log('\n-beta (BE):');
const beta_neg = negateG2(vkey.vk_beta_2);
console.log('  encoded:', encodeG2(beta_neg).toString('base64'));

console.log('\nalpha (BE):');
const alpha = vkey.vk_alpha_1;
const x_be = bigintToBuffer(toBigInt(alpha[0]), 32);
const y_be = bigintToBuffer(toBigInt(alpha[1]), 32);
console.log('  encoded:', Buffer.concat([x_be, y_be]).toString('base64'));
