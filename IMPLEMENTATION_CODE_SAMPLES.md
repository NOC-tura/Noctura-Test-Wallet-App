# Implementation Guide: Next Steps Items 3 & 4

## Item 3: React UI Expansion

### Component 1: CommitmentExplorer.tsx

Purpose: Allow users to browse all commitments in the Merkle tree and verify inclusion proofs.

```typescript
// app/src/components/CommitmentExplorer.tsx

import React, { useState, useEffect } from 'react';
import '../styles/commitment-explorer.css';

interface Commitment {
  index: number;
  value: string;
  timestamp: number;
  leafHash: string;
  proofPath?: string[];
}

export function CommitmentExplorer({ walletAddress }: { walletAddress: string }) {
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'pending' | 'verified' | 'failed'>('pending');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCommitments();
  }, [walletAddress]);

  const fetchCommitments = async () => {
    setLoading(true);
    try {
      // Fetch from on-chain merkle tree PDA
      const response = await fetch(`/api/commitments?wallet=${walletAddress}`);
      const data = await response.json();
      setCommitments(data.commitments);
    } catch (err) {
      console.error('Failed to fetch commitments:', err);
    } finally {
      setLoading(false);
    }
  };

  const verifyInclusion = async (index: number) => {
    setSelectedIndex(index);
    setVerificationStatus('pending');
    
    try {
      // Call local proof verification
      const commitment = commitments[index];
      const proofPath = await buildMerkleProof(index);
      
      // Verify locally using the witness builder
      const isValid = await verifyMerkleProof(
        commitment.value,
        proofPath,
        // merkle root from on-chain
      );
      
      setVerificationStatus(isValid ? 'verified' : 'failed');
    } catch (err) {
      console.error('Verification failed:', err);
      setVerificationStatus('failed');
    }
  };

  return (
    <div className="commitment-explorer">
      <h2>Merkle Tree Commitments</h2>
      
      <div className="controls">
        <button onClick={fetchCommitments} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="commitments-list">
        {commitments.map((c) => (
          <div 
            key={c.index} 
            className={`commitment-row ${selectedIndex === c.index ? 'selected' : ''}`}
            onClick={() => verifyInclusion(c.index)}
          >
            <span className="index">#{c.index}</span>
            <span className="value">{c.value.slice(0, 16)}...</span>
            <span className="timestamp">{new Date(c.timestamp * 1000).toLocaleDateString()}</span>
            {selectedIndex === c.index && (
              <span className={`status ${verificationStatus}`}>
                {verificationStatus === 'verified' ? '✓ Verified' : 'Verifying...'}
              </span>
            )}
          </div>
        ))}
      </div>

      {selectedIndex !== null && (
        <div className="proof-details">
          <h3>Merkle Proof for Commitment #{selectedIndex}</h3>
          <pre>{JSON.stringify(commitments[selectedIndex], null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

### Component 2: MerkleRootSync.tsx

Purpose: Monitor and sync the Merkle root between on-chain state and local witness cache.

```typescript
// app/src/components/MerkleRootSync.tsx

import React, { useState, useEffect } from 'react';
import '../styles/merkle-root-sync.css';

interface SyncStatus {
  onChainRoot: string;
  localCacheRoot: string;
  isSynced: boolean;
  lastSyncTime: number;
  pendingUpdates: number;
}

