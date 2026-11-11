import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DEFAULT_NEAR_MODEL, explainTransaction } from './near.ts';
import { evaluatePolicy, reviewInputSchema } from './policy.ts';
import { simulateTransfer } from './rpc.ts';
import { scenarios } from './scenarios.ts';
import type { ReviewResult } from './types.ts';

const PUBLIC_DIR = new URL('../public/', import.meta.url);
const STATIC_FILES: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_192) throw new Error('Body too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export interface ServerDependencies {
  simulate?: typeof simulateTransfer;
  explain?: typeof explainTransaction;
}

export function configuredPort(value = process.env.PORT): number {
  if (value === undefined || value.trim() === '') return 4173;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error('PORT must be an integer from 1024 to 65535.');
  }
  return Number(value);
}

/** Loopback-only server. Test seams never change the production RPC destination. */
export function createAppServer(dependencies: ServerDependencies = {}) {
  const simulate = dependencies.simulate ?? simulateTransfer;
  const explain = dependencies.explain ?? explainTransaction;
  let inflight = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");

    const bound = server.address();
    const port = bound && typeof bound === 'object' ? bound.port : 4173;
    const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (!host || !hosts.has(host) || (origin !== undefined && !hosts.has(origin.replace(/^http:\/\//, '')))
      || (origin !== undefined && !origin.startsWith('http://')) || request.headers['sec-fetch-site'] === 'cross-site') {
      json(response, 403, { error: 'Only this local application may access the service.' });
      return;
    }
    // No URL normalization: only exact local route names are served.
    const route = request.url ?? '';
    try {
      if (request.method === 'GET' && STATIC_FILES[route]) {
        const [filename, type] = STATIC_FILES[route];
        const content = await readFile(new URL(filename, PUBLIC_DIR));
        response.writeHead(200, { 'Content-Type': type });
        response.end(content);
        return;
      }
      if (request.method === 'GET' && route === '/api/status') {
        const rpcConfigured = Boolean(process.env.ERPC_RPC_KEY?.trim());
        const requestedModel = process.env.NEAR_AI_MODEL?.trim() || DEFAULT_NEAR_MODEL;
        const modelValid = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(requestedModel);
        const aiConfigured = Boolean(process.env.NEAR_AI_API_KEY?.trim()) && modelValid;
        json(response, 200, { rpcConfigured, aiConfigured, model: modelValid ? requestedModel : 'unconfigured',
          network: 'solana-testnet', mode: rpcConfigured && aiConfigured ? 'live' : 'offline' });
        return;
      }
      if (request.method === 'GET' && route === '/api/scenarios') {
        json(response, 200, scenarios);
        return;
      }
      if (request.method !== 'POST' || route !== '/api/review') {
        json(response, 404, { error: 'Route not found.' });
        return;
      }
      if (origin === undefined) {
        json(response, 403, { error: 'A matching local Origin is required.' });
        return;
      }
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        json(response, 415, { error: 'Use application/json.' });
        return;
      }
      const declaredLength = request.headers['content-length'];
      if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 8_192)) {
        json(response, 413, { error: 'The request exceeds the 8 KB limit.' });
        return;
      }
      if (inflight >= 2) {
        json(response, 429, { error: 'Two reviews are already running. Try again shortly.' });
        return;
      }
      inflight++;
      try {
        let body: unknown;
        try { body = await readBody(request); } catch {
          json(response, 400, { error: 'Invalid or oversized JSON request.' });
          return;
        }
        const parsed = reviewInputSchema.safeParse(body);
        if (!parsed.success) {
          json(response, 400, { error: 'Use a demo scenario, recipient aliases and plain decimal SOL amounts with at most 9 fractional digits. Do not enter personal identifiers, addresses or credentials.' });
          return;
        }
        const input = parsed.data;
        const policy = evaluatePolicy(input);
        const simulation = await simulate(input);
        const explanation = await explain(input, policy, simulation);
        const result: ReviewResult = { id: randomUUID(), reviewedAt: new Date().toISOString(), input, policy, simulation, explanation,
          mode: explanation.status === 'complete' && simulation.status !== 'unavailable' ? 'live' : 'offline' };
        json(response, 200, result);
      } finally { inflight--; }
    } catch {
      if (!response.headersSent) json(response, 500, { error: 'The review could not be completed. No transaction was sent.' });
      else response.end();
    }
  });
  server.maxHeadersCount = 30;
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = configuredPort();
  createAppServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`NEAR Private Preflight is ready at http://localhost:${port}\n`);
  });
}
