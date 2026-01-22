import { config as loadEnv } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Keypair } from '@solana/web3.js';

loadEnv();

const DEFAULT_KEYPAIR = '/Users/banel/config/solana/id.json';

export const RPC_URL = process.env.RPC_URL || 'https://api.testnet.solana.com';
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
export const CIRCUIT_BUILD_DIR = process.env.CIRCUIT_BUILD_DIR || resolve(process.cwd(), '..', 'build');
export const KEYS_DIR = process.env.ZKEY_DIR || resolve(process.cwd(), '..', 'keys');
export const NOC_MINT = process.env.NOC_MINT || 'EvPfUBA97CWnKP6apRqmJYSzudonTCZCzH5tQZ7fk649';
export const NOC_DECIMALS = Number(process.env.NOC_DECIMALS || '6');
const AIRDROP_TOKENS = BigInt(process.env.AIRDROP_AMOUNT || '10000');
export const AIRDROP_LAMPORTS = AIRDROP_TOKENS * 10n ** BigInt(NOC_DECIMALS);

// Privacy fee: 0.25 NOC for relayed shielded transactions
export const PRIVACY_FEE_ATOMS = 250_000n; // 0.25 NOC (6 decimals)

// Load keypair from env var (base64 JSON array) or file path
function loadKeypair(): Keypair {
  // Option 1: Render Secret File (recommended for production)
  const renderSecretPath = '/etc/secrets/solana-keypair.json';
  if (existsSync(renderSecretPath)) {
    console.log('[Config] Loading keypair from Render secret file');
    const keypairBytes = JSON.parse(readFileSync(renderSecretPath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(keypairBytes));
  }
  
  // Option 2: Base64 encoded keypair in env var
  if (process.env.AUTHORITY_KEYPAIR_BASE64) {
    const decoded = Buffer.from(process.env.AUTHORITY_KEYPAIR_BASE64, 'base64').toString('utf-8');
    const keypairBytes = JSON.parse(decoded);
    return Keypair.fromSecretKey(new Uint8Array(keypairBytes));
  }
  
  // Option 3: JSON array directly in env var
  if (process.env.AUTHORITY_KEYPAIR_JSON) {
    const keypairBytes = JSON.parse(process.env.AUTHORITY_KEYPAIR_JSON);
    return Keypair.fromSecretKey(new Uint8Array(keypairBytes));
  }
  
  // Option 4: File path (for local development)
  const keypairPath = process.env.AUTHORITY_KEYPAIR || DEFAULT_KEYPAIR;
  if (existsSync(keypairPath)) {
    const keypairBytes = JSON.parse(readFileSync(keypairPath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(keypairBytes));
  }
  
  // Option 5: Generate a new keypair (for testing/demo only)
  console.warn('[Config] WARNING: No keypair found, generating ephemeral keypair. Fund this address for relayer to work.');
  const newKeypair = Keypair.generate();
  console.log(`[Config] Generated relayer address: ${newKeypair.publicKey.toBase58()}`);
  return newKeypair;
}

export const AUTHORITY = loadKeypair();

// Fee collector address - receives all privacy fees
// Default to AUTHORITY if not specified
export const FEE_COLLECTOR = process.env.FEE_COLLECTOR || AUTHORITY.publicKey.toBase58();

export const PORT = Number(process.env.PORT || 8787);

function inferCluster(url: string) {
  if (url.includes('devnet')) return 'devnet';
  if (url.includes('testnet')) return 'testnet';
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'devnet';
  return 'mainnet-beta';
}

const clusterParam = inferCluster(RPC_URL);

// Helius supports devnet and mainnet (not testnet)
// For testnet, we use public RPC or a custom RPC_URL
let computedRpcEndpoint = RPC_URL;
if (HELIUS_API_KEY) {
  if (clusterParam === 'mainnet-beta') {
    computedRpcEndpoint = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  } else if (clusterParam === 'devnet') {
    computedRpcEndpoint = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  }
  // Helius doesn't support testnet, so we fall back to RPC_URL for testnet
}

export const RPC_ENDPOINT = computedRpcEndpoint;
console.log(`[Config] Using RPC: ${RPC_ENDPOINT.includes('api-key') ? RPC_ENDPOINT.split('?')[0] + '?api-key=***' : RPC_ENDPOINT}`);
