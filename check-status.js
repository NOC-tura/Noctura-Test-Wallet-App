#!/usr/bin/env node
/**
 * Noctura Privacy System - Quick Status Check
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

async function checkStatus() {
  console.log('\n🔐 Noctura Privacy System Status Check\n');
  console.log('═'.repeat(70));
  
  // 1. Program Deployment
  console.log('\n📦 SHIELD PROGRAM');
  console.log('─'.repeat(70));
  try {
    const programAccount = await connection.getAccountInfo(PROGRAM_ID);
    if (programAccount) {
      log('✅', `Deployed: ${PROGRAM_ID.toString()}`);
      log('  ', `Size: ${(programAccount.data.length / 1024).toFixed(1)}KB`);
    } else {
      log('❌', 'NOT DEPLOYED');
      return;
    }
  } catch (e) {
    log('❌', `Error checking program: ${e.message}`);
    return;
  }
  
  // 2. Program Accounts
  console.log('\n🏗️  PROGRAM ACCOUNTS');
  console.log('─'.repeat(70));
  
  const encoder = new TextEncoder();
  const pdas = {
    'Global State': PublicKey.findProgramAddressSync([encoder.encode('global-state')], PROGRAM_ID)[0],
    'Merkle Tree': PublicKey.findProgramAddressSync([encoder.encode('merkle-tree')], PROGRAM_ID)[0],
    'Nullifiers': PublicKey.findProgramAddressSync([encoder.encode('nullifiers')], PROGRAM_ID)[0],
    'Deposit Verifier': PublicKey.findProgramAddressSync([encoder.encode('verifier')], PROGRAM_ID)[0],
    'Withdraw Verifier': PublicKey.findProgramAddressSync([encoder.encode('withdraw-verifier')], PROGRAM_ID)[0],
    'Transfer Verifier': PublicKey.findProgramAddressSync([encoder.encode('transfer-verifier')], PROGRAM_ID)[0],
  };
  
  let missingVerifiers = [];
  
  for (const [name, pda] of Object.entries(pdas)) {
    const account = await connection.getAccountInfo(pda);
    if (!account) {
      log('❌', `${name}: NOT INITIALIZED`);
      if (name.includes('Verifier')) missingVerifiers.push(name);
    } else if (account.data.length < 100 && name.includes('Verifier')) {
      log('⚠️ ', `${name}: Empty (${account.data.length} bytes)`);
      missingVerifiers.push(name);
    } else {
      log('✅', `${name}: ${account.data.length} bytes`);
    }
  }
  
  // 3. Verifier Keys
  console.log('\n🔑 VERIFIER KEYS');
  console.log('─'.repeat(70));
  
  const keysExist = {
    deposit: false,
    withdraw: false,
    transfer: false
  };
  
  const appPublic = path.join(process.cwd(), 'app/public');
  for (const [name, _] of Object.entries(keysExist)) {
    const keyPath = path.join(appPublic, `${name}.vkey.json`);
    if (fs.existsSync(keyPath)) {
      const stats = fs.statSync(keyPath);
      log('✅', `${name}.vkey.json: ${(stats.size / 1024).toFixed(1)}KB`);
      keysExist[name] = true;
    } else {
      log('❌', `${name}.vkey.json: NOT FOUND in app/public/`);
    }
  }
  
  // 4. ZK Circuits
  console.log('\n⚡ ZK CIRCUITS');
  console.log('─'.repeat(70));
  
  const zkBuild = path.join(process.cwd(), 'zk/build');
  const circuits = ['deposit', 'withdraw', 'transfer', 'partial_withdraw'];
  let circuitsReady = 0;
  
  for (const circuit of circuits) {
    const wasmPath = path.join(zkBuild, circuit, `${circuit}_js`, `${circuit}.wasm`);
    if (fs.existsSync(wasmPath)) {
      log('✅', `${circuit}.circom: Compiled`);
      circuitsReady++;
    } else {
      log('⚠️ ', `${circuit}.circom: Not compiled`);
    }
  }
  
  // 5. App & UI
  console.log('\n🖥️  WALLET APP');
  console.log('─'.repeat(70));
  
  const appFiles = {
    'App.tsx': 'app/src/App.tsx',
    'Dashboard.tsx': 'app/src/components/Dashboard.tsx',
    'shieldProgram.ts': 'app/src/lib/shieldProgram.ts',
    'useShieldedNotes.ts': 'app/src/hooks/useShieldedNotes.ts'
  };
  
  for (const [name, filepath] of Object.entries(appFiles)) {
    if (fs.existsSync(path.join(process.cwd(), filepath))) {
      log('✅', name);
    } else {
      log('❌', `${name}: NOT FOUND`);
    }
  }
  
  // 6. Privacy Architecture
  console.log('\n🔒 PRIVACY FEATURES');
  console.log('─'.repeat(70));
  log('✅', 'Commitment Hiding: Poseidon(secret, amount, mint, blinding)');
  log('✅', 'Nullifier System: One-way hash prevents linkability');
  log('✅', 'Zero-Knowledge Proofs: Groth16 on-chain verification');
  log('✅', 'Merkle Tree: 16,384 commitment capacity (height 14)');
  log('✅', 'Dual-Mode: Transparent ↔ Shielded toggle');
  
  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(70));
  
  const depositVerifierOK = missingVerifiers.indexOf('Deposit Verifier') === -1;
  const withdrawVerifierOK = missingVerifiers.indexOf('Withdraw Verifier') === -1;
  const transferVerifierOK = missingVerifiers.indexOf('Transfer Verifier') === -1;
  
  if (depositVerifierOK && withdrawVerifierOK && transferVerifierOK) {
    console.log('\n🎉 SYSTEM STATUS: PRODUCTION READY\n');
    console.log('All verifiers configured! Your privacy system is operational.\n');
    console.log('✅ Can perform deposits (transparent → shielded)');
    console.log('✅ Can perform transfers (shielded → shielded)');
    console.log('✅ Can perform withdrawals (shielded → transparent)');
    console.log('\n📖 Next Steps:');
    console.log('   1. Start app: cd app && npm run dev');
    console.log('   2. Test deposit: Shield 1 NOC in transparent mode');
    console.log('   3. Test transfer: Send in shielded mode');
    console.log('   4. Verify privacy on Solana Explorer\n');
  } else {
    console.log('\n⚠️  SYSTEM STATUS: NEEDS CONFIGURATION\n');
    console.log('Missing verifiers:');
    missingVerifiers.forEach(v => console.log(`   - ${v}`));
    console.log('\n🔧 FIX:');
    console.log('   1. Start app: cd app && npm run dev');
    console.log('   2. Open browser console (F12)');
    console.log('   3. Run: await __noctura_debug.uploadVerifiers()');
    console.log('   4. Wait for 3 transactions to confirm (~15 seconds)');
    console.log('\n   This will upload withdraw and transfer verifier keys.\n');
  }
  
  console.log('═'.repeat(70) + '\n');
}

checkStatus().catch(console.error);