export function MerkleRootSync() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(true);

  useEffect(() => {
    checkSyncStatus();
    
    if (autoSync) {
      const interval = setInterval(checkSyncStatus, 10000); // Every 10 seconds
      return () => clearInterval(interval);
    }
  }, [autoSync]);

  const checkSyncStatus = async () => {
    try {
      // Fetch on-chain Merkle root from global state PDA
      const onChainRoot = await fetchOnChainMerkleRoot();
      
      // Get local cache root from witness builder
      const localRoot = await getLocalMerkleRoot();
      
      // Fetch pending updates count
      const pendingCount = await getPendingCommitments();
      
      setStatus({
        onChainRoot,
        localCacheRoot: localRoot,
        isSynced: onChainRoot === localRoot,
        lastSyncTime: Date.now(),
        pendingUpdates: pendingCount,
      });
    } catch (err) {
      console.error('Sync status check failed:', err);
    }
  };

  const forceSync = async () => {
    setSyncing(true);
    try {
      // Force refresh of local cache from on-chain
      await refreshLocalMerkleCache();
      await checkSyncStatus();
    } catch (err) {
      console.error('Force sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  if (!status) return <div>Loading...</div>;

  return (
    <div className="merkle-root-sync">
      <h2>Merkle Root Synchronization</h2>
      
      <div className={`sync-status ${status.isSynced ? 'synced' : 'out-of-sync'}`}>
        <div className="status-indicator">
          {status.isSynced ? '✓ Synced' : '⚠ Out of Sync'}
        </div>
        
        <div className="root-display">
          <label>On-Chain Root:</label>
          <code>{status.onChainRoot}</code>
        </div>
        
        <div className="root-display">
          <label>Local Cache Root:</label>
          <code>{status.localCacheRoot}</code>
        </div>
        
        <div className="meta-info">
          <p>Last Sync: {new Date(status.lastSyncTime).toLocaleTimeString()}</p>
          <p>Pending Updates: {status.pendingUpdates}</p>
        </div>
      </div>

      <div className="controls">
        <button 
          onClick={forceSync} 
          disabled={syncing}
          className="force-sync-btn"
        >
          {syncing ? 'Syncing...' : 'Force Sync Now'}
        </button>
        
        <label className="auto-sync-toggle">
          <input 
            type="checkbox" 
            checked={autoSync} 
            onChange={(e) => setAutoSync(e.target.checked)}
          />
          Auto-sync every 10s
        </label>
      </div>
    </div>
  );
}
```

### Component 3: ViewKeyManager.tsx

Purpose: Generate and manage selective disclosure view keys for privacy-enhanced monitoring.

```typescript
// app/src/components/ViewKeyManager.tsx

import React, { useState, useEffect } from 'react';
import { Keypair } from '@solana/web3.js';
import '../styles/view-key-manager.css';

interface ViewKey {
  id: string;
  publicKey: string;
  createdAt: number;
  lastUsed: number | null;
  isActive: boolean;
  permissions: string[];
}

export function ViewKeyManager({ walletKeypair }: { walletKeypair: Keypair }) {
  const [viewKeys, setViewKeys] = useState<ViewKey[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(['view_balance', 'view_history']);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    loadViewKeys();
  }, [walletKeypair]);

  const loadViewKeys = async () => {
    try {
      const keys = await retrieveViewKeys(walletKeypair.publicKey);
      setViewKeys(keys);
    } catch (err) {
      console.error('Failed to load view keys:', err);
    }
  };

  const generateNewViewKey = async () => {
    try {
      // Generate a new view key (separate keypair for viewing only)
      const viewKeyKeypair = Keypair.generate();
      
      // Encrypt the derivation path so only the main keypair can delegate
      const encryptedDerivation = encryptViewKeyPath(
        walletKeypair,
        viewKeyKeypair,
        selectedPermissions
      );

      const newKey: ViewKey = {
        id: viewKeyKeypair.publicKey.toBase58(),
        publicKey: viewKeyKeypair.publicKey.toBase58(),
        createdAt: Date.now(),
        lastUsed: null,
        isActive: true,
        permissions: selectedPermissions,
      };

      // Store encrypted key locally
      await saveViewKey(newKey, encryptedDerivation);
      
      setViewKeys([...viewKeys, newKey]);
      setShowGenerateModal(false);
    } catch (err) {
      console.error('Failed to generate view key:', err);
    }
  };

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const revokeViewKey = async (keyId: string) => {
    try {
      await deleteViewKey(keyId);
      setViewKeys(viewKeys.filter(k => k.id !== keyId));
    } catch (err) {
      console.error('Failed to revoke view key:', err);
    }
  };

  return (
    <div className="view-key-manager">
      <h2>View Keys (Selective Disclosure)</h2>
      
      <p className="description">
        Create view-only keys to share balance & transaction history without compromising spending keys.
      </p>

      <button 
        onClick={() => setShowGenerateModal(true)}
        className="generate-key-btn"
      >
        + Generate New View Key
      </button>

      <div className="view-keys-list">
        {viewKeys.length === 0 ? (
          <p className="empty-state">No view keys created yet.</p>
        ) : (
          viewKeys.map((key) => (
            <div key={key.id} className="view-key-card">
              <div className="key-info">
                <h3>View Key {key.id.slice(-8)}</h3>
                <code className="key-value">
                  {key.publicKey}
                  <button 
                    onClick={() => copyToClipboard(key.publicKey)}
                    className="copy-btn"
                  >
                    {copiedKey === key.publicKey ? '✓ Copied' : 'Copy'}
                  </button>
                </code>
              </div>
              
              <div className="key-meta">
                <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                <span>Status: {key.isActive ? '🟢 Active' : '🔴 Revoked'}</span>
              </div>
              
              <div className="permissions">
                <span>Permissions:</span>
                {key.permissions.map(p => (
                  <span key={p} className="permission-tag">{p}</span>
                ))}
              </div>
              
              <button 
                onClick={() => revokeViewKey(key.id)}
                className="revoke-btn"
                disabled={!key.isActive}
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>

      {showGenerateModal && (
        <div className="modal-overlay" onClick={() => setShowGenerateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Generate New View Key</h3>
            
            <div className="permissions-list">
              <label>
                <input 
                  type="checkbox"
                  checked={selectedPermissions.includes('view_balance')}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedPermissions([...selectedPermissions, 'view_balance']);
                    } else {
                      setSelectedPermissions(selectedPermissions.filter(p => p !== 'view_balance'));
                    }
                  }}
                />
                View Balance
              </label>
              
              <label>
                <input 
                  type="checkbox"
                  checked={selectedPermissions.includes('view_history')}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedPermissions([...selectedPermissions, 'view_history']);
                    } else {
                      setSelectedPermissions(selectedPermissions.filter(p => p !== 'view_history'));
                    }
                  }}
                />
                View Transaction History
              </label>
              
              <label>
                <input 
                  type="checkbox"
                  checked={selectedPermissions.includes('view_commitments')}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedPermissions([...selectedPermissions, 'view_commitments']);
                    } else {
                      setSelectedPermissions(selectedPermissions.filter(p => p !== 'view_commitments'));
                    }
                  }}
                />
                View Commitment Tree
              </label>
            </div>
            
            <div className="modal-buttons">
              <button onClick={generateNewViewKey} className="primary">Generate</button>
              <button onClick={() => setShowGenerateModal(false)} className="secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Supporting Library: viewKeys.ts

```typescript
// app/src/lib/viewKeys.ts

import { Keypair, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';

export interface ViewKeyData {
  mainPublicKey: PublicKey;
  viewPublicKey: PublicKey;
  permissions: string[];
  createdAt: number;
  expiresAt?: number;
}

export async function generateViewKey(
  mainKeypair: Keypair,
  permissions: string[] = ['view_balance', 'view_history']
): Promise<{ viewKey: Keypair; encrypted: string }> {
  // Generate a new keypair for viewing
  const viewKeyKeypair = Keypair.generate();

  // Create the view key data
  const viewKeyData: ViewKeyData = {
    mainPublicKey: mainKeypair.publicKey,
    viewPublicKey: viewKeyKeypair.publicKey,
    permissions,
    createdAt: Date.now(),
  };

  // Encrypt using main keypair (so only owner can decode)
  const encrypted = encryptViewKeyData(mainKeypair, viewKeyData);

  return { viewKey: viewKeyKeypair, encrypted };
}

export function encryptViewKeyData(keypair: Keypair, data: ViewKeyData): string {
  const json = JSON.stringify(data);
  const buffer = Buffer.from(json, 'utf-8');

  // Simple XOR encryption with keypair as key (use proper encryption in production)
  const keyBuffer = Buffer.from(keypair.secretKey);
  const encrypted = Buffer.alloc(buffer.length);

  for (let i = 0; i < buffer.length; i++) {
    encrypted[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  }

  return encrypted.toString('base64');
}

export function decryptViewKeyData(keypair: Keypair, encrypted: string): ViewKeyData {
  const buffer = Buffer.from(encrypted, 'base64');
  const keyBuffer = Buffer.from(keypair.secretKey);

  const decrypted = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    decrypted[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  }

  const json = decrypted.toString('utf-8');
  return JSON.parse(json);
}

export function hasPermission(viewKeyData: ViewKeyData, permission: string): boolean {
  return viewKeyData.permissions.includes(permission);
}

export async function storeViewKey(keyData: ViewKeyData, encrypted: string): Promise<void> {
  // Store in localStorage (or secure storage in production)
  const stored = JSON.parse(localStorage.getItem('view_keys') || '[]');
  stored.push({ data: keyData, encrypted });
  localStorage.setItem('view_keys', JSON.stringify(stored));
}

export async function retrieveViewKeys(mainPublicKey: PublicKey): Promise<ViewKeyData[]> {
  const stored = JSON.parse(localStorage.getItem('view_keys') || '[]');
  return stored
    .filter((entry: any) => entry.data.mainPublicKey === mainPublicKey.toBase58())
    .map((entry: any) => entry.data);
}
```

---

## Item 4: Prover Infrastructure Hardening

### Component 1: Queue Manager (queue.ts)

```typescript
// zk/prover-service/src/queue.ts

import Bull from 'bull';
import { createHash } from 'crypto';
import { REDIS_URL } from './config.js';

interface ProofJob {
  circuit: 'deposit' | 'transfer' | 'withdraw';
  input: any;
  priority: 'low' | 'normal' | 'high';
  requestId: string;
}

interface JobResult {
  proofBytes: string;
  publicInputs: string[];
  witnesses: any;
}

let proofQueue: Bull.Queue<ProofJob> | null = null;

export function initializeQueue(): Bull.Queue<ProofJob> {
  if (proofQueue) return proofQueue;

  proofQueue = new Bull('proof-generation', REDIS_URL || 'redis://localhost:6379', {
    maxStalledCount: 2,
    stalledInterval: 10000,
    lockDuration: 60000,
    lockRenewTime: 15000,
  });

  // Set concurrency based on available CPUs
  const concurrency = Math.max(2, Math.floor(require('os').cpus().length / 2));
  
  proofQueue.process(concurrency, async (job) => {
    return generateProof(job.data);
  });

  proofQueue.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job.id} failed:`, err.message);
  });

  proofQueue.on('completed', (job) => {
    console.log(`[Queue] Job ${job.id} completed`);
  });

  return proofQueue;
}

