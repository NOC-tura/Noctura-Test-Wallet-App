/**
 * Debug script to verify swap proof matches on-chain verifier
 * Checks that IC points in on-chain verifier match local vkey
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const RPC_URL = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

function bigintToBytesBE(value, length = 32) {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

function serializeG1Point(point) {
  const x = bigintToBytesBE(BigInt(point[0]));
  const y = bigintToBytesBE(BigInt(point[1]));
  return Buffer.concat([x, y]);
}

function serializeG2Point(point) {
  const xc0 = bigintToBytesBE(BigInt(point[0][0]));
  const xc1 = bigintToBytesBE(BigInt(point[0][1]));
  const yc0 = bigintToBytesBE(BigInt(point[1][0]));
  const yc1 = bigintToBytesBE(BigInt(point[1][1]));
  // EIP-196 order: [x.c1, x.c0, y.c1, y.c0]
  return Buffer.concat([xc1, xc0, yc1, yc0]);
}

async function main() {
  console.log('=== SWAP VERIFIER DEBUG ===\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load local vkey
  const vkeyPath = path.join(__dirname, '..', 'zk', 'keys', 'swap.vkey.json');
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf-8'));
  console.log('Local vkey:');
  console.log('  nPublic:', vkey.nPublic);
  console.log('  IC count:', vkey.IC.length);
  
  // Derive swap verifier PDA
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  console.log('\nSwap Verifier PDA:', swapVerifier.toBase58());
  
  // Fetch on-chain data
  const accountInfo = await connection.getAccountInfo(swapVerifier);
  if (!accountInfo) {
    console.log('ERROR: Swap verifier not found on-chain!');
    return;
  }
  
  console.log('\nOn-chain verifier:');
  console.log('  Account size:', accountInfo.data.length, 'bytes');
  
  // Skip 8-byte discriminator for Anchor account
  const data = accountInfo.data.slice(8);
  
  // Parse vkey blob: first 4 bytes = vec length
  const vecLen = data.readUInt32LE(0);
  console.log('  Verifier key vec length:', vecLen, 'bytes');
  
  const keyData = data.slice(4, 4 + vecLen);
  
  // Parse key structure:
  // alpha_g1: 64 bytes
  // beta_g2: 128 bytes
  // gamma_g2: 128 bytes
  // delta_g2: 128 bytes
  // ic_count: 4 bytes (little-endian)
  // ic_points: 64 * ic_count bytes
  
  let offset = 0;
  const onChainAlpha = keyData.slice(offset, offset + 64); offset += 64;
  const onChainBeta = keyData.slice(offset, offset + 128); offset += 128;
  const onChainGamma = keyData.slice(offset, offset + 128); offset += 128;
  const onChainDelta = keyData.slice(offset, offset + 128); offset += 128;
  const icCount = keyData.readUInt32LE(offset); offset += 4;
  
  console.log('  IC count on-chain:', icCount);
  
  // Serialize local vkey for comparison
  const localAlpha = serializeG1Point(vkey.vk_alpha_1);
  const localBeta = serializeG2Point(vkey.vk_beta_2);
  const localGamma = serializeG2Point(vkey.vk_gamma_2);
  const localDelta = serializeG2Point(vkey.vk_delta_2);
  
  console.log('\n=== COMPARISON ===\n');
  
  // Compare alpha
  const alphaMatch = onChainAlpha.equals(localAlpha);
  console.log('Alpha G1 match:', alphaMatch);
  if (!alphaMatch) {
    console.log('  Local:', localAlpha.toString('hex'));
    console.log('  Chain:', onChainAlpha.toString('hex'));
  }
  
  // Compare beta
  const betaMatch = onChainBeta.equals(localBeta);
  console.log('Beta G2 match:', betaMatch);
  if (!betaMatch) {
    console.log('  Local:', localBeta.toString('hex'));
    console.log('  Chain:', onChainBeta.toString('hex'));
  }
  
  // Compare gamma
  const gammaMatch = onChainGamma.equals(localGamma);
  console.log('Gamma G2 match:', gammaMatch);
  if (!gammaMatch) {
    console.log('  Local:', localGamma.toString('hex'));
    console.log('  Chain:', onChainGamma.toString('hex'));
  }
  
  // Compare delta
  const deltaMatch = onChainDelta.equals(localDelta);
  console.log('Delta G2 match:', deltaMatch);
  if (!deltaMatch) {
    console.log('  Local:', localDelta.toString('hex'));
    console.log('  Chain:', onChainDelta.toString('hex'));
  }
  
  // Compare IC count
  const icCountMatch = icCount === vkey.IC.length;
  console.log('IC count match:', icCountMatch, `(local=${vkey.IC.length}, chain=${icCount})`);
  
  // Compare each IC point
  console.log('\nIC points comparison:');
  for (let i = 0; i < Math.min(icCount, vkey.IC.length); i++) {
    const onChainIC = keyData.slice(offset + i * 64, offset + (i + 1) * 64);
    const localIC = serializeG1Point(vkey.IC[i]);
    const match = onChainIC.equals(localIC);
    if (!match) {
      console.log(`  IC[${i}]: MISMATCH`);
      console.log(`    Local: ${localIC.toString('hex').slice(0, 40)}...`);
      console.log(`    Chain: ${onChainIC.toString('hex').slice(0, 40)}...`);
    } else {
      console.log(`  IC[${i}]: ✓`);
    }
  }
  
  // Final verdict
  console.log('\n=== VERDICT ===');
  if (alphaMatch && betaMatch && gammaMatch && deltaMatch && icCountMatch) {
    console.log('Verifier key MATCHES local vkey!');
    console.log('The proof verification failure must be due to:');
    console.log('  1. Proof serialization error');
    console.log('  2. Public inputs ordering issue');
    console.log('  3. zkey/vkey regenerated after on-chain upload');
  } else {
    console.log('Verifier key MISMATCH detected!');
    console.log('You need to re-upload the verifier using:');
    console.log('  npx ts-node scripts/uploadSwapVerifier.ts');
  }
}

main().catch(console.error);
