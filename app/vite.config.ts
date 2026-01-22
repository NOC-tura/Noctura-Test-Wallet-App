import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname);
  const env = loadEnv(mode, envDir, '');
  // For development, use devnet directly (CORS is handled by browser for same-origin)
  // The Solana web3.js library handles CORS properly
  const explicitRpc = env.VITE_SOLANA_RPC_URL?.trim();
  const heliusKey = env.VITE_HELIUS_API_KEY?.trim();
  const heliusRpc = heliusKey
    ? `https://devnet.helius-rpc.com/?api-key=${heliusKey}`
    : undefined;
  const resolvedRpc = explicitRpc || heliusRpc || 'https://api.devnet.solana.com';
  console.log('Using Solana RPC:', resolvedRpc);
  return {
    plugins: [
      react(),
      nodePolyfills({
        include: ['buffer', 'process', 'util'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@zk-witness': path.resolve(__dirname, '../zk/witness'),
        circomlibjs: path.resolve(__dirname, 'node_modules/circomlibjs'),
        buffer: path.resolve(__dirname, 'node_modules/buffer/index.js'),
        'buffer/': path.resolve(__dirname, 'node_modules/buffer/'),
        'micro-ftch': path.resolve(__dirname, 'src/shims/micro-ftch.ts'),
        util: 'util',
        process: 'process/browser',
        'vite-plugin-node-polyfills/shims/buffer': path.resolve(
          __dirname,
          'node_modules/vite-plugin-node-polyfills/shims/buffer'
        ),
        'vite-plugin-node-polyfills/shims/global': path.resolve(
          __dirname,
          'node_modules/vite-plugin-node-polyfills/shims/global'
        ),
        'vite-plugin-node-polyfills/shims/process': path.resolve(
          __dirname,
          'node_modules/vite-plugin-node-polyfills/shims/process'
        ),
      },
    },
    server: {
      fs: {
        allow: ['..'],
      },
      proxy: {
        '/solana-rpc': {
          target: 'https://api.devnet.solana.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/solana-rpc/, ''),
        },
      },
    },
    optimizeDeps: {
      include: ['buffer', 'util', 'process', 'big-integer'],
    },
    build: {
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react/jsx-runtime'],
            solana: ['@solana/web3.js', '@solana/spl-token', 'bs58'],
            zk: ['@zk-witness/index', 'circomlibjs', '@scure/bip39', '@scure/bip39/wordlists/english'],
          },
        },
      },
    },
    define: {
      global: 'globalThis',
      'process.env': {},
      __HELIUS_URL__: JSON.stringify(resolvedRpc),
      __PROVER_URL__: JSON.stringify(env.VITE_PROVER_URL || 'http://localhost:8787'),
      'import.meta.env.VITE_RELAYER_ENDPOINTS': JSON.stringify(env.VITE_RELAYER_ENDPOINTS || env.VITE_PROVER_URL || 'http://localhost:8787'),
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
      css: true,
    },
  };
});
