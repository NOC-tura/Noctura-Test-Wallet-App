# P1: Relayer Failover Infrastructure

## Overview
The wallet now supports multiple relayer endpoints with automatic health checking and failover. If a relayer becomes slow or unresponsive, the wallet will automatically try the next healthy endpoint for withdrawal and transfer operations.

## Configuration

### Environment Variables
```bash
# Comma-separated list of relayer URLs (defaults to ProverServiceUrl if not set)
VITE_RELAYER_ENDPOINTS=http://relayer1:8787,http://relayer2:8787,http://relayer3:8787
```

### Default Behavior
- If `VITE_RELAYER_ENDPOINTS` is not set, the wallet uses the primary `ProverServiceUrl`
- Health checks occur every 30 seconds
- Relayer health check timeout: 5 seconds
- Each relayer attempt (relayWithdraw, relayTransfer) retries up to 3 times across different endpoints

## How It Works

### RelayerManager
- **Singleton pattern**: `relayerManager` manages all relayer endpoints globally
- **Health status**: Each endpoint tracks:
  - `healthy`: boolean flag (marked unhealthy after 3+ failures)
  - `lastHealthCheckMs`: timestamp of last health check
  - `failureCount`: cumulative failures (decreases on success)
  - `successCount`: cumulative successes

### Health Checks
- Runs automatically every 30 seconds
- Makes GET request to `{endpoint}/health`
- Marks endpoint as unhealthy if unreachable or times out after 5s
- Logs health status changes to console

### Failover on Relay Operations
When submitting withdrawal or transfer via relayer:
1. Get the next healthy endpoint from manager
2. Attempt the request with 60s timeout
3. On success: record success, return result
4. On failure: record failure, try next endpoint (up to 3 times)
5. If all attempts fail: throw error with last failure reason

## Usage

### Example: Multiple Relayers in Production
```bash
# Set environment variables
export VITE_RELAYER_ENDPOINTS=https://relayer-us.noctura.ai,https://relayer-eu.noctura.ai,https://relayer-asia.noctura.ai
npm run dev
```

### Monitoring Relayer Status
The wallet logs all health check results and relay attempts:
```
[RelayerManager] Starting health check on 3 endpoints...
[RelayerManager] https://relayer-us.noctura.ai health: ✅ ok
[RelayerManager] https://relayer-eu.noctura.ai health: ❌ degraded
[RelayerManager] Health check complete. Healthy: 2/3

[Relay] Attempt 1/3 to https://relayer-us.noctura.ai/relay/withdraw
[Relay] Success on https://relayer-us.noctura.ai
```

### Programmatic Access
```typescript
import relayerManager from './lib/relayerManager';

// Get all relayer status
const status = relayerManager.getStatus();
status.forEach(endpoint => {
  console.log(`${endpoint.url}: ${endpoint.healthy ? '✅' : '❌'} (${endpoint.successCount} successes, ${endpoint.failureCount} failures)`);
});

// Stop health checks (optional, usually not needed)
relayerManager.stopHealthChecks();
```

## Implementation Details

### Files Modified
- `app/src/lib/constants.ts`: Added relayer endpoint configuration constants
- `app/src/lib/relayerManager.ts`: New RelayerManager class with health tracking
- `app/src/lib/prover.ts`: Updated relayWithdraw/relayTransfer to use httpWithFailover

### Key Functions in RelayerManager
- `getHealthyEndpoint()`: Returns next healthy endpoint, cycling through list
- `recordSuccess(url)`: Mark endpoint as successful
- `recordFailure(url, error?)`: Mark endpoint as failed
- `getStatus()`: Get all endpoints and their current health
- `startHealthChecks()`: Begin periodic health checks (auto-started)
- `stopHealthChecks()`: Stop periodic health checks

## Testing

### Local Testing with Single Relayer
```bash
# Default behavior: uses ProverServiceUrl
npm run dev
```

### Testing with Multiple Mock Relayers
```bash
# Set multiple endpoints (can be same URL repeated for testing)
export VITE_RELAYER_ENDPOINTS=http://localhost:8787,http://localhost:8787,http://localhost:8787
npm run dev
```

## Future Improvements
- [ ] Per-relayer SLO tracking (latency percentiles, error rates)
- [ ] Adaptive retry backoff (exponential backoff for consistently failing relayers)
- [ ] Relayer reputation scoring based on historical performance
- [ ] Geographic/latency-based endpoint selection
- [ ] Relayer discovery via on-chain registry
