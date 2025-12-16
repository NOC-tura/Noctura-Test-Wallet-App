#!/bin/bash

# Deploy Noctura Shield program to devnet

set -e

PROGRAM_KEYPAIR="/Users/banel/Noctura-Wallet/target/deploy/noctura_shield-keypair.json"
PROGRAM_BINARY="/Users/banel/Noctura-Wallet/target/deploy/noctura_shield.so"
PROGRAM_ID="3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz"

echo "==== Noctura Shield Program Deployment ===="
echo "Program ID: $PROGRAM_ID"
echo "Binary: $PROGRAM_BINARY"
echo "Keypair: $PROGRAM_KEYPAIR"
echo ""

# Check if files exist
if [ ! -f "$PROGRAM_BINARY" ]; then
  echo "ERROR: Program binary not found at $PROGRAM_BINARY"
  exit 1
fi

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  echo "ERROR: Program keypair not found at $PROGRAM_KEYPAIR"
  exit 1
fi

# Get wallet for paying fees
if [ -z "$SOLANA_KEY" ]; then
  WALLET_KEYPAIR=/Users/banel/config/solana/id.json
else
  WALLET_KEYPAIR="$SOLANA_KEY"
fi

if [ ! -f "$WALLET_KEYPAIR" ]; then
  echo "ERROR: Solana wallet not found at $WALLET_KEYPAIR"
  echo "Set SOLANA_KEY env var or configure default Solana wallet"
  exit 1
fi

echo "Using wallet: $WALLET_KEYPAIR"
echo ""

# Set to devnet
echo "Switching to devnet..."
solana config set --url https://api.devnet.solana.com

# Check current balance
echo ""
echo "Checking wallet balance..."
BALANCE=$(solana balance 2>/dev/null || echo "0")
echo "Current balance: $BALANCE SOL"
echo ""

# Deploy program
echo "Deploying program to devnet..."
echo "This may take a moment..."
echo ""

solana program deploy \
  "$PROGRAM_BINARY" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$WALLET_KEYPAIR" \
  --url https://api.devnet.solana.com

echo ""
echo "✅ Deployment complete!"
echo "Program deployed to: $PROGRAM_ID"
echo ""
echo "You can now use shielded deposits in the Noctura Wallet app."