export async function submitProofJob(
  circuit: 'deposit' | 'transfer' | 'withdraw',
  input: any,
  priority: 'low' | 'normal' | 'high' = 'normal'
): Promise<string> {
  if (!proofQueue) throw new Error('Queue not initialized');

  const requestId = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const priorityValue = { low: 0, normal: 5, high: 10 }[priority];

  const job = await proofQueue.add(
    { circuit, input, priority, requestId },
    {
      priority: priorityValue,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600 }, // Keep for 1 hour
      removeOnFail: false,
    }
  );

  return job.id?.toString() || '';
}

export async function getJobStatus(jobId: string): Promise<{
  state: string;
  progress: number;
  result?: JobResult;
  failedReason?: string;
} | null> {
  if (!proofQueue) throw new Error('Queue not initialized');

  const job = await proofQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = job.progress();

  return {
    state,
    progress,
    result: job.returnvalue as JobResult,
    failedReason: job.failedReason,
  };
}

export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  if (!proofQueue) throw new Error('Queue not initialized');

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    proofQueue.count(),
    proofQueue.getActiveCount(),
    proofQueue.getCompletedCount(),
    proofQueue.getFailedCount(),
    proofQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

async function generateProof(job: ProofJob): Promise<JobResult> {
  // Delegate to actual proof generation
  // This is where GPU worker pool would be called
  return await generateProofWithWorkerPool(job.circuit, job.input);
}
```

### Component 2: Cache Layer (cache.ts)

```typescript
// zk/prover-service/src/cache.ts

