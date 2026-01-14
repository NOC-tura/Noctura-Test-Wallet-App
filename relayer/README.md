# Noctura Relayer Service

A Node.js/TypeScript relayer service for processing shielded transactions on Solana devnet using Helius RPC with ZK Compression support.

## Features

- **Shielded Operations**: Deposit, withdraw, transfer, and consolidate
- **ZK Compression**: Integrates with Helius `getValidityProof` API
- **Transaction Relay**: Signs and submits transactions with a fee-payer wallet
- **Health Monitoring**: Built-in health check endpoint
- **CORS Support**: Configurable origins for web app integration

## Prerequisites

- Node.js 18+ and npm
- Helius API key (get from https://dashboard.helius.dev)
- Solana CLI (to generate fee-payer keypair)
- SOL on devnet for fee-payer wallet

## Setup

### 1. Install Dependencies

```bash
cd relayer
npm install
```

### 2. Generate Fee-Payer Keypair

```bash
# Generate a new keypair
solana-keygen new --no-bip39-passphrase --outfile relayer-keypair.json

# Get the public key
solana-keygen pubkey relayer-keypair.json

# Airdrop SOL on devnet
solana airdrop 2 <PUBKEY> --url devnet
```

### 3. Encode Secret Key to Base58

```bash
# Extract and encode the secret key
node -e "const fs = require('fs'); const bs58 = require('bs58'); const kp = JSON.parse(fs.readFileSync('relayer-keypair.json')); console.log(bs58.encode(Buffer.from(kp.slice(0, 32))));"
```

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
PORT=8787
HELIUS_RPC_URL=https://devnet.helius-rpc.com?api-key=YOUR_HELIUS_API_KEY
FEE_PAYER_SECRET_KEY=YOUR_BASE58_SECRET_KEY_HERE
SHIELD_PROGRAM_ID=3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173
LOG_LEVEL=info
```

### 5. Run the Relayer

**Development (with hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## API Endpoints

### Health Check
```bash
GET /relay/health
```

Returns relayer status, fee-payer balance, and configuration.

### Deposit
```bash
POST /relay/deposit
Content-Type: application/json

{
  "proof": { ... },
  "publicInputs": { ... },
  "userPubkey": "...",
  "tokenMint": "...",
  "amount": 1000000
}
```

### Withdraw
```bash
POST /relay/withdraw
Content-Type: application/json

{
  "proof": { ... },
  "publicInputs": { ... },
  "recipientPubkey": "...",
  "tokenMint": "...",
  "amount": 1000000
}
```

### Transfer
```bash
POST /relay/transfer
Content-Type: application/json

{
  "proof": { ... },
  "publicInputs": { ... },
  "tokenMint": "..."
}
```

### Consolidate
```bash
POST /relay/consolidate
Content-Type: application/json

{
  "proof": { ... },
  "publicInputs": { ... },
  "tokenMint": "..."
}
```

## Testing

```bash
# Check relayer health
curl http://localhost:8787/relay/health

# Expected response:
# {
#   "status": "healthy",
#   "feePayerBalance": 2.0,
#   "feePayerPubkey": "...",
#   "shieldProgramId": "3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz"
# }
```

## Wallet Integration

Update your wallet's `.env.local`:

```env
VITE_RELAYER_ENDPOINTS=http://localhost:8787
VITE_PROVER_URL=https://devnet.helius-rpc.com?api-key=YOUR_HELIUS_API_KEY
VITE_HELIUS_API_KEY=YOUR_HELIUS_API_KEY
```

For production, use HTTPS:
```env
VITE_RELAYER_ENDPOINTS=https://relayer.yourdomain.com
```

## Deployment

### Option 1: Docker (Recommended)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 8787
CMD ["npm", "start"]
```

### Option 2: Direct VPS

1. Clone repo on server
2. Set up `.env` with production values
3. Run with PM2 or systemd:

```bash
npm install -g pm2
pm2 start dist/index.js --name noctura-relayer
pm2 save
pm2 startup
```

### Option 3: Cloud Platform

Deploy to Heroku, Railway, Render, or similar:
- Set environment variables in dashboard
- Use `npm start` as the start command
- Expose PORT from environment

## Security Notes

⚠️ **IMPORTANT**:
- Never commit `.env` or `relayer-keypair.json`
- Keep fee-payer wallet funded but not overly (5-10 SOL max)
- Use HTTPS in production
- Restrict CORS origins to your app domain
- Monitor fee-payer balance and transactions
- Rotate keys regularly

## Troubleshooting

**"Missing required environment variables"**
- Ensure `.env` exists and has all required fields from `.env.example`

**"getValidityProof error"**
- Check HELIUS_RPC_URL includes your API key
- Verify Helius account supports ZK Compression API

**"Transaction failed"**
- Check fee-payer has sufficient SOL balance
- Verify SHIELD_PROGRAM_ID matches deployed program
- Review Solana explorer for detailed error

**CORS errors**
- Add your frontend URL to ALLOWED_ORIGINS in `.env`

## Architecture

```
┌─────────────┐
│   Wallet    │  (React app)
│  (Browser)  │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────┐
│   Relayer   │  (This service)
│   Express   │
└──────┬──────┘
       │
       ├──► Helius RPC (getValidityProof)
       │
       └──► Solana Devnet (submit tx)
```

## Next Steps

- [ ] Add request rate limiting
- [ ] Implement transaction queuing
- [ ] Add Prometheus metrics
- [ ] Set up error alerting
- [ ] Add replay attack protection
- [ ] Implement fee estimation

## Support

For issues or questions:
1. Check logs: `npm run dev` (verbose output)
2. Test health endpoint: `curl http://localhost:8787/relay/health`
3. Review Helius docs: https://docs.helius.dev

## License

MIT
