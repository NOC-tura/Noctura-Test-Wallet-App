#!/usr/bin/env node
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BinaryWriter } from 'borsh';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const idl = require('../src/lib/idl/noctura_shield.json');

const encoder = new TextEncoder();
const DEFAULT_PROGRAM = '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_VKEY_PATH = resolve(REPO_ROOT, 'zk/keys/deposit.vkey.json');
const DEFAULT_WITHDRAW_VKEY_PATH = resolve(REPO_ROOT, 'zk/keys/withdraw.vkey.json');

function requireEnvWallet(provider) {
  if (!provider.wallet?.publicKey) {
    throw new Error('Anchor provider wallet missing. Set ANCHOR_WALLET + ANCHOR_PROVIDER_URL.');
  }
  return provider.wallet.publicKey;
}

function derivePda(label, programId, extraSeed) {
  const seeds = [encoder.encode(label)];
  if (extraSeed) {
    seeds.push(extraSeed);
  }
  return PublicKey.findProgramAddressSync(seeds, programId);
}

async function main() {
  const provider = AnchorProvider.env();

  const walletPubkey = requireEnvWallet(provider);
  const idlAddress = idl?.metadata?.address;
  const programId = new PublicKey(process.env.SHIELD_PROGRAM || process.env.VITE_SHIELD_PROGRAM || idlAddress || DEFAULT_PROGRAM);
  const program = new Program(idl, programId, provider);

  const treeHeight = Number(process.env.TREE_HEIGHT ?? 20);
  const shieldFeeBps = Number(process.env.SHIELD_FEE_BPS ?? 100);
  const priorityFeeBps = Number(process.env.PRIORITY_FEE_BPS ?? shieldFeeBps);
  const feeCollector = new PublicKey(process.env.FEE_COLLECTOR || walletPubkey.toBase58());
  const forceSetVerifier = String(process.env.FORCE_SET_VERIFIER).toLowerCase() === 'true';

  const [globalState] = derivePda('global-state', programId);
  const [merkleTree] = derivePda('merkle-tree', programId);
  const [nullifierSet] = derivePda('nullifiers', programId);
  const [verifier] = derivePda('verifier', programId);
  const [withdrawVerifier] = derivePda('withdraw-verifier', programId);
  const [transferVerifier] = derivePda('transfer-verifier', programId);
  const [partialWithdrawVerifier] = derivePda('partial-withdraw-verifier', programId);

  console.log('⚙️  Bootstrapping shield contract');
  console.log('  Program:', programId.toBase58());
  console.log('  Admin wallet:', walletPubkey.toBase58());
  console.log('  Fee collector:', feeCollector.toBase58());
  console.log('  Tree height:', treeHeight);
  console.log('  Shield fee (bps):', shieldFeeBps);
  console.log('  Priority fee (bps):', priorityFeeBps);
  console.log('  Merkle tree PDA:', merkleTree.toBase58());

  const existingGlobal = await program.account.globalState.fetchNullable(globalState);
  if (existingGlobal) {
    if (existingGlobal.admin.toBase58() !== walletPubkey.toBase58()) {
      throw new Error(`Global state already initialized by ${existingGlobal.admin.toBase58()}`);
    }
    console.log('ℹ️  Shield PDAs already initialized; skipping initialize().');
  } else {
    await program.methods
      .initialize(treeHeight, feeCollector, shieldFeeBps, priorityFeeBps)
      .accounts({
        admin: walletPubkey,
        globalState,
        merkleTree,
        nullifierSet,
        verifier,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✅  Shield PDAs initialized.');
  }
  console.log('   global_state:', globalState.toBase58());
  console.log('   merkle_tree:', merkleTree.toBase58());
  console.log('   nullifier_set:', nullifierSet.toBase58());
  console.log('   verifier:', verifier.toBase58());

  const verifierPath = process.env.VERIFYING_KEY_PATH || DEFAULT_VKEY_PATH;
  try {
    const verifierAccount = await program.account.verifierAccount.fetch(verifier);
    const existingBytes = verifierAccount.verifyingKey?.length ?? 0;
    if (existingBytes > 0 && !forceSetVerifier) {
      console.log(`✅  Verifier key already uploaded (${existingBytes} bytes); skipping.`);
    } else {
      if (forceSetVerifier && existingBytes > 0) {
        console.log(`↻  FORCE_SET_VERIFIER enabled; replacing existing key (${existingBytes} bytes).`);
      }
      const packedKey = await buildVerifierBlob(verifierPath);
      console.log('⬆️  Uploading verifier key from', verifierPath);
      await program.methods
        .setVerifier(Buffer.from(packedKey))
        .accounts({
          admin: walletPubkey,
          globalState,
          verifier,
        })
        .rpc();
      console.log('✅  Verifier key uploaded.');
    }
  } catch (err) {
    console.warn('⚠️  Could not upload verifier key:', err.message ?? err);
  }

  // Upload withdraw verifier key
  const withdrawVerifierPath = process.env.WITHDRAW_VERIFYING_KEY_PATH || DEFAULT_WITHDRAW_VKEY_PATH;
  try {
    let existingWithdrawBytes = 0;
    try {
      const withdrawVerifierAccount = await program.account.verifierAccount.fetch(withdrawVerifier);
      existingWithdrawBytes = withdrawVerifierAccount.verifyingKey?.length ?? 0;
    } catch {
      // Account doesn't exist yet, that's fine
    }
    if (existingWithdrawBytes > 0 && !forceSetVerifier) {
      console.log(`✅  Withdraw verifier key already uploaded (${existingWithdrawBytes} bytes); skipping.`);
    } else {
      if (forceSetVerifier && existingWithdrawBytes > 0) {
        console.log(`↻  FORCE_SET_VERIFIER enabled; replacing existing withdraw key (${existingWithdrawBytes} bytes).`);
      }
      const packedKey = await buildVerifierBlob(withdrawVerifierPath);
      console.log('⬆️  Uploading withdraw verifier key from', withdrawVerifierPath);
      await program.methods
        .setWithdrawVerifier(Buffer.from(packedKey))
        .accounts({
          admin: walletPubkey,
          globalState,
          withdrawVerifier,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log('✅  Withdraw verifier key uploaded.');
    }
  } catch (err) {
    console.warn('⚠️  Could not upload withdraw verifier key:', err.message ?? err);
  }

  // Upload transfer verifier key
  const transferVerifierPath = process.env.TRANSFER_VERIFYING_KEY_PATH || resolve(REPO_ROOT, 'zk/keys/transfer.vkey.json');
  try {
    let existingTransferBytes = 0;
    try {
      const transferVerifierAccount = await program.account.verifierAccount.fetch(transferVerifier);
      existingTransferBytes = transferVerifierAccount.verifyingKey?.length ?? 0;
    } catch {
      // Account doesn't exist yet, that's fine
    }
    if (existingTransferBytes > 0 && !forceSetVerifier) {
      console.log(`✅  Transfer verifier key already uploaded (${existingTransferBytes} bytes); skipping.`);
    } else {
      if (forceSetVerifier && existingTransferBytes > 0) {
        console.log(`↻  FORCE_SET_VERIFIER enabled; replacing existing transfer key (${existingTransferBytes} bytes).`);
      }
      const packedKey = await buildVerifierBlob(transferVerifierPath);
      console.log('⬆️  Uploading transfer verifier key from', transferVerifierPath);
      await program.methods
        .setTransferVerifier(Buffer.from(packedKey))
        .accounts({
          admin: walletPubkey,
          globalState,
          transferVerifier,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log('✅  Transfer verifier key uploaded.');
    }
  } catch (err) {
    console.warn('⚠️  Could not upload transfer verifier key:', err.message ?? err);
  }

  // Upload partial_withdraw verifier key
  const partialWithdrawVerifierPath = process.env.PARTIAL_WITHDRAW_VERIFYING_KEY_PATH || resolve(REPO_ROOT, 'zk/build/partial_withdraw/partial_withdraw_vkey.json');
  try {
    let existingPartialWithdrawBytes = 0;
    try {
      const partialWithdrawVerifierAccount = await program.account.verifierAccount.fetch(partialWithdrawVerifier);
      existingPartialWithdrawBytes = partialWithdrawVerifierAccount.verifyingKey?.length ?? 0;
    } catch {
      // Account doesn't exist yet, that's fine
    }
    if (existingPartialWithdrawBytes > 0 && !forceSetVerifier) {
      console.log(`✅  Partial withdraw verifier key already uploaded (${existingPartialWithdrawBytes} bytes); skipping.`);
    } else {
      if (forceSetVerifier && existingPartialWithdrawBytes > 0) {
        console.log(`↻  FORCE_SET_VERIFIER enabled; replacing existing partial_withdraw key (${existingPartialWithdrawBytes} bytes).`);
      }
      const packedKey = await buildVerifierBlob(partialWithdrawVerifierPath);
      console.log('⬆️  Uploading partial_withdraw verifier key from', partialWithdrawVerifierPath);
      await program.methods
        .setPartialWithdrawVerifier(Buffer.from(packedKey))
        .accounts({
          admin: walletPubkey,
          globalState,
          partialWithdrawVerifier,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log('✅  Partial withdraw verifier key uploaded.');
    }
  } catch (err) {
    console.warn('⚠️  Could not upload partial_withdraw verifier key:', err.message ?? err);
  }
}

main().catch((err) => {
  console.error('Initialization failed:', err);
  process.exit(1);
});

async function buildVerifierBlob(filePath) {
  const json = JSON.parse(await readFile(filePath, 'utf8'));
  const packed = {
    alpha_g1: packG1(json.vk_alpha_1),
    beta_g2: packG2(json.vk_beta_2),
    gamma_g2: packG2(json.vk_gamma_2),
    delta_g2: packG2(json.vk_delta_2),
    ic: json.IC.map(packG1),
  };
  return serializePackedVerifierKey(packed);
}

function serializePackedVerifierKey(packed) {
  const writer = new BinaryWriter();
  writer.writeFixedArray(packed.alpha_g1);
  writer.writeFixedArray(packed.beta_g2);
  writer.writeFixedArray(packed.gamma_g2);
  writer.writeFixedArray(packed.delta_g2);
  writer.writeArray(packed.ic, (point) => writer.writeFixedArray(point));
  return writer.toArray();
}

function packG1(point) {
  if (!Array.isArray(point) || point.length < 2) {
    throw new Error('Malformed G1 point in verifying key');
  }
  const buffer = new Uint8Array(64);
  buffer.set(decimalToBytesBE(point[0]), 0);
  buffer.set(decimalToBytesBE(point[1]), 32);
  return buffer;
}

function packG2(point) {
  if (!Array.isArray(point) || point.length < 2) {
    throw new Error('Malformed G2 point in verifying key');
  }
  const [x, y] = point;
  if (!Array.isArray(x) || !Array.isArray(y) || x.length < 2 || y.length < 2) {
    throw new Error('Malformed G2 coordinates');
  }
  // EIP-196 format: [x.c1, x.c0, y.c1, y.c0]
  // snarkjs vkey format: x=[c0, c1], y=[c0, c1]
  const buffer = new Uint8Array(128);
  buffer.set(decimalToBytesBE(x[1]), 0);  // x.c1 (imag)
  buffer.set(decimalToBytesBE(x[0]), 32); // x.c0 (real)
  buffer.set(decimalToBytesBE(y[1]), 64); // y.c1 (imag)
  buffer.set(decimalToBytesBE(y[0]), 96); // y.c0 (real)
  return buffer;
}

function decimalToBytesBE(value, length = 32) {
  const bigint = BigInt(value);
  if (bigint < 0n) {
    throw new Error('Verifier key field elements must be non-negative');
  }
  const bytes = new Uint8Array(length);
  let temp = bigint;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error('Verifier key field element exceeds allocated size');
  }
  return bytes;
}
