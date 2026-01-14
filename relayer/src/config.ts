import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8787', 10),
  heliusRpcUrl: process.env.HELIUS_RPC_URL || '',
  feePayerSecretKey: process.env.FEE_PAYER_SECRET_KEY || '',
  shieldProgramId: process.env.SHIELD_PROGRAM_ID || '3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
  logLevel: process.env.LOG_LEVEL || 'info',
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
