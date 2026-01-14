import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config.js';
import relayRoutes from './routes/relay.js';

// Validate environment variables
try {
  validateConfig();
} catch (error: any) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

const app = express();

// Middleware
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/relay', relayRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    service: 'Noctura Relayer',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/relay/health',
      deposit: 'POST /relay/deposit',
      withdraw: 'POST /relay/withdraw',
      transfer: 'POST /relay/transfer',
      consolidate: 'POST /relay/consolidate',
    },
  });
});

// Error handling
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
const server = app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║        Noctura Relayer Service v1.0.0        ║
╠═══════════════════════════════════════════════╣
║  Port:           ${config.port}                      ║
║  Network:        Solana Devnet               ║
║  RPC:            Helius (ZK Compression)     ║
║  Shield Program: ${config.shieldProgramId.slice(0, 8)}...     ║
╚═══════════════════════════════════════════════╝
  `);
  console.log(`Relayer listening on http://localhost:${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/relay/health\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
