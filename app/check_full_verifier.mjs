import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';

// Pack G1 point to EIP-196 format (64 bytes, BE)
function packG1(point) {
  const x = decimalToBE(point[0]);
  const y = decimalToBE(point[1]);
  return Buffer.concat([x, y]);
}

// Pack G2 point to EIP-196 format (128 bytes, BE): [x.c1, x.c0, y.c1, y.c0]
function packG2(point) {
  const x = point[0]; // [c0, c1]
  const y = point[1]; // [c0, c1]
  return Buffer.concat([
    decimalToBE(x[1]), // x.c1 (imaginary)
    decimalToBE(x[0]), // x.c0 (real)
    decimalToBE(y[1]), // y.c1 (imaginary)
    decimalToBE(y[0]), // y.c0 (real)
  ]);
}

function decimalToBE(decStr) {
  let hex = BigInt(decStr).toString(16);
  if (hex.length < 64) hex = hex.padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

async function main() {
  const programId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
  const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
  
  // Load expected verifier key
  const vkey = JSON.parse(fs.readFileSync('../zk/keys/deposit.vkey.json', 'utf8'));
  
  const expectedAlphaG1 = packG1(vkey.vk_alpha_1);
  const expectedBetaG2 = packG2(vkey.vk_beta_2);
  const expectedGammaG2 = packG2(vkey.vk_gamma_2);
  const expectedDeltaG2 = packG2(vkey.vk_delta_2);
  const expectedIC = vkey.IC.map(packG1);
  
  console.log('Expected values from vkey.json:');
  console.log('alpha_g1:', expectedAlphaG1.toString('hex'));
  console.log('beta_g2:', expectedBetaG2.toString('hex'));
  console.log('gamma_g2:', expectedGammaG2.toString('hex'));
  console.log('delta_g2:', expectedDeltaG2.toString('hex'));
  console.log('IC[0]:', expectedIC[0].toString('hex'));
  console.log('IC[1]:', expectedIC[1].toString('hex'));
  console.log('IC[2]:', expectedIC[2].toString('hex'));
  console.log('');
  
  const [verifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('verifier')],
    programId
  );
  
  console.log('Verifier PDA:', verifierPda.toBase58());
  
  const accountInfo = await connection.getAccountInfo(verifierPda);
  if (!accountInfo) {
    console.log('Account not found');
    return;
  }
  
  // Skip 8 byte discriminator, then read verifying_key vec
  const data = accountInfo.data.slice(8);
  const vecLen = data.readUInt32LE(0);
  const vkBytes = data.slice(4, 4 + vecLen);
  
  // Parse on-chain VK structure
  const onChainAlphaG1 = vkBytes.slice(0, 64);
  const onChainBetaG2 = vkBytes.slice(64, 192);
  const onChainGammaG2 = vkBytes.slice(192, 320);
  const onChainDeltaG2 = vkBytes.slice(320, 448);
  // IC is a Vec, so it starts with a length
  const icVecLen = vkBytes.readUInt32LE(448);
  const icStart = 452;
  const onChainIC0 = vkBytes.slice(icStart, icStart + 64);
  const onChainIC1 = vkBytes.slice(icStart + 64, icStart + 128);
  const onChainIC2 = vkBytes.slice(icStart + 128, icStart + 192);
  
  console.log('On-chain values:');
  console.log('alpha_g1:', onChainAlphaG1.toString('hex'));
  console.log('beta_g2:', onChainBetaG2.toString('hex'));
  console.log('gamma_g2:', onChainGammaG2.toString('hex'));
  console.log('delta_g2:', onChainDeltaG2.toString('hex'));
  console.log('IC vec length:', icVecLen);
  console.log('IC[0]:', onChainIC0.toString('hex'));
  console.log('IC[1]:', onChainIC1.toString('hex'));
  console.log('IC[2]:', onChainIC2.toString('hex'));
  console.log('');
  
  // Compare
  console.log('Comparison:');
  console.log('alpha_g1 match:', expectedAlphaG1.equals(onChainAlphaG1) ? '✓' : '✗');
  console.log('beta_g2 match:', expectedBetaG2.equals(onChainBetaG2) ? '✓' : '✗');
  console.log('gamma_g2 match:', expectedGammaG2.equals(onChainGammaG2) ? '✓' : '✗');
  console.log('delta_g2 match:', expectedDeltaG2.equals(onChainDeltaG2) ? '✓' : '✗');
  console.log('IC[0] match:', expectedIC[0].equals(onChainIC0) ? '✓' : '✗');
  console.log('IC[1] match:', expectedIC[1].equals(onChainIC1) ? '✓' : '✗');
  console.log('IC[2] match:', expectedIC[2].equals(onChainIC2) ? '✓' : '✗');
  
  if (!expectedBetaG2.equals(onChainBetaG2)) {
    console.log('\nBeta G2 mismatch details:');
    for (let i = 0; i < 128; i++) {
      if (expectedBetaG2[i] !== onChainBetaG2[i]) {
        console.log(`Byte ${i}: expected ${expectedBetaG2[i].toString(16).padStart(2, '0')}, got ${onChainBetaG2[i].toString(16).padStart(2, '0')}`);
      }
    }
  }
}

main().catch(console.error);
