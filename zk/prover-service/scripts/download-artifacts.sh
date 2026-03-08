#!/bin/bash
# Download ZK artifacts for production deployment

set -e

ARTIFACTS_URL="https://github.com/NOC-tura/Noctura-Test-Wallet-App/releases/download/v0.2.0/zk-artifacts.zip"
DEST_DIR="$(dirname "$0")/.."

echo "📦 Downloading ZK artifacts..."
cd "$DEST_DIR"

# Download and extract
curl -L -o /tmp/zk-artifacts.zip "$ARTIFACTS_URL"
unzip -o /tmp/zk-artifacts.zip -d /tmp/

# Create directories
mkdir -p ../keys
mkdir -p ../build/deposit
mkdir -p ../build/consolidate
mkdir -p ../build/transfer
mkdir -p ../build/withdraw
mkdir -p ../build/transfer-multi
mkdir -p ../build/partial_withdraw
mkdir -p ../build/swap
mkdir -p ../build/swap_v2

# Copy keys
cp /tmp/zk-artifacts/*.zkey ../keys/
cp /tmp/zk-artifacts/*.vkey.json ../keys/

# Copy wasm folders
cp -r /tmp/zk-artifacts/deposit_js ../build/deposit/
cp -r /tmp/zk-artifacts/consolidate_js ../build/consolidate/
cp -r /tmp/zk-artifacts/transfer_js ../build/transfer/
cp -r /tmp/zk-artifacts/withdraw_js ../build/withdraw/
cp -r /tmp/zk-artifacts/transfer-multi_js ../build/transfer-multi/ 2>/dev/null || echo "transfer-multi_js not in artifacts yet"
cp -r /tmp/zk-artifacts/partial_withdraw_js ../build/partial_withdraw/ 2>/dev/null || echo "partial_withdraw_js not in artifacts yet"
cp -r /tmp/zk-artifacts/swap_js ../build/swap/ 2>/dev/null || echo "swap_js not in artifacts yet"
cp -r /tmp/zk-artifacts/swap_v2_js ../build/swap_v2/

# Copy IDL for relayer
mkdir -p ../../target/idl
cp /tmp/zk-artifacts/noctura_shield.json ../../target/idl/

# Cleanup
rm -rf /tmp/zk-artifacts /tmp/zk-artifacts.zip

echo "✅ ZK artifacts downloaded successfully!"
ls -la ../keys/
ls -la ../build/
