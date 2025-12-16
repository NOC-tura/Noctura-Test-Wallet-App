import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';
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

const keypairPath = process.env.AUTHORITY_KEYPAIR || DEFAULT_KEYPAIR;
const keypairBytes = JSON.parse(readFileSync(keypairPath, 'utf-8'));
export const AUTHORITY = Keypair.fromSecretKey(new Uint8Array(keypairBytes));

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
