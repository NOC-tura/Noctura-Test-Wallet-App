# Security Policy

## Sensitive Data Protection

This repository does NOT contain any private keys, secrets, or sensitive credentials in the codebase.

### Protected Files (Never Committed)

The following are excluded via `.gitignore`:
- `.env` files (only `.env.example` templates are committed)
- Private keys (`*.pem`, `*.key`, `id.json`)
- Local configuration files
- Build artifacts containing sensitive data

### Environment Variables

All sensitive configuration is managed through environment variables:

- **VITE_HELIUS_API_KEY** - Your Helius RPC API key (get from https://helius.dev)
- **AUTHORITY_KEYPAIR** - Path to your Solana wallet keypair file
- **RPC_URL** - Solana RPC endpoint

**Never commit actual API keys or private keys.** Use `.env.example` templates with placeholders.

### Setup Instructions

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual credentials:
   ```bash
   VITE_HELIUS_API_KEY=<your_api_key>
   AUTHORITY_KEYPAIR=<path_to_your_keypair>
   ```

3. The `.gitignore` file ensures `.env` is never committed.

## Reporting Security Issues

If you discover a security vulnerability in this codebase, please report it to the repository maintainers directly rather than opening a public issue.

## Read-Only Repository Notice

When this repository is made public, it will be configured as **read-only** (archived). This means:
- No pull requests or issues will be accepted
- The code is provided as-is for reference only
- Users can fork for their own use

## Wallet Security Best Practices

1. **Never share your mnemonic or private key**
2. **Store keys securely** - Use hardware wallets for production
3. **Verify contract addresses** - Always verify program IDs before use
4. **Test on devnet first** - Never test with real funds on mainnet
5. **Review all transactions** - Check recipient addresses before confirming

## Smart Contract Security

The Anchor programs in this repository have NOT been formally audited. Use at your own risk. Key security considerations:

- ZK proof verification ensures privacy and correctness
- Merkle tree prevents double-spending via nullifier tracking
- Fee collection uses PDA-based vault system
- All shielded operations are zero-knowledge proofs

## License

This is a reference implementation. No warranty is provided.
