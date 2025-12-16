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

// Beta from vkey (in EIP-196 format: x.c1, x.c0, y.c1, y.c0)
const beta_x_c0 = toBigInt(vkey.vk_beta_2[0][0]);
const beta_x_c1 = toBigInt(vkey.vk_beta_2[0][1]);
const beta_y_c0 = toBigInt(vkey.vk_beta_2[1][0]);
const beta_y_c1 = toBigInt(vkey.vk_beta_2[1][1]);

console.log('Expected packed beta (EIP-196 format):');
console.log('  x.c1:', bigintToBuffer(beta_x_c1, 32).toString('base64'));
console.log('  x.c0:', bigintToBuffer(beta_x_c0, 32).toString('base64'));
console.log('  y.c1:', bigintToBuffer(beta_y_c1, 32).toString('base64'));
console.log('  y.c0:', bigintToBuffer(beta_y_c0, 32).toString('base64'));

// Negated
const neg_y_c0 = (p - beta_y_c0) % p;
const neg_y_c1 = (p - beta_y_c1) % p;

console.log('\nExpected -beta (EIP-196 format):');
console.log('  x.c1:', bigintToBuffer(beta_x_c1, 32).toString('base64'));
console.log('  x.c0:', bigintToBuffer(beta_x_c0, 32).toString('base64'));
console.log('  -y.c1:', bigintToBuffer(neg_y_c1, 32).toString('base64'));
console.log('  -y.c0:', bigintToBuffer(neg_y_c0, 32).toString('base64'));

console.log('\nRust packed beta:');
console.log('  x.c1:   LM/XoczL0cNvRkZ5M+PBBpjeE+0VwTSji3erO6Da7wc=');
console.log('  x.c0:   HI1pAVWZIkRk5H1wFuDHOJs2/X0vtobPdc5IWtJPOIk=');
console.log('  y.c1:   Cil3j7l75gWloobC+wdvj0Q0EysODbFvBoV/gONKB/w=');
console.log('  y.c0:   HBKaaJiKB8/6zFUYZnT/BMkkhYsBaXMoPcRQKCAwKhU=');

console.log('\nRust -beta:');
console.log('  x.c1:   LM/XoczL0cNvRkZ5M+PBBpjeE+0VwTSji3erO6Da7wc=');
console.log('  x.c0:   HI1pAVWZIkRk5H1wFuDHOJs2/X0vtobPdc5IWtJPOIk=');
console.log('  -y.c1:  JjrW4ye1uiQSrb7zhnnozeP/1R1rq78iPVx2Ewy1+AU=');
console.log('  -y.c0:  FFG0CkinmFm9g/CeGwxZWF8PYr14T/1pBh2la8/P1ew=');
