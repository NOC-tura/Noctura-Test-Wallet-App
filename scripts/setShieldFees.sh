#!/bin/bash

# Set shield fees to 0 (no on-chain fees)
# This script requires:
# 1. Your Solana keypair at ~/.config/solana/id.json
# 2. The shield program to be initialized
# 3. You to be the program admin

echo "🔧 Setting shield fees to 0 (no on-chain fees)..."
echo ""
echo "This will disable the on-chain percentage-based fees,"
echo "leaving only the fixed 0.25 NOC privacy fee for shielded transactions."
echo ""

# Get the admin keypair
KEYPAIR_PATH="${HOME}/.config/solana/id.json"

if [ ! -f "$KEYPAIR_PATH" ]; then
  echo "❌ Keypair not found at: $KEYPAIR_PATH"
  echo "Please ensure your Solana keypair is configured."
  exit 1
fi

# Use Anchor CLI to call the setFee instruction
# First, let's check what admin is set in the program
echo "ℹ️  To set fees, run this in the Noctura workspace:"
echo ""
echo "  anchor call setFee -- 0 0"
echo ""
echo "Or use the App.tsx performSetShieldFees function with your admin keypair."
