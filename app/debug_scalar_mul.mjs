import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';

// Load expected verifier key
const vkey = JSON.parse(fs.readFileSync('../zk/keys/deposit.vkey.json', 'utf8'));

function decimalToBE(decStr) {
  let hex = BigInt(decStr).toString(16);
  if (hex.length < 64) hex = hex.padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function packG1(point) {
  const x = decimalToBE(point[0]);
  const y = decimalToBE(point[1]);
  return Buffer.concat([x, y]);
}

// IC[1] is the first point used in scalar multiplication
const IC1 = packG1(vkey.IC[1]);
console.log('IC[1] x:', IC1.slice(0, 32).toString('hex'));
console.log('IC[1] y:', IC1.slice(32, 64).toString('hex'));

// The scalar (public input)
const publicInput = Buffer.from('BbUNpP4upFSSo5lZKpo1ddfTUWJfrvE5YcSVkisu2vM=', 'base64');
console.log('Scalar (BE):', publicInput.toString('hex'));

// The expected input to alt_bn128_multiplication would be:
// 96 bytes = 64 bytes G1 point (IC[1]) + 32 bytes scalar
const mulInput = Buffer.concat([IC1, publicInput]);
console.log('');
console.log('Multiplication input (96 bytes):');
console.log(mulInput.toString('hex'));
console.log('');
console.log('Base64:', mulInput.toString('base64'));

// Check if scalar is valid (less than field modulus)
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
const scalarBigInt = BigInt('0x' + publicInput.toString('hex'));
console.log('');
console.log('Scalar as BigInt:', scalarBigInt.toString());
console.log('Field modulus:', FIELD_MODULUS.toString());
console.log('Scalar < modulus?', scalarBigInt < FIELD_MODULUS);

// Check if point is valid (coordinates less than field modulus)
const xBigInt = BigInt('0x' + IC1.slice(0, 32).toString('hex'));
const yBigInt = BigInt('0x' + IC1.slice(32, 64).toString('hex'));
console.log('');
console.log('IC[1].x as BigInt:', xBigInt.toString());
console.log('IC[1].x < modulus?', xBigInt < FIELD_MODULUS);
console.log('IC[1].y as BigInt:', yBigInt.toString());
console.log('IC[1].y < modulus?', yBigInt < FIELD_MODULUS);