import Redis from 'redis';
import { createHash } from 'crypto';
import { REDIS_URL } from './config.js';

interface CachedProof {
  proofBytes: string;
  publicInputs: string[];
  timestamp: number;
}

let redisClient: Redis.RedisClient | null = null;

export async function initializeCache(): Promise<Redis.RedisClient> {
  if (redisClient) return redisClient;

  redisClient = Redis.createClient({
    url: REDIS_URL || 'redis://localhost:6379',
  });

  redisClient.on('error', (err) => console.error('[Cache] Redis error:', err));

  await redisClient.connect();
  console.log('[Cache] Redis connected');

  return redisClient;
}

export function getCacheKey(circuit: string, input: any): string {
  const json = JSON.stringify(input);
  const hash = createHash('blake3').update(json).digest('hex');
  return `proof:${circuit}:${hash}`;
}

export async function getCachedProof(
  circuit: string,
  input: any
): Promise<CachedProof | null> {
  if (!redisClient) return null;

  const key = getCacheKey(circuit, input);
  const cached = await redisClient.get(key);

  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    await redisClient.del(key);
    return null;
  }
}

export async function cacheProof(
  circuit: string,
  input: any,
  proof: CachedProof,
  ttlSeconds: number = 3600
): Promise<void> {
  if (!redisClient) return;

  const key = getCacheKey(circuit, input);
  await redisClient.setEx(key, ttlSeconds, JSON.stringify(proof));
}

