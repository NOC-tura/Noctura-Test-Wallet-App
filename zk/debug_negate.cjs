const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// Convert to bigint from hex
function hexToBigInt(hex) {
    return BigInt('0x' + hex);
}

function bigintToHex(n) {
    const hex = n.toString(16).padStart(64, '0');
    return hex;
}

// Rust y.c1 before negation (from the test output, let's get the original gamma)
// Gamma from vkey:
// y[0] (y.c0): 8495653923123431417604973247489272438418190587263600148770280649306958101930
// y[1] (y.c1): 4082367875863433681332203403145435568316851327593401208105741076214120093531

const y_c0 = 8495653923123431417604973247489272438418190587263600148770280649306958101930n;
const y_c1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531n;

console.log('Original y.c0:', bigintToHex(y_c0));
console.log('Original y.c1:', bigintToHex(y_c1));

// JS negation
const y_c0_neg = (p - y_c0) % p;
const y_c1_neg = (p - y_c1) % p;
console.log('\nJS negated:');
console.log('  -y.c0:', bigintToHex(y_c0_neg));
console.log('  -y.c1:', bigintToHex(y_c1_neg));

// Expected in EIP-196 format: [x.c1, x.c0, y.c1_neg, y.c0_neg]
// So position 64-96 should be y.c1_neg, position 96-128 should be y.c0_neg

// Rust output says y.c1 (64-95): 263ad6e327b5ba2412adbef38679e8cde3ffd51d6babbf223d5c76130cb5f805
// Rust output says y.c0 (96-127): 1451b40a48a79859bd83f09e1b0c59585f0f62bd784ffd69061da56bcfcfd5ec

const rust_y_c1_neg = hexToBigInt('263ad6e327b5ba2412adbef38679e8cde3ffd51d6babbf223d5c76130cb5f805');
const rust_y_c0_neg = hexToBigInt('1451b40a48a79859bd83f09e1b0c59585f0f62bd784ffd69061da56bcfcfd5ec');

console.log('\nRust -gamma:');
console.log('  -y.c1:', bigintToHex(rust_y_c1_neg));
console.log('  -y.c0:', bigintToHex(rust_y_c0_neg));

console.log('\nComparison:');
console.log('  y.c1_neg matches:', y_c1_neg === rust_y_c1_neg);
console.log('  y.c0_neg matches:', y_c0_neg === rust_y_c0_neg);

console.log('\nActual values:');
console.log('  JS -y.c1:', y_c1_neg.toString());
console.log('  Rust -y.c1:', rust_y_c1_neg.toString());
console.log('  JS -y.c0:', y_c0_neg.toString());  
console.log('  Rust -y.c0:', rust_y_c0_neg.toString());
