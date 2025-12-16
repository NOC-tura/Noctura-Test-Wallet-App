const fs = require('fs');
const vkey = JSON.parse(fs.readFileSync('keys/deposit.vkey.json', 'utf8'));

const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function toBigInt(str) { return BigInt(str); }
function bigintToHex(n) { return n.toString(16).padStart(64, '0'); }

// Gamma from vkey:
const gamma_y_c0 = toBigInt(vkey.vk_gamma_2[1][0]);
const gamma_y_c1 = toBigInt(vkey.vk_gamma_2[1][1]);

console.log('Gamma y from vkey:');
console.log('  y.c0:', gamma_y_c0.toString());
console.log('  y.c1:', gamma_y_c1.toString());

// Negated
const neg_y_c0 = (p - gamma_y_c0) % p;
const neg_y_c1 = (p - gamma_y_c1) % p;

console.log('\nExpected -gamma y:');
console.log('  -y.c1:', bigintToHex(neg_y_c1));
console.log('  -y.c0:', bigintToHex(neg_y_c0));

// Rust output for -beta (but might actually be gamma?)
console.log('\nRust -beta output:');
console.log('  y.c1:', '263ad6e327b5ba2412adbef38679e8cde3ffd51d6babbf223d5c76130cb5f805');
console.log('  y.c0:', '1451b40a48a79859bd83f09e1b0c59585f0f62bd784ffd69061da56bcfcfd5ec');