export async function getCacheStats(): Promise<{
  keys: number;
  memoryUsage: string;
  hitRate: number;
}> {
  if (!redisClient) {
    return { keys: 0, memoryUsage: '0B', hitRate: 0 };
  }

  const info = await redisClient.info();
  const dbSize = await redisClient.dbSize();

  // Parse Redis info response
  const memoryMatch = info.match(/used_memory_human:(.*?)\r/);
  const memoryUsage = memoryMatch ? memoryMatch[1] : 'Unknown';

  return {
    keys: dbSize,
    memoryUsage,
    hitRate: 0.75, // Placeholder - track real hits
  };
}

export async function clearCache(): Promise<void> {
  if (!redisClient) return;
  await redisClient.flushDb();
}
```

### Component 3: Worker Pool (workerPool.ts)

```typescript
// zk/prover-service/src/workerPool.ts

import Piscina from 'piscina';
import path from 'path';
import os from 'os';

interface ProofInput {
  circuit: 'deposit' | 'transfer' | 'withdraw';
  input: any;
}

interface ProofOutput {
  proofBytes: string;
  publicInputs: string[];
}

let workerPool: Piscina | null = null;

export function initializeWorkerPool(): Piscina {
  if (workerPool) return workerPool;

  const numWorkers = Math.min(4, os.cpus().length);

  workerPool = new Piscina({
    filename: path.resolve('./src/workers/proverWorker.ts'),
    maxThreads: numWorkers,
    maxQueue: 100,
    idleTimeout: 30000,
  });

  console.log(`[WorkerPool] Initialized with ${numWorkers} workers`);

  return workerPool;
}

export async function generateProofWithWorkers(
  circuit: 'deposit' | 'transfer' | 'withdraw',
  input: any
): Promise<ProofOutput> {
  if (!workerPool) throw new Error('Worker pool not initialized');

  const result = await workerPool.run(
    { circuit, input },
    { timeout: 300000 } // 5 minute timeout
  );

  return result as ProofOutput;
}

export function getWorkerPoolStats(): {
  activeWorkers: number;
  queueLength: number;
} {
  if (!workerPool) return { activeWorkers: 0, queueLength: 0 };

  return {
    activeWorkers: workerPool.threads.length,
    queueLength: workerPool.options.maxQueue || 0,
  };
}
```

### Component 4: GPU Manager (gpu.ts)

```typescript
// zk/prover-service/src/gpu.ts

import { execSync } from 'child_process';

export interface GPUInfo {
  available: boolean;
  devices: GPUDevice[];
  totalMemory: number;
  availableMemory: number;
}

export interface GPUDevice {
  id: number;
  name: string;
  memoryTotal: number;
  memoryFree: number;
}

export function detectGPU(): GPUInfo {
  try {
    // Check for NVIDIA GPUs using nvidia-smi
    const output = execSync('nvidia-smi --query-gpu=index,name,memory.total,memory.free --format=csv,noheader', {
      encoding: 'utf-8',
    });

    const devices: GPUDevice[] = output
      .trim()
      .split('\n')
      .map((line) => {
        const [id, name, memoryTotal, memoryFree] = line.split(',').map((s) => s.trim());
        return {
          id: parseInt(id),
          name,
          memoryTotal: parseSizeToBytes(memoryTotal),
          memoryFree: parseSizeToBytes(memoryFree),
        };
      });

    const totalMemory = devices.reduce((sum, d) => sum + d.memoryTotal, 0);
    const availableMemory = devices.reduce((sum, d) => sum + d.memoryFree, 0);

    return {
      available: true,
      devices,
      totalMemory,
      availableMemory,
    };
  } catch {
    // GPU not available or nvidia-smi not found
    return {
      available: false,
      devices: [],
      totalMemory: 0,
      availableMemory: 0,
    };
  }
}

