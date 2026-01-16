/**
 * Multi-Relayer Selection
 * 
 * Privacy Enhancement Feature per Privacy Guide:
 * 
 * WHY RELAYERS MATTER:
 * - Relayers submit transactions on behalf of users
 * - This hides the sender's IP address from the blockchain
 * - Single relayer = single point of trust/failure
 * 
 * MULTI-RELAYER BENEFITS:
 * - Random selection prevents tracking
 * - Failover for reliability
 * - No single relayer sees all your transactions
 * - Geographic distribution for latency optimization
 * 
 * SELECTION STRATEGIES:
 * - Random: Maximum privacy
 * - Round-robin: Fair distribution
 * - Weighted: Based on success rate/latency
 * - Geographic: Nearest for speed
 */

import { randomBytes } from '@noble/hashes/utils';
import { setEncrypted, getEncrypted, ENCRYPTED_STORAGE_KEYS } from './encryptedStorage';

/**
 * Relayer information
 */
export interface RelayerInfo {
  id: string;
  name: string;
  url: string;
  region?: string;                    // Geographic region
  publicKey?: string;                 // Relayer's public key for verification
  supportedAssets: string[];          // Asset mints this relayer supports
  feePercentage: number;              // Fee in basis points (e.g., 50 = 0.5%)
  minFee: bigint;                     // Minimum fee in lamports
  maxFee: bigint;                     // Maximum fee in lamports
  enabled: boolean;
  trusted: boolean;                   // User-marked as trusted
  addedAt: number;
}

/**
 * Relayer health/performance metrics
 */
export interface RelayerMetrics {
  relayerId: string;
  successCount: number;
  failureCount: number;
  totalSubmissions: number;
  avgLatencyMs: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastErrorMessage?: string;
  uptime: number;                     // Percentage (0-100)
}

/**
 * Relayer selection strategy
 */
export type SelectionStrategy = 
  | 'random'          // Cryptographically random selection
  | 'round-robin'     // Sequential rotation
  | 'weighted'        // Based on success rate
  | 'fastest'         // Lowest latency
  | 'cheapest'        // Lowest fees
  | 'trusted-only';   // Only user-trusted relayers

/**
 * Relayer pool configuration
 */
export interface RelayerPoolConfig {
  selectionStrategy: SelectionStrategy;
  maxRetries: number;
  failoverEnabled: boolean;
  excludeFailedFor: number;           // Exclude failed relayers for X ms
  preferTrusted: boolean;             // Prefer trusted relayers
  minSuccessRate: number;             // Minimum success rate (0-1)
}

/**
 * Default relayer pool configuration
 */
export const DEFAULT_POOL_CONFIG: RelayerPoolConfig = {
  selectionStrategy: 'random',
  maxRetries: 3,
  failoverEnabled: true,
  excludeFailedFor: 300000,           // 5 minutes
  preferTrusted: true,
  minSuccessRate: 0.7,
};

/**
 * Default/official relayers
 */
export const DEFAULT_RELAYERS: Omit<RelayerInfo, 'id' | 'addedAt'>[] = [
  {
    name: 'Noctura Official',
    url: 'https://relayer.noctura.io',
    region: 'global',
    supportedAssets: ['native', '*'],
    feePercentage: 50,                // 0.5%
    minFee: 5000n,
    maxFee: 1000000000n,              // 1 SOL max
    enabled: true,
    trusted: true,
  },
  {
    name: 'Noctura US',
    url: 'https://us.relayer.noctura.io',
    region: 'us',
    supportedAssets: ['native', '*'],
    feePercentage: 50,
    minFee: 5000n,
    maxFee: 1000000000n,
    enabled: true,
    trusted: true,
  },
  {
    name: 'Noctura EU',
    url: 'https://eu.relayer.noctura.io',
    region: 'eu',
    supportedAssets: ['native', '*'],
    feePercentage: 50,
    minFee: 5000n,
    maxFee: 1000000000n,
    enabled: true,
    trusted: true,
  },
  {
    name: 'Noctura Asia',
    url: 'https://asia.relayer.noctura.io',
    region: 'asia',
    supportedAssets: ['native', '*'],
    feePercentage: 50,
    minFee: 5000n,
    maxFee: 1000000000n,
    enabled: true,
    trusted: true,
  },
];

