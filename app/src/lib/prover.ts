import { ProverServiceUrl } from './constants';
import relayerManager from './relayerManager';

export type ProverResponse = {
  proof: unknown;
  publicSignals: string[];
  proofBytes: string;
  publicInputs: string[];
  proverMs: number;
  privacyFeeNoc: number;
};

const PROOF_TIMEOUT_MS = 120_000; // 2 minute timeout for proof generation
const RELAY_TIMEOUT_MS = 60_000; // 60 second timeout for relay (testnet can be slow)
const MAX_RETRIES = 3; // Try up to 3 relayers on failure

async function http<T>(path: string, body?: unknown, timeoutMs: number = PROOF_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`[HTTP] Fetching ${ProverServiceUrl}${path}... (timeout: ${timeoutMs/1000}s)`);
    const res = await fetch(`${ProverServiceUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log(`[HTTP] Response status: ${res.status}`);
    
    if (!res.ok) {
      const payload = await res.text();
      console.error(`[HTTP] Error response:`, payload);
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          throw new Error(String(parsed.error));
        }
      } catch {
        if (payload) {
          throw new Error(payload);
        }
      }
      throw new Error(`Prover request failed (${path}) with status ${res.status}`);
    }
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request to ${path} timed out after ${timeoutMs / 1000}s. The prover or network may be slow.`);
    }
    if (err instanceof TypeError) {
      throw new Error(`NetworkError: Unable to reach prover at ${ProverServiceUrl}${path}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * HTTP request with relayer failover: tries up to MAX_RETRIES relayers on failure
 */
async function httpWithFailover<T>(path: string, body?: unknown, timeoutMs: number = RELAY_TIMEOUT_MS): Promise<T> {
  let lastError: Error | null = null;
  const attemptedEndpoints: string[] = [];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const endpoint = relayerManager.getHealthyEndpoint();
    const url = `${endpoint.url}${path}`;
    
    if (attemptedEndpoints.includes(endpoint.url)) {
      // Already tried this endpoint, skip
      continue;
    }
    attemptedEndpoints.push(endpoint.url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[Relay] Attempt ${attempt + 1}/${MAX_RETRIES} to ${endpoint.url}${path}`);
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const payload = await res.text();
        console.error(`[Relay] Error from ${endpoint.url}: status ${res.status}`, payload);
        relayerManager.recordFailure(endpoint.url, `HTTP ${res.status}`);
        lastError = new Error(`Relayer ${endpoint.url} returned ${res.status}`);
        continue;
      }

      const result = await res.json();
      relayerManager.recordSuccess(endpoint.url);
      console.log(`[Relay] Success on ${endpoint.url}`);
      return result as T;
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Relay] Attempt ${attempt + 1} failed on ${endpoint.url}:`, msg);
      relayerManager.recordFailure(endpoint.url, msg);
      lastError = err instanceof Error ? err : new Error(msg);
    }
  }

  // All attempts failed
  if (lastError) {
    throw new Error(`All relayer attempts failed. Last error: ${lastError.message}`);
  }
  throw new Error('All relayer endpoints exhausted');
}

export function proveCircuit(circuit: 'deposit' | 'transfer' | 'transfer-multi' | 'withdraw', input: unknown) {
  console.log(`[Prover] Starting ${circuit} proof generation...`);
  console.log(`[Prover] Calling ${ProverServiceUrl}/prove/${circuit}`);
  return http<ProverResponse>(`/prove/${circuit}`, input)
    .then(result => {
      console.log(`[Prover] ${circuit} proof generated successfully in ${result.proverMs}ms`);
      return result;
    })
    .catch(err => {
      console.error(`[Prover] ${circuit} proof generation failed:`, err);
      throw err;
    });
}

export type RelayResponse = {
  signature: string;
};

/**
 * Submit a shielded withdrawal via the relayer service with automatic failover.
 * This preserves privacy - the relayer signs the transaction, not the user.
 * @param collectFee If true, adds 0.25 NOC fee and sends to fee collector
 */
export function relayWithdraw(params: {
  proof: ProverResponse;
  amount: string;
  nullifier: string;
  recipientAta: string;
  mint?: string;
  collectFee?: boolean;
}) {
  console.log('[Relayer] Submitting withdrawal via relayer (with failover), collectFee:', params.collectFee);
  return httpWithFailover<RelayResponse>('/relay/withdraw', {
    proof: {
      proofBytes: params.proof.proofBytes,
      publicInputs: params.proof.publicInputs,
    },
    amount: params.amount,
    nullifier: params.nullifier,
    recipientAta: params.recipientAta,
    mint: params.mint,
    collectFee: params.collectFee,
  }, RELAY_TIMEOUT_MS).then(result => {
    console.log('[Relayer] Withdrawal relayed successfully:', result.signature);
    return result;
  });
}

/**
 * Submit a shielded transfer (note split) via the relayer service with automatic failover.
 * This preserves privacy - the relayer signs the transaction, not the user.
 */
export function relayTransfer(params: {
  proof: ProverResponse;
  nullifier: string;
  outputCommitment1: string;
  outputCommitment2: string;
}) {
  console.log('[Relayer] Submitting transfer via relayer (with failover)...');
  return httpWithFailover<RelayResponse>('/relay/transfer', {
    proof: {
      proofBytes: params.proof.proofBytes,
      publicInputs: params.proof.publicInputs,
    },
    nullifier: params.nullifier,
    outputCommitment1: params.outputCommitment1,
    outputCommitment2: params.outputCommitment2,
  }, RELAY_TIMEOUT_MS).then(result => {
    console.log('[Relayer] Transfer relayed successfully:', result.signature);
    return result;
  });
}

export function requestNocAirdrop(destination: string) {
  return http<{ signature: string }>(`/airdrop`, { destination });
}
