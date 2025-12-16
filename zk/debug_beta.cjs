const fs = require('fs');
const vkey = JSON.parse(fs.readFileSync('keys/deposit.vkey.json', 'utf8'));

const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function toBigInt(str) { return BigInt(str); }

function bigintToHex(n) {
    return n.toString(16).padStart(64, '0');
}

// Beta from vkey:
const beta_x_c0 = toBigInt(vkey.vk_beta_2[0][0]);
const beta_x_c1 = toBigInt(vkey.vk_beta_2[0][1]);
const beta_y_c0 = toBigInt(vkey.vk_beta_2[1][0]);
const beta_y_c1 = toBigInt(vkey.vk_beta_2[1][1]);

console.log('Beta from vkey:');
console.log('  x.c0:', beta_x_c0.toString());
console.log('  x.c1:', beta_x_c1.toString());
console.log('  y.c0:', beta_y_c0.toString());
console.log('  y.c1:', beta_y_c1.toString());

console.log('\nBeta as hex:');
console.log('  x.c0:', bigintToHex(beta_x_c0));
console.log('  x.c1:', bigintToHex(beta_x_c1));
console.log('  y.c0:', bigintToHex(beta_y_c0));
console.log('  y.c1:', bigintToHex(beta_y_c1));

// Expected EIP-196 format: [x.c1, x.c0, y.c1, y.c0]
console.log('\nExpected EIP-196 bytes for beta (not negated):');
console.log('  bytes 0-31 (x.c1): ', bigintToHex(beta_x_c1));
console.log('  bytes 32-63 (x.c0):', bigintToHex(beta_x_c0));
console.log('  bytes 64-95 (y.c1):', bigintToHex(beta_y_c1));
console.log('  bytes 96-127 (y.c0):', bigintToHex(beta_y_c0));

// Negated y values
const neg_y_c0 = (p - beta_y_c0) % p;
const neg_y_c1 = (p - beta_y_c1) % p;

console.log('\nExpected EIP-196 bytes for -beta:');
console.log('  bytes 0-31 (x.c1): ', bigintToHex(beta_x_c1));
console.log('  bytes 32-63 (x.c0):', bigintToHex(beta_x_c0));
console.log('  bytes 64-95 (-y.c1):', bigintToHex(neg_y_c1));
console.log('  bytes 96-127 (-y.c0):', bigintToHex(neg_y_c0));

// What Rust outputs for -beta (from test):
// y.c1 (64-95): 263ad6e327b5ba2412adbef38679e8cde3ffd51d6babbf223d5c76130cb5f805
// y.c0 (96-127): 1451b40a48a79859bd83f09e1b0c59585f0f62bd784ffd69061da56bcfcfd5ec

console.log('\nRust actual -beta y values:');
console.log('  y.c1:', '263ad6e327b5ba2412adbef38679e8cde3ffd51d6babbf223d5c76130cb5f805');
console.log('  y.c0:', '1451b40a48a79859bd83f09e1b0c59585f0f62bd784ffd69061da56bcfcfd5ec');