/**
 * Generate unique relayer ID
 */
function generateRelayerId(): string {
  return `rel_${Date.now()}_${bytesToHex(randomBytes(4))}`;
}

/**
 * Convert bytes to hex
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cryptographically secure random selection
 */
function secureRandomIndex(max: number): number {
  const bytes = randomBytes(4);
  const value = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return Math.abs(value) % max;
}

/**
 * Multi-Relayer Pool Manager
 */
export class RelayerPool {
  private password: string;
  private config: RelayerPoolConfig;
  private relayers: RelayerInfo[] = [];
  private metrics: Map<string, RelayerMetrics> = new Map();
  private roundRobinIndex = 0;
  private loaded = false;

  constructor(password: string, config: Partial<RelayerPoolConfig> = {}) {
    this.password = password;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Load relayer pool from storage
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const stored = await getEncrypted<{
        relayers: RelayerInfo[];
        metrics: [string, RelayerMetrics][];
      }>(
        ENCRYPTED_STORAGE_KEYS.SETTINGS + '_relayers',
        this.password
      );

      if (stored) {
        // Parse bigint values
        this.relayers = stored.relayers.map(r => ({
          ...r,
          minFee: BigInt(r.minFee as unknown as string || '5000'),
          maxFee: BigInt(r.maxFee as unknown as string || '1000000000'),
        }));
        this.metrics = new Map(stored.metrics);
      } else {
        // Initialize with defaults
        this.relayers = DEFAULT_RELAYERS.map(r => ({
          ...r,
          id: generateRelayerId(),
          addedAt: Date.now(),
        }));
      }

      this.loaded = true;
      console.log(`[RelayerPool] Loaded ${this.relayers.length} relayers`);
    } catch {
      this.relayers = DEFAULT_RELAYERS.map(r => ({
        ...r,
        id: generateRelayerId(),
        addedAt: Date.now(),
      }));
      this.loaded = true;
    }
  }

  /**
   * Save relayer pool
   */
  private async save(): Promise<void> {
    await setEncrypted(
      ENCRYPTED_STORAGE_KEYS.SETTINGS + '_relayers',
      {
        relayers: this.relayers.map(r => ({
          ...r,
          minFee: r.minFee.toString(),
          maxFee: r.maxFee.toString(),
        })),
        metrics: Array.from(this.metrics.entries()),
      },
      this.password
    );
  }

  /**
   * Add a custom relayer
   */
  async addRelayer(relayer: Omit<RelayerInfo, 'id' | 'addedAt'>): Promise<RelayerInfo> {
    await this.load();

    // Check for duplicate URL
    if (this.relayers.some(r => r.url === relayer.url)) {
      throw new Error('Relayer with this URL already exists');
    }

    const newRelayer: RelayerInfo = {
      ...relayer,
      id: generateRelayerId(),
      addedAt: Date.now(),
    };

    this.relayers.push(newRelayer);
    await this.save();

    console.log(`[RelayerPool] Added relayer: ${newRelayer.name}`);
    return newRelayer;
  }

  /**
   * Remove a relayer
   */
  async removeRelayer(id: string): Promise<boolean> {
    await this.load();

    const index = this.relayers.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.relayers.splice(index, 1);
    this.metrics.delete(id);
    await this.save();

    return true;
  }

  /**
   * Toggle relayer enabled status
   */
  async toggleRelayer(id: string, enabled: boolean): Promise<void> {
    await this.load();

    const relayer = this.relayers.find(r => r.id === id);
    if (relayer) {
      relayer.enabled = enabled;
      await this.save();
    }
  }

  /**
   * Mark relayer as trusted/untrusted
   */
  async setTrusted(id: string, trusted: boolean): Promise<void> {
    await this.load();

    const relayer = this.relayers.find(r => r.id === id);
    if (relayer) {
      relayer.trusted = trusted;
      await this.save();
    }
  }

  /**
   * Get all relayers
   */
  async getRelayers(): Promise<RelayerInfo[]> {
    await this.load();
    return [...this.relayers];
  }

  /**
   * Get enabled relayers
   */
  async getEnabledRelayers(): Promise<RelayerInfo[]> {
    await this.load();
    return this.relayers.filter(r => r.enabled);
  }

  /**
   * Get relayer metrics
   */
  async getMetrics(id: string): Promise<RelayerMetrics | null> {
    await this.load();
    return this.metrics.get(id) || null;
  }

  /**
   * Select a relayer based on strategy
   */
  async selectRelayer(
    assetMint?: string,
    strategy?: SelectionStrategy
  ): Promise<RelayerInfo | null> {
    await this.load();

    const effectiveStrategy = strategy || this.config.selectionStrategy;
    
    // Filter available relayers
    let candidates = this.relayers.filter(r => {
      if (!r.enabled) return false;
      
      // Check asset support
      if (assetMint && !r.supportedAssets.includes('*') && !r.supportedAssets.includes(assetMint)) {
        return false;
      }
      
      // Exclude recently failed
      if (this.config.failoverEnabled) {
        const metrics = this.metrics.get(r.id);
        if (metrics?.lastFailureAt) {
          const timeSinceFailure = Date.now() - metrics.lastFailureAt;
          if (timeSinceFailure < this.config.excludeFailedFor) {
            return false;
          }
        }
      }
      
      // Check minimum success rate
      if (this.config.minSuccessRate > 0) {
        const metrics = this.metrics.get(r.id);
        if (metrics && metrics.totalSubmissions > 5) {
          const successRate = metrics.successCount / metrics.totalSubmissions;
          if (successRate < this.config.minSuccessRate) {
            return false;
          }
        }
      }
      
      return true;
    });

    if (candidates.length === 0) {
      console.warn('[RelayerPool] No available relayers');
      return null;
    }

    // Prefer trusted if configured
    if (this.config.preferTrusted) {
      const trusted = candidates.filter(r => r.trusted);
      if (trusted.length > 0) {
        candidates = trusted;
      }
    }

    // Apply selection strategy
    switch (effectiveStrategy) {
      case 'random':
        return this.selectRandom(candidates);
      case 'round-robin':
        return this.selectRoundRobin(candidates);
      case 'weighted':
        return this.selectWeighted(candidates);
      case 'fastest':
        return this.selectFastest(candidates);
      case 'cheapest':
        return this.selectCheapest(candidates);
      case 'trusted-only':
        const trustedOnly = candidates.filter(r => r.trusted);
        return trustedOnly.length > 0 ? this.selectRandom(trustedOnly) : null;
      default:
        return this.selectRandom(candidates);
    }
  }

  /**
   * Random selection (most private)
   */
  private selectRandom(candidates: RelayerInfo[]): RelayerInfo {
    const index = secureRandomIndex(candidates.length);
    return candidates[index];
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(candidates: RelayerInfo[]): RelayerInfo {
    this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
    return candidates[this.roundRobinIndex];
  }

  /**
   * Weighted selection based on success rate
   */
  private selectWeighted(candidates: RelayerInfo[]): RelayerInfo {
    // Calculate weights
    const weights = candidates.map(r => {
      const metrics = this.metrics.get(r.id);
      if (!metrics || metrics.totalSubmissions === 0) {
        return 1; // New relayers get base weight
      }
      return metrics.successCount / metrics.totalSubmissions;
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const random = Math.random() * totalWeight;
    
    let cumulative = 0;
    for (let i = 0; i < candidates.length; i++) {
      cumulative += weights[i];
      if (random <= cumulative) {
        return candidates[i];
      }
    }
    
    return candidates[candidates.length - 1];
  }

  /**
   * Select fastest relayer
   */
  private selectFastest(candidates: RelayerInfo[]): RelayerInfo {
    const withLatency = candidates.map(r => ({
      relayer: r,
      latency: this.metrics.get(r.id)?.avgLatencyMs || Number.MAX_VALUE,
    }));

    withLatency.sort((a, b) => a.latency - b.latency);
    return withLatency[0].relayer;
  }

  /**
   * Select cheapest relayer
   */
  private selectCheapest(candidates: RelayerInfo[]): RelayerInfo {
    const sorted = [...candidates].sort((a, b) => a.feePercentage - b.feePercentage);
    return sorted[0];
  }

  /**
   * Record transaction result
   */
  async recordResult(
    relayerId: string,
    success: boolean,
    latencyMs: number,
    errorMessage?: string
  ): Promise<void> {
    await this.load();

    let metrics = this.metrics.get(relayerId);
    if (!metrics) {
      metrics = {
        relayerId,
        successCount: 0,
        failureCount: 0,
        totalSubmissions: 0,
        avgLatencyMs: 0,
        uptime: 100,
      };
    }

    metrics.totalSubmissions++;
    
    if (success) {
      metrics.successCount++;
      metrics.lastSuccessAt = Date.now();
      // Update average latency
      metrics.avgLatencyMs = 
        (metrics.avgLatencyMs * (metrics.successCount - 1) + latencyMs) / metrics.successCount;
    } else {
      metrics.failureCount++;
      metrics.lastFailureAt = Date.now();
      metrics.lastErrorMessage = errorMessage;
    }

    // Calculate uptime
    metrics.uptime = (metrics.successCount / metrics.totalSubmissions) * 100;

    this.metrics.set(relayerId, metrics);
    await this.save();
  }

  /**
   * Select and execute with failover
   */
  async executeWithFailover<T>(
    execute: (relayer: RelayerInfo) => Promise<T>,
    assetMint?: string
  ): Promise<{ result: T; relayer: RelayerInfo }> {
    await this.load();

    const usedRelayers = new Set<string>();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      // Get available relayers (excluding already tried)
      const candidates = this.relayers.filter(
        r => r.enabled && !usedRelayers.has(r.id)
      );

      if (candidates.length === 0) {
        throw new Error(`All relayers exhausted after ${attempt} attempts: ${lastError?.message}`);
      }

      const relayer = await this.selectRelayer(assetMint);
      if (!relayer) {
        throw new Error('No available relayers');
      }

      usedRelayers.add(relayer.id);
      const startTime = Date.now();

      try {
        console.log(`[RelayerPool] Trying relayer: ${relayer.name} (attempt ${attempt + 1})`);
        const result = await execute(relayer);
        const latency = Date.now() - startTime;
        
        await this.recordResult(relayer.id, true, latency);
        return { result, relayer };
      } catch (error) {
        const latency = Date.now() - startTime;
        const message = error instanceof Error ? error.message : 'Unknown error';
        
        await this.recordResult(relayer.id, false, latency, message);
        lastError = error instanceof Error ? error : new Error(message);
        
        console.warn(`[RelayerPool] Relayer ${relayer.name} failed: ${message}`);
        
        if (!this.config.failoverEnabled) {
          throw lastError;
        }
      }
    }

    throw new Error(`All relayer attempts failed: ${lastError?.message}`);
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<{
    totalRelayers: number;
    enabledRelayers: number;
    trustedRelayers: number;
    avgSuccessRate: number;
    avgLatencyMs: number;
  }> {
    await this.load();

    let totalSuccessRate = 0;
    let totalLatency = 0;
    let metricsCount = 0;

    for (const metrics of this.metrics.values()) {
      if (metrics.totalSubmissions > 0) {
        totalSuccessRate += metrics.successCount / metrics.totalSubmissions;
        totalLatency += metrics.avgLatencyMs;
        metricsCount++;
      }
    }

    return {
      totalRelayers: this.relayers.length,
      enabledRelayers: this.relayers.filter(r => r.enabled).length,
      trustedRelayers: this.relayers.filter(r => r.trusted).length,
      avgSuccessRate: metricsCount > 0 ? totalSuccessRate / metricsCount : 1,
      avgLatencyMs: metricsCount > 0 ? totalLatency / metricsCount : 0,
    };
  }

  /**
   * Set selection strategy
   */
  setStrategy(strategy: SelectionStrategy): void {
    this.config.selectionStrategy = strategy;
  }

  /**
   * Get current configuration
   */
  getConfig(): RelayerPoolConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RelayerPoolConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

/**
 * Create relayer pool instance
 */
export function createRelayerPool(
  password: string,
  config?: Partial<RelayerPoolConfig>
): RelayerPool {
  return new RelayerPool(password, config);
}

/**
 * Health check a relayer
 */
export async function healthCheckRelayer(relayer: RelayerInfo): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${relayer.url}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (response.ok) {
      return { healthy: true, latencyMs };
    } else {
      return { 
        healthy: false, 
        latencyMs, 
        error: `HTTP ${response.status}` 
      };
    }
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
