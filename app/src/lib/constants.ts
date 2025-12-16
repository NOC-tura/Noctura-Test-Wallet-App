import process from 'process';
const metaEnv = ((import.meta as unknown as { env?: Record<string, string> })?.env ?? {}) as Record<string, string>;
const nodeEnv = (typeof process !== 'undefined' && process?.env ? process.env : {}) as Record<string, string>;

function readEnv(key: string, fallback = ''): string {
  return metaEnv[key]?.trim() || nodeEnv[key]?.trim() || fallback;
}

// Devnet NOC mint (2aFVaSy29RZ5V7D6cPBf59sVwJB34nETF6piwjT7AYUb)
export const NOC_TOKEN_MINT = '2aFVaSy29RZ5V7D6cPBf59sVwJB34nETF6piwjT7AYUb';
// Native SOL mint address (used for shielding native SOL)
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
// Native SOL system program ID (for direct SOL deposits without wrapping)
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const SHIELD_PROGRAM_ID = readEnv('VITE_SHIELD_PROGRAM', '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
export const HeliusRpcUrl = (globalThis as any).__HELIUS_URL__ as string;
export const ProverServiceUrl = (globalThis as any).__PROVER_URL__ as string;
export const INITIAL_AIRDROP_AMOUNT = 10_000;

// Relayer endpoints for failover (comma-separated; parsed from env or config)
export const RELAYER_ENDPOINTS = (() => {
  const env = readEnv('VITE_RELAYER_ENDPOINTS', ProverServiceUrl);
  return env.split(',').map(url => url.trim()).filter(Boolean);
})();

// Health check interval and timeout
export const RELAYER_HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
export const RELAYER_HEALTH_CHECK_TIMEOUT_MS = 5_000; // 5 seconds

