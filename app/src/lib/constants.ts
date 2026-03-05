import process from 'process';
const metaEnv = ((import.meta as unknown as { env?: Record<string, string> })?.env ?? {}) as Record<string, string>;
const nodeEnv = (typeof process !== 'undefined' && process?.env ? process.env : {}) as Record<string, string>;

function readEnv(key: string, fallback = ''): string {
  return metaEnv[key]?.trim() || nodeEnv[key]?.trim() || fallback;
}

// Devnet NOC mint (FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg)
export const NOC_TOKEN_MINT = 'FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg';

// Wrapped SOL mint - used ONLY for Solana SPL Token operations (ATAs)
// NOT used in ZK circuits - those use simple constant 1n for SOL
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// ZK Circuit Token Identifiers
// These are used ONLY in the ZK circuit's tokenMint field to distinguish SOL from NOC notes.
// The actual transactions use native SOL (no wrapping needed).
// SOL uses a simple constant (1n) for its ZK tokenMint field.
// NOC uses the poseidon hash of its mint address.
export const SOL_ZK_TOKEN_ID = '1'; // Simple constant for SOL in ZK circuits
export const NOC_ZK_TOKEN_ID = NOC_TOKEN_MINT; // NOC mint address (will be hashed)

export const SHIELD_PROGRAM_ID = readEnv('VITE_SHIELD_PROGRAM', '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

// Helius API key for faster RPC
const HELIUS_API_KEY = readEnv('VITE_HELIUS_API_KEY', '');

// RPC URL - Now routes through prover service proxy to avoid CORS issues
const buildTimeProver = (globalThis as any).__PROVER_URL__ as string | undefined;
const proverUrl = buildTimeProver && buildTimeProver.startsWith('http')
  ? buildTimeProver
  : readEnv('VITE_PROVER_URL', 'http://localhost:8787');

// Frontend makes RPC calls through the prover service proxy (/rpc endpoint)
// This avoids CORS issues that occur when calling Helius directly from the browser
export const HeliusRpcUrl = `${proverUrl}/rpc`;

export const ProverServiceUrl = proverUrl;

export const INITIAL_AIRDROP_AMOUNT = 10_000;

// Relayer/Fee collector address - receives network fees and privacy fees
export const RELAYER_ADDRESS = '55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax';

// Relayer endpoints for failover (comma-separated; parsed from env or config)
export const RELAYER_ENDPOINTS = (() => {
  const env = readEnv('VITE_RELAYER_ENDPOINTS', '');
  // Fallback to localhost:8787 if not set
  const endpoints = env || 'http://localhost:8787';
  return endpoints.split(',').map(url => url.trim()).filter(Boolean);
})();

// Solana RPC endpoint - prefer Helius if API key is available
export const SOLANA_RPC = proverUrl + '/rpc';

// Health check interval and timeout
export const RELAYER_HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
export const RELAYER_HEALTH_CHECK_TIMEOUT_MS = 5_000; // 5 seconds

