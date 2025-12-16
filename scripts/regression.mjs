import fs from 'fs';
import path from 'path';
import { Connection, Keypair } from '@solana/web3.js';

const PRIMARY_RPC =
  process.env.RPC_URL ||
  process.env.HELIUS_URL ||
  process.env.HELIUS_RPC_URL ||
  process.env.VITE_HELIUS_URL ||
  'https://api.devnet.solana.com';
const SECONDARY_RPC = process.env.SECONDARY_RPC;
const PROVER_URL = process.env.PROVER_URL || process.env.VITE_PROVER_URL || process.env.NOC_PROVER_URL;

const connection = new Connection(PRIMARY_RPC, 'confirmed');

function loadKeypair() {
  const keypairPath = process.env.KEYPAIR_PATH || path.join(process.env.HOME || '.', '.config', 'solana', 'id.json');
  if (!fs.existsSync(keypairPath)) {
    console.warn(`[warn] Keypair file not found at ${keypairPath}. Set KEYPAIR_PATH to override. Continuing without wallet.`);
    return null;
  }
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function checkRpcHealth(conn, label) {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  console.log(`[health] ${label} RPC ok. Recent blockhash: ${blockhash}`);
}

async function checkProverHealth() {
  if (!PROVER_URL) {
    console.warn('[warn] PROVER_URL not set; skipping prover health check');
    return;
  }
  const url = `${PROVER_URL}/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    const body = await res.text();
    console.log(`[health] Prover reachable at ${url}: ${body || 'ok'}`);
  } catch (err) {
    console.warn(`[warn] Prover health check failed at ${url}: ${err.message}`);
  }
}

async function main() {
  console.log('== Noctura Regression Smoke ==');
  const keypair = loadKeypair();
  if (keypair) {
    console.log(`[wallet] Loaded keypair: ${keypair.publicKey.toBase58()}`);
  } else {
    console.log('[wallet] No keypair loaded; wallet checks skipped.');
  }

  await checkRpcHealth(connection, 'primary');
  if (SECONDARY_RPC) {
    await checkRpcHealth(new Connection(SECONDARY_RPC, 'confirmed'), 'secondary');
  }

  await checkProverHealth();

  console.log('[next steps] This is a smoke test. For full e2e (deposit -> transfer -> withdraw), run UI or extend this script to call prepareDeposit/proveCircuit/submitShieldedWithdraw with live proofs.');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
