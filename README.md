# Noctura Dual-Mode Wallet (Testnet)

This repo contains everything required to exercise a dual-mode Solana wallet that can flip between transparent SPL transfers and privacy-preserving shielded actions powered by Groth16 zk-SNARKs.

## Layout

- `programs/noctura-shield/` – Anchor smart contract keeping Merkle roots, nullifiers, and verifying Groth16 proofs on Solana testnet.
- `zk/circuits/` – Circom circuits + scripts for compiling, setup, and generating proofs.
- `zk/witness/` – Shared Poseidon note helpers, Merkle proofs, and witness/public-input serializers for deposit/transfer/withdraw.
- `zk/prover-service/` – Minimal Express + snarkjs worker that the wallet calls for witness/proof generation and one-time $NOC airdrops.
- `app/` – Netlify-ready React wallet with built-in key management, transparent/shielded toggle, faucet hooks, and proof sandbox UI.
- `docs/ARCHITECTURE.md` – System blueprint distilled from the LitePaper.

## Prerequisites

- Rust + Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor anchor-cli`).
- Solana CLI (latest stable) with your testnet keypair saved at `/Users/banel/config/solana/id.json`.
- Node.js 20+ and `circom` binary (v2.1.9) available in `PATH`.
- Download Powers of Tau (`powersOfTau28_hez_final_15.ptau`) into `zk/keys/`.

## Building the zk Stack

```bash
cd /Users/banel/Noctura-Wallet/zk
npm install
npx tsx scripts/build.ts
npx tsx scripts/setup.ts   # requires ptau file
npm run witness:demo       # sanity check for witness builders
npx tsx scripts/prove.ts deposit inputs/deposit.json
```

`zk/keys/*.vkey.json` outputs are uploaded on-chain via the `set_verifier` instruction. Serialize the verification key into the Borsh layout defined in `programs/noctura-shield/src/verifier.rs::PackedVerifierKey`:

- `alpha_g1`: 64 bytes (x || y) big-endian
- `beta_g2`, `gamma_g2`, `delta_g2`: 128 bytes each (x_im || x_re || y_im || y_re), big-endian
- `ic`: `Vec<[u8; 64]>` containing `gamma_abc` points (first entry is the constant term)

Proof bytes supplied to on-chain instructions must be the raw concatenation of `(pi_a || pi_b || pi_c)` using the same big-endian coordinate encoding (64/128/64 bytes). Proof samples land in `zk/keys/deposit-proof.json` for quick inspection.

## Running the Prover + Faucet Service

```bash
cd /Users/banel/Noctura-Wallet/zk/prover-service
npm install
cp .env.example .env   # update RPC, Helius API key, etc.
npx tsx src/index.ts
```

Endpoints:
- `POST /prove/:circuit` – wraps `snarkjs.groth16.fullProve` for `deposit|transfer|withdraw`.
- `POST /airdrop` – sends a one-time 10,000 $NOC transfer using the provided authority key.

## Deploying the Anchor Program

```bash
cd /Users/banel/Noctura-Wallet
anchor build
anchor deploy --provider.cluster https://api.testnet.solana.com
```

Set the resulting program ID inside `Anchor.toml`, `app/.env`, and re-run the wallet.

### Initialize Shield PDAs (required once per cluster)

After deploying, create the global state, Merkle tree, nullifier set, and verifier accounts referenced by the wallet:

```bash
cd /Users/banel/Noctura-Wallet/app
ANCHOR_PROVIDER_URL=https://api.testnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
FEE_COLLECTOR=<fee_collector_pubkey> \
VERIFYING_KEY_PATH=../zk/keys/deposit.vkey.json \
npm run bootstrap:shield
```

Use the same admin keypair that deployed the program. Set `FEE_COLLECTOR` to the owner of the SPL token account that will collect the 1 $NOC privacy fee. The frontend now derives the fee collector’s token ATA directly from on-chain state, so no extra Vite env variable is required. Provide `VERIFYING_KEY_PATH` (defaults to `../zk/keys/deposit.vkey.json`) so the script automatically uploads the Groth16 verifying key via `set_verifier`. If you skip this step, deposits will fail with `VerifierMissing`. After regenerating circuits/keys, set `FORCE_SET_VERIFIER=true` when running the script to overwrite the on-chain verifier bytes with the latest `*.vkey.json`.

## Wallet Frontend (Vite + React)

```bash
cd /Users/banel/Noctura-Wallet/app
npm run dev   # local dev server
npm run build # production bundle for Netlify
```

Environment variables (`.env`):
```
VITE_HELIUS_API_KEY=your_helius_api_key_here
VITE_PROVER_URL=http://localhost:8787
VITE_AIRDROP_AUTHORITY=55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax
VITE_SHIELD_PROGRAM=3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz
```

Key UX flows:
- First-launch onboarding offers seed creation, mnemonic import, or raw Ed25519 secret entry.
- Wallet auto-requests the one-time 10,000 $NOC grant via the prover service.
- Transparent mode uses native SOL transfers. Shielded mode routes through the proof sandbox (ready to be wired into the on-chain verifier once proofs are finalized).
- Cyber B/W palette powered by Tailwind for fast Netlify deployment.

## Public Devnet Testing Scope

- What works: deposit → shielded transfer → withdraw on devnet; witness builders and transaction builders are production-ready.
- Known gaps: commitment explorer UI, Merkle root sync display, and view-key manager are not yet shipped; prover lacks queue/GPU/cache so high load may slow proofs.
- Tester guidance: expect occasional prover latency; report tx signatures for failing flows; proofs generated off-chain via prover service.
- Environment: use testnet/devnet keys only; keep `.env` local; copy from `.env.example` and never commit secrets.

## Next Steps

1. Finish Circom witness builders and align `public_inputs` with Anchor verifier expectations.
2. Add transaction builders (IDL or @coral-xyz/anchor client) for `transparent_deposit`, `shielded_transfer`, and `transparent_withdraw` instructions.
3. Expand the React UI with commitment explorers, Merkle root sync, and selective disclosure view keys.
4. Harden prover infra (GPU queues, queueing, proofs caching) before mainnet.
