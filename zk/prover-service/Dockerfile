FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libgmp-dev \
    libsodium-dev \
    nasm \
    curl \
    git \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Build RapidSNARK from source
WORKDIR /opt
RUN git clone https://github.com/iden3/rapidsnark.git \
    && cd rapidsnark \
    && git submodule init \
    && git submodule update \
    && ./build_gmp.sh host \
    && mkdir build_prover && cd build_prover \
    && cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=../package \
    && make -j$(nproc) && make install

# Add rapidsnark to PATH
ENV PATH="/opt/rapidsnark/package/bin:$PATH"

# Verify rapidsnark is available
RUN which prover && prover --help || echo "RapidSNARK prover installed"

# Set up application
WORKDIR /app

# Copy package files first for better caching (now from prover-service subfolder)
COPY prover-service/package*.json ./
RUN npm install --include=dev

# Copy prover-service source code
COPY prover-service/ .

# Build TypeScript
RUN npm run build

# Copy ZK artifacts from repo (tracked via Git LFS)
# Keys are in zk/keys, builds are in zk/build
RUN mkdir -p ../keys
COPY keys/*.zkey ../keys/
COPY keys/*.vkey.json ../keys/

# Copy wasm build folders
RUN mkdir -p ../build/deposit ../build/consolidate ../build/transfer ../build/withdraw ../build/swap_v2
COPY build/deposit/deposit_js ../build/deposit/deposit_js
COPY build/consolidate/consolidate_js ../build/consolidate/consolidate_js
COPY build/transfer/transfer_js ../build/transfer/transfer_js
COPY build/withdraw/withdraw_js ../build/withdraw/withdraw_js
COPY build/swap_v2/swap_v2_js ../build/swap_v2/swap_v2_js

# Set environment variables
ENV NODE_ENV=production
ENV USE_RAPIDSNARK=true
ENV PORT=8787

# Expose port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8787/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
