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

# Copy package files first for better caching
COPY package*.json ./
RUN npm install --include=dev

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Download ZK artifacts (keys and wasm files)
RUN bash scripts/download-artifacts.sh

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
