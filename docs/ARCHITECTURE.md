# Noctura Dual-Mode Wallet – Technical Blueprint

## High-Level Overview
- **Transparent Mode:** Standard Solana wallet features using Ed25519 keypairs. Full SPL compatibility and explorer-visible transfers via RPCs.
- **Shielded Mode:** Privacy layer backed by Groth16 zk-SNARKs. Commitment/nullifier model with on-chain Merkle root tracking and vault custody for SPL assets.
- **Mode Toggle:** Single UI switch updates signing + routing pipeline. Shielded actions batch-proof locally (WASM) before hitting Solana verifier program.

## Components
1. **ZK Circuits (`zk/circuits`)**
   - `deposit.circom`: Commits deposit note = Poseidon(sk, amount, token_mint, rho).
   - `transfer.circom`: Proves spend authority over commitments without revealing sender/amount.
   - `withdraw.circom`: Reveals receiver public key while proving nullifier uniqueness.
   - Compiled with `snarkjs` → `.wasm`, `.zkey`, and verifying keys uploaded on-chain.

2. **On-Chain Programs (`programs/noctura-shield`)**
   - Anchor-based BPF program that:
     - Stores Merkle tree + root history.
     - Tracks used nullifiers to prevent double spends.
     - Custodies SPL tokens in PDA vaults.
     - Verifies Groth16 proofs via embedded verifier (arkworks `no_std`).
   - Instructions: `initialize`, `set_verifier`, `transparent_deposit`, `shielded_transfer`, `transparent_withdraw`, `sync_root`.

3. **Off-Chain Prover (`zk/prover-service`)**
   - Node/TypeScript worker calling `snarkjs` in WASM or Node mode.
   - Handles witness generation, proof creation, and verification key serialization.

4. **Wallet App (`app/`)**
   - Vite + React + Tailwind for cyber B/W aesthetic.
   - Built-in key management:
     - Generate 12-word BIP39 seed or import private key / existing JSON.
     - Stores encrypted in IndexedDB with optional passphrase.
   - Transparent pipeline: uses `@solana/web3.js` for standard transfers.
   - Shielded pipeline: orchestrates prover, composes Solana transactions hitting verifier program, and monitors Merkle roots.
   - Incentive logic: one-time 10,000 $NOC faucet call post-onboarding.

5. **Tooling & Deployment**
   - `README.md` with Solana + Anchor setup, env vars, commands, and Netlify deployment steps.
   - Scripts for: key import, faucet funding using authority signer, proof key uploads, automated tests.

## Data Flow Summary
1. **Transparent → Shielded Deposit**
   1. Wallet signs SPL transfer → vault PDA.
   2. Client generates deposit note + Groth16 proof.
   3. Transaction calls `transparent_deposit` with commitment + proof.
   4. Program verifies proof, appends commitment to Merkle tree, emits new root.

2. **Shielded Transfer**
   1. User selects shielded notes to spend.
   2. Client computes witness (includes Merkle path + receiver public key + amount commitments).
   3. Proof submitted via `shielded_transfer`; on success new commitments recorded, nullifiers stored.

3. **Shielded → Transparent Withdraw**
   1. Client proves knowledge of note + receiver address.
   2. Program verifies proof and releases SPL tokens from vault to receiver.

## Fee Model (from litepaper)
- Transparent tx fee: ~0.0005 SOL (native Solana fee estimate).
- Shielded tx fee: 0.05–0.10 $NOC (program configurable, portion burned 0.25–1%).
- Priority lane: 0.15–0.25 $NOC with GPU prover queue.

## Upcoming Work Items
- Fill in circuits + verifying key assets.
- Implement full Anchor program logic and CPI-safe vault management.
- Build React flows + Netlify deploy automation.
