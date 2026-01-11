#!/usr/bin/env node
import http from 'node:http';
import { parse } from 'node:url';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

function json(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function ok(res) {
  json(res, 200, { status: 'ok' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function makeSignature(prefix = 'mocksig') {
  const random = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now().toString(16)}-${random}`;
}

const server = http.createServer(async (req, res) => {
  const url = parse(req.url, true);
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (url.pathname === '/health' && method === 'GET') {
    return ok(res);
  }

  // Prover mocks
  if (url.pathname && url.pathname.startsWith('/prove/')) {
    if (method !== 'POST') return notFound(res);
    try {
      await readBody(req); // Consume body but don't validate
      // Always return success with dummy proof
      const response = {
        proof: { type: 'mock' },
        publicSignals: [],
        proofBytes: '0xdeadbeef',
        publicInputs: [],
        proverMs: Math.floor(50 + Math.random() * 150),
        privacyFeeNoc: 250000,
      };
      return json(res, 200, response);
    } catch (e) {
      return json(res, 400, { error: 'Mock prover error' });
    }
  }

  // Relayer mocks
  if (url.pathname === '/relay/consolidate') {
    if (method !== 'POST') return notFound(res);
    try {
      const body = await readBody(req);
      const { inputNullifiers = [], outputCommitment } = body || {};
      if (!Array.isArray(inputNullifiers) || typeof outputCommitment !== 'string') {
        return json(res, 400, { error: 'Invalid consolidate payload' });
      }
      return json(res, 200, { signature: makeSignature('consolidate') });
    } catch (e) {
      return json(res, 400, { error: String(e?.message || e) });
    }
  }

  if (url.pathname === '/relay/transfer') {
    if (method !== 'POST') return notFound(res);
    try {
      const body = await readBody(req);
      const { nullifier, outputCommitment1, outputCommitment2 } = body || {};
      if (!nullifier || !outputCommitment1) {
        return json(res, 400, { error: 'Invalid transfer payload' });
      }
      return json(res, 200, { signature: makeSignature('transfer') });
    } catch (e) {
      return json(res, 400, { error: String(e?.message || e) });
    }
  }

  if (url.pathname === '/relay/withdraw') {
    if (method !== 'POST') return notFound(res);
    try {
      const body = await readBody(req);
      const { amount, nullifier, recipientAta, mint } = body || {};
      if (!amount || !nullifier || !recipientAta || !mint) {
        return json(res, 400, { error: 'Invalid withdraw payload' });
      }
      return json(res, 200, { signature: makeSignature('withdraw') });
    } catch (e) {
      return json(res, 400, { error: String(e?.message || e) });
    }
  }

  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`[MockRelayer] Listening on http://localhost:${PORT}`);
});
