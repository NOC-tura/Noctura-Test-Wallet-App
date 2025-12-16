import { RELAYER_ENDPOINTS, RELAYER_HEALTH_CHECK_INTERVAL_MS, RELAYER_HEALTH_CHECK_TIMEOUT_MS } from './constants';

export interface RelayerEndpoint {
  url: string;
  healthy: boolean;
  lastHealthCheckMs: number;
  failureCount: number;
  successCount: number;
}

class RelayerManager {
  private endpoints: RelayerEndpoint[] = [];
  private currentIndex = 0;
  private healthCheckIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.endpoints = RELAYER_ENDPOINTS.map((url) => ({
      url,
      healthy: true,
      lastHealthCheckMs: 0,
      failureCount: 0,
      successCount: 0,
    }));
    this.startHealthChecks();
  }

  /**
   * Get the next healthy relayer endpoint, cycling through available ones
   */
  getHealthyEndpoint(): RelayerEndpoint {
    if (this.endpoints.length === 0) {
      throw new Error('No relayer endpoints configured');
    }

    // Try to find a healthy endpoint starting from current index
    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (this.currentIndex + i) % this.endpoints.length;
      const endpoint = this.endpoints[idx];
      if (endpoint.healthy) {
        this.currentIndex = (idx + 1) % this.endpoints.length;
        console.log(`[RelayerManager] Using endpoint: ${endpoint.url} (failures: ${endpoint.failureCount}, successes: ${endpoint.successCount})`);
        return endpoint;
      }
    }

    // If no healthy endpoints, return least-failed one with a warning
    const leastFailed = this.endpoints.reduce((best, current) =>
      current.failureCount < best.failureCount ? current : best
    );
    console.warn(`[RelayerManager] No healthy endpoints, using least-failed: ${leastFailed.url}`);
    return leastFailed;
  }

  /**
   * Mark an endpoint as successfully responding
   */
  recordSuccess(url: string): void {
    const endpoint = this.endpoints.find((e) => e.url === url);
    if (endpoint) {
      endpoint.successCount++;
      endpoint.failureCount = Math.max(0, endpoint.failureCount - 1);
      if (endpoint.failureCount === 0) {
        endpoint.healthy = true;
      }
      console.log(`[RelayerManager] Success on ${url}: ${endpoint.successCount} successes, ${endpoint.failureCount} failures`);
    }
  }

  /**
   * Mark an endpoint as having failed
   */
  recordFailure(url: string, error?: string): void {
    const endpoint = this.endpoints.find((e) => e.url === url);
    if (endpoint) {
      endpoint.failureCount++;
      if (endpoint.failureCount >= 3) {
        endpoint.healthy = false;
      }
      console.warn(`[RelayerManager] Failure on ${url}: ${endpoint.failureCount} failures. ${error || ''}`);
    }
  }

  /**
   * Perform health check on all endpoints
   */
  private async performHealthCheck(): Promise<void> {
    console.log(`[RelayerManager] Starting health check on ${this.endpoints.length} endpoints...`);
    const results = await Promise.allSettled(
      this.endpoints.map(async (endpoint) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RELAYER_HEALTH_CHECK_TIMEOUT_MS);
        try {
          const res = await fetch(`${endpoint.url}/health`, { signal: controller.signal });
          clearTimeout(timeout);
          const wasHealthy = endpoint.healthy;
          endpoint.healthy = res.ok;
          endpoint.lastHealthCheckMs = Date.now();
          if (wasHealthy !== endpoint.healthy) {
            console.log(`[RelayerManager] ${endpoint.url} health: ${endpoint.healthy ? '✅ ok' : '❌ degraded'}`);
          }
        } catch (err) {
          clearTimeout(timeout);
          endpoint.healthy = false;
          endpoint.lastHealthCheckMs = Date.now();
          console.warn(`[RelayerManager] ${endpoint.url} health check failed: ${(err as Error).message}`);
        }
      })
    );
    console.log(`[RelayerManager] Health check complete. Healthy: ${this.endpoints.filter((e) => e.healthy).length}/${this.endpoints.length}`);
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckIntervalId) return; // Already running
    this.performHealthCheck(); // Check immediately
    this.healthCheckIntervalId = setInterval(() => {
      this.performHealthCheck();
    }, RELAYER_HEALTH_CHECK_INTERVAL_MS);
    console.log(`[RelayerManager] Health checks started (interval: ${RELAYER_HEALTH_CHECK_INTERVAL_MS}ms)`);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
      console.log(`[RelayerManager] Health checks stopped`);
    }
  }

  /**
   * Get all endpoints and their current status
   */
  getStatus(): RelayerEndpoint[] {
    return [...this.endpoints];
  }
}

// Singleton instance
const relayerManager = new RelayerManager();
export default relayerManager;
