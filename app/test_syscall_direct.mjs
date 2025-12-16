import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, } from '@solana/web3.js';
import fs from 'fs';

const connection = new Connection('https://api.testnet.solana.com', 'confirmed');

// Load wallet
const walletPath = process.env.HOME + '/config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

const programId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Test with a simple known-good case from Solana test vectors
// Point (1, 2) multiplied by 1 should return (1, 2)
const point1x = '0000000000000000000000000000000000000000000000000000000000000001';
const point1y = '0000000000000000000000000000000000000000000000000000000000000002';
const scalar1 = '0000000000000000000000000000000000000000000000000000000000000001';

console.log('Test 1: Multiply point (1,2) by scalar 1');
console.log('Input:', point1x + point1y + scalar1);

// Let's check if the point (1,2) is even a valid point on bn254
// y^2 = x^3 + 3 (mod p)
const p = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
const x = BigInt(1);
const y = BigInt(2);
const lhs = (y * y) % p;
const rhs = ((x * x * x) + BigInt(3)) % p;
console.log('y^2 mod p:', lhs.toString());
console.log('x^3 + 3 mod p:', rhs.toString());
console.log('Point (1,2) is valid?:', lhs === rhs);

// Actually, let's use the generator point which is definitely valid
// Generator G1: (1, 2) is actually NOT the generator
// The generator is:
// x = 1
// y = 2
// Wait, actually (1, 2) IS a valid point because 2^2 = 4, and 1^3 + 3 = 4

// Let's test with our known-good proof's IC[1]
const ic1x = '18c9c4e1ec9265c9ae4fe681301df2166f0bd62559cc34d93342bacf50be02cd';
const ic1y = '2e4a0bd358e5876d3068a6324ecc04f7114935afdbee26c7c7cece8323412df0';
const knownScalar = '05b50da4fe2ea45492a399592a9a3575d7d351625faef13961c495922b2edaf3';

console.log('\nTest 2: Our IC[1] multiplied by known scalar');
console.log('IC[1].x:', ic1x);
console.log('IC[1].y:', ic1y);
console.log('Scalar:', knownScalar);

// Verify IC[1] is a valid point
const ic1X = BigInt('0x' + ic1x);
const ic1Y = BigInt('0x' + ic1y);
const lhs2 = (ic1Y * ic1Y) % p;
const rhs2 = ((ic1X * ic1X * ic1X) + BigInt(3)) % p;
console.log('IC[1] is valid point?:', lhs2 === rhs2);
console.log('  y^2 mod p:', lhs2.toString(16));
console.log('  x^3 + 3 mod p:', rhs2.toString(16));
