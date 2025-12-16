#!/usr/bin/env node

/**
 * Simple script to find the fee collector address
 * Run this to see where 0.25 NOC shielded transaction fees are collected
 */

const path = require('path');

// Add app/node_modules to require path
const appNodeModules = path.join(__dirname, '../app/node_modules');
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id.startsWith('@') || id === 'bs58' || id === 'tweetnacl' || id.includes('solana')) {
    try {
      return originalRequire.call(this, path.join(appNodeModules, id));
    } catch (e) {
      return originalRequire.call(this, id);
    }
  }
  return originalRequire.call(this, id);
};

const { PublicKey, Connection } = require('@solana/web3.js');
const { AnchorProvider, Program } = require('@coral-xyz/anchor');
const fs = require('fs');

const SHIELD_PROGRAM_ID = '3KN2qr8t4PYZUWKvUfL5RGzvCo8TyKryw5APDz';
const RPC_URL = 'https://api.devnet.solana.com';

async function getFeeCollector() {
  try {
    console.log('🔍 Checking Noctura Shield Program...');
    console.log('Program ID:', SHIELD_PROGRAM_ID);
    console.log('RPC:', RPC_URL);
    console.log('');

    const connection = new Connection(RPC_URL, 'confirmed');
    
    // Derive global state PDA
    const encoder = new TextEncoder();
    const GLOBAL_STATE_SEED = encoder.encode('global-state');
    const programId = new PublicKey(SHIELD_PROGRAM_ID);
    
    const [globalStatePda] = PublicKey.findProgramAddressSync(
      [GLOBAL_STATE_SEED],
      programId
    );

    console.log('Global State PDA:', globalStatePda.toBase58());
    console.log('');

    // Load IDL
    const idlPath = path.join(
      __dirname,
      '../app/src/lib/idl/noctura_shield.json'
    );
    
    if (!fs.existsSync(idlPath)) {
      console.log('❌ IDL file not found at:', idlPath);
      console.log('');
      console.log('Alternative: Use browser console:');
      console.log('  window.debugApi.checkFeeCollector()');
      process.exit(1);
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

    // Create a dummy wallet for reading
    const dummyWallet = {
      publicKey: new PublicKey('11111111111111111111111111111111'),
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    };

    const provider = new AnchorProvider(connection, dummyWallet, {
      commitment: 'confirmed',
    });

    const program = new Program(idl, programId, provider);

    // Fetch global state
    console.log('⏳ Fetching global state from blockchain...');
    const globalState = await program.account.globalState.fetch(globalStatePda);

    const feeCollector = globalState.feeCollector;
    
    console.log('✅ Fee Collector Address Found!');
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('Fee Collector: ' + feeCollector);
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('This address receives 0.25 NOC from every shielded transaction:');
    console.log('  • Deposits');
    console.log('  • Transfers');
    console.log('  • Withdrawals');
    console.log('');
    console.log('View on Solana Explorer:');
    console.log(`https://explorer.solana.com/address/${feeCollector}?cluster=devnet`);
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    console.log('1. Ensure Solana devnet is accessible');
    console.log('2. Shield program must be initialized');
    console.log('3. Or use browser console: window.debugApi.checkFeeCollector()');
    process.exit(1);
  }
}

getFeeCollector();