export function ensureGPUMemory(requiredBytes: number): boolean {
  const gpu = detectGPU();
  if (!gpu.available) return false;
  return gpu.availableMemory > requiredBytes;
}

function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([KMGT]iB)$/);
  if (!match) return 0;

  const [, value, unit] = match;
  const multipliers = { 'KiB': 1024, 'MiB': 1024 ** 2, 'GiB': 1024 ** 3, 'TiB': 1024 ** 4 };
  return parseFloat(value) * (multipliers[unit as keyof typeof multipliers] || 1);
}

export function setGPUDevice(deviceId: number): void {
  process.env.CUDA_VISIBLE_DEVICES = deviceId.toString();
}
```

### Updated: Main Server (index.ts modifications)

```typescript
// zk/prover-service/src/index.ts - UPDATED SECTIONS

import { initializeQueue, submitProofJob, getJobStatus, getQueueStats } from './queue.js';
import { initializeCache, getCachedProof, cacheProof } from './cache.js';
import { initializeWorkerPool } from './workerPool.js';
import { detectGPU } from './gpu.js';

// Initialize infrastructure
const queue = initializeQueue();
const cache = await initializeCache();
const workers = initializeWorkerPool();
const gpuInfo = detectGPU();

if (gpuInfo.available) {
  console.log(`[GPU] Detected ${gpuInfo.devices.length} GPUs`);
  gpuInfo.devices.forEach((d) => {
    console.log(`  - ${d.name} (${(d.memoryTotal / 1024 ** 3).toFixed(1)} GB)`);
  });
}

// Updated proof endpoint with caching + queuing
app.post('/prove/:circuit', async (req: Request, res: Response) => {
  try {
    const circuit = req.params.circuit as 'deposit' | 'transfer' | 'withdraw';
    const input = req.body;

    if (!['deposit', 'transfer', 'withdraw'].includes(circuit)) {
      return res.status(400).json({ error: 'Invalid circuit' });
    }

    // Check cache first
    const cached = await getCachedProof(circuit, input);
    if (cached) {
      console.log(`[Cache] HIT for ${circuit}`);
      return res.json(cached);
    }

    // Submit to queue
    const priority = (req.body.priority as any) || 'normal';
    const jobId = await submitProofJob(circuit, input, priority);

    res.json({ jobId, status: 'queued' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: formatError(err) });
  }
});

// New endpoint: Get job status
app.get('/prove/:jobId/status', async (req: Request, res: Response) => {
  try {
    const status = await getJobStatus(req.params.jobId);
    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: formatError(err) });
  }
});

// New endpoint: Queue stats
app.get('/stats', async (req: Request, res: Response) => {
  try {
    const queueStats = await getQueueStats();
    res.json({
      queue: queueStats,
      gpu: gpuInfo,
    });
  } catch (err) {
    res.status(400).json({ error: formatError(err) });
  }
});
```

---

## Deployment Notes

### For Item 3 (UI Components)

```bash
# After creating the 3 components:
cd app
npm run dev          # Test locally
npm run build        # Build for production
npm run lint         # Check TypeScript
```

### For Item 4 (Infrastructure)

```bash
# Install dependencies
cd zk/prover-service
npm install bull redis piscina

# Start Redis
docker run -d -p 6379:6379 redis:latest

# Start prover service with queue + cache
REDIS_URL=redis://localhost:6379 npm start

# Monitor queue
npm run monitor-queue
```

---

## Testing Checklist

### Item 3 UI Components
- [ ] CommitmentExplorer loads commitments from on-chain
- [ ] CommitmentExplorer verifies Merkle proofs locally
- [ ] MerkleRootSync detects out-of-sync status
- [ ] MerkleRootSync force-syncs on demand
- [ ] ViewKeyManager generates and encrypts keys
- [ ] ViewKeyManager can revoke keys
- [ ] All 3 components integrate with Dashboard

### Item 4 Infrastructure
- [ ] Queue accepts proof requests
- [ ] Cache hits for repeated inputs
- [ ] Worker pool processes jobs in parallel
- [ ] GPU acceleration active (if GPU available)
- [ ] Queue stats endpoint returns accurate counts
- [ ] Job status endpoint tracks progress
- [ ] Load test with 100 concurrent requests

