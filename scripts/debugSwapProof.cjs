/**
 * Debug swap proof verification locally
 */
const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const RPC = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  
  // Derive swap verifier PDA
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  
  console.log('Swap Verifier PDA:', swapVerifier.toBase58());
  
  // Fetch on-chain data
  const info = await connection.getAccountInfo(swapVerifier);
  if (!info) {
    console.log('Swap verifier account not found!');
    return;
  }
  
  console.log('Account size:', info.data.length, 'bytes');
  
  // Parse: 8 bytes discriminator + 4 bytes vec length + key data
  const discriminator = info.data.slice(0, 8);
  const keyLenBytes = info.data.slice(8, 12);
  const keyLen = keyLenBytes.readUInt32LE(0);
  const keyData = info.data.slice(12, 12 + keyLen);
  
  console.log('Key length:', keyLen, 'bytes');
  
  // Parse key structure:
  // alpha_g1: 64 bytes
  // beta_g2: 128 bytes
  // gamma_g2: 128 bytes
  // delta_g2: 128 bytes
  // ic_count: 4 bytes
  // ic_points: 64 * count bytes
  
  let offset = 0;
  const alpha = keyData.slice(offset, offset + 64); offset += 64;
  const beta = keyData.slice(offset, offset + 128); offset += 128;
  const gamma = keyData.slice(offset, offset + 128); offset += 128;
  const delta = keyData.slice(offset, offset + 128); offset += 128;
  const icCount = keyData.readUInt32LE(offset); offset += 4;
  
  console.log('\n=== ON-CHAIN VERIFIER KEY ===');
  console.log('Alpha G1 (first 32 bytes, should be x):', alpha.slice(0, 32).toString('hex'));
  console.log('IC count:', icCount);
  
  // Load local vkey
  const vkeyPath = '/Users/banel/Noctura-Wallet/zk/keys/swap.vkey.json';
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf-8'));
  
  console.log('\n=== LOCAL VKEY ===');
  console.log('nPublic:', vkey.nPublic);
  console.log('IC.length:', vkey.IC.length);
  
  // Compare alpha_g1
  const expectedAlphaX = BigInt(vkey.vk_alpha_1[0]).toString(16).padStart(64, '0');
  console.log('\nExpected alpha.x:', expectedAlphaX);
  console.log('On-chain alpha.x:', alpha.slice(0, 32).toString('hex'));
  console.log('Alpha X match:', expectedAlphaX === alpha.slice(0, 32).toString('hex'));
  
  // Check IC[0]
  const ic0 = keyData.slice(offset, offset + 64);
  const expectedIC0X = BigInt(vkey.IC[0][0]).toString(16).padStart(64, '0');
  const expectedIC0Y = BigInt(vkey.IC[0][1]).toString(16).padStart(64, '0');
  
  console.log('\n=== IC[0] Comparison ===');
  console.log('Expected IC[0].x:', expectedIC0X);
  console.log('On-chain IC[0].x:', ic0.slice(0, 32).toString('hex'));
  console.log('IC[0].x match:', expectedIC0X === ic0.slice(0, 32).toString('hex'));
  
  console.log('\nExpected IC[0].y:', expectedIC0Y);
  console.log('On-chain IC[0].y:', ic0.slice(32, 64).toString('hex'));
  console.log('IC[0].y match:', expectedIC0Y === ic0.slice(32, 64).toString('hex'));
  
  // Now let's verify a test proof locally with snarkjs
  console.log('\n=== LOCAL PROOF VERIFICATION TEST ===');
  try {
    const snarkjs = require('snarkjs');
    
    // Test with minimal witness input
    const wasmPath = '/Users/banel/Noctura-Wallet/zk/build/swap/swap_js/swap.wasm';
    const zkeyPath = '/Users/banel/Noctura-Wallet/zk/keys/swap.zkey';
    
    // Create test witness input for swap
    const testInput = {
      // Input note
      inSecret: '12345678901234567890',
      inAmount: '70000000', // 70 NOC atoms
      inTokenMint: '1', // NOC mint index
      inBlinding: '98765432109876543210',
      inRho: '11111111111111111111',
      
      // Merkle proof (dummy)
      pathElements: Array(20).fill('0'),
      pathIndices: Array(20).fill('0'),
      merkleRoot: '1386040550995243780002759510163582660011489214345951085402541590671998280839',
      
      // Output note
      outSecret: '999888777666555',
      outAmount: '996900', // Expected output from AMM
      outTokenMint: '0', // SOL mint index
      outBlinding: '444333222111',
      
      // Public inputs
      nullifier: '11584387738051056789354960705031889409375830262729278491305735871299289169140',
      expectedOutAmount: '996900',
    };
    
    console.log('Generating test proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(testInput, wasmPath, zkeyPath);
    console.log('Proof generated!');
    console.log('Public signals:', publicSignals);
    console.log('Public signals count:', publicSignals.length);
    
    // Verify locally
    console.log('\nVerifying proof locally with snarkjs...');
    const vkeyLocal = JSON.parse(fs.readFileSync(vkeyPath, 'utf-8'));
    const verified = await snarkjs.groth16.verify(vkeyLocal, publicSignals, proof);
    console.log('Local verification result:', verified ? '✅ VALID' : '❌ INVALID');
    
  } catch (err) {
    console.log('Local verification failed:', err.message);
  }
}

main().catch(console.error);
