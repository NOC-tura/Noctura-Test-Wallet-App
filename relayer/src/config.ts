import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8787', 10),
  heliusRpcUrl: process.env.HELIUS_RPC_URL || '',
  feePayerSecretKey: process.env.FEE_PAYER_SECRET_KEY || '',
  shieldProgramId: process.env.SHIELD_PROGRAM_ID || '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
  logLevel: process.env.LOG_LEVEL || 'info',
  // Swap config
  nocPriceUsd: parseFloat(process.env.NOC_PRICE_USD || '0.30'), // Fixed NOC price in USD (not on exchanges yet)
  swapFeeBps: parseInt(process.env.SWAP_FEE_BPS || '12', 10),   // Swap fee in basis points (12 = 0.12%)
};

export function validateConfig(): void {
  const required = [
    { key: 'heliusRpcUrl', value: config.heliusRpcUrl },
    { key: 'feePayerSecretKey', value: config.feePayerSecretKey },
  ];

  const missing = required.filter(r => !r.value);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map(m => m.key).join(', ')}\n` +
      'Copy .env.example to .env and fill in the values.'
    );
  }

  if (!config.heliusRpcUrl.includes('helius-rpc.com')) {
    console.warn('Warning: HELIUS_RPC_URL should be a Helius endpoint with ZK Compression support');
  }
}
