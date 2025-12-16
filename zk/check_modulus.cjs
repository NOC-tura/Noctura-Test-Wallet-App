// BN128 field modulus
const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// Convert to bytes (big-endian)
function bigintToHex(num) {
    return num.toString(16).padStart(64, '0');
}

console.log('Correct modulus (hex):', bigintToHex(p));
console.log('\nRust FIELD_MODULUS_BE:');
console.log('30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');
