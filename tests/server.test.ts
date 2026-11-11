import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { configuredPort, createAppServer, type ServerDependencies } from '../src/server.ts';
import { scenarios } from '../src/scenarios.ts';

async function withServer(run: (base: string, port: number) => Promise<void>, dependencies: ServerDependencies = {}) {
  const server = createAppServer(dependencies);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try { await run(`http://127.0.0.1:${port}`, port); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
const offline: ServerDependencies = {
  simulate: async () => ({ status: 'unavailable', provider: 'ERPC', network: 'solana-testnet', detail: 'Test: unavailable.' }),
  explain: async () => ({ status: 'unavailable', model: 'test/model', text: 'Test: no inference.', verification: { status: 'unavailable', detail: 'Test: no attestation.' } }),
};

test('valid local request returns real policy and marks unavailable dependencies honestly', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/review`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(scenarios[3]!.input) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.policy.decision, 'block');
    assert.equal(result.mode, 'offline');
    assert.equal(result.simulation.status, 'unavailable');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self'/);
  }, offline);
});

test('forged Host, missing Origin, external Origin and form bodies are rejected before inference', async () => {
  let touched = 0;
  await withServer(async (base, port) => {
    const forged = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/status', headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.end();
    });
    assert.equal(forged, 403);
    for (const origin of [undefined, 'https://attacker.example', `${base}.attacker.example`]) {
      const response = await fetch(`${base}/api/review`, { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(scenarios[0]!.input) });
      assert.equal(response.status, 403);
    }
    const form = await fetch(`${base}/api/review`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(form.status, 415);
    assert.equal(touched, 0);
  }, { ...offline, simulate: async (...args) => { touched++; return offline.simulate!(...args); } });
});

test('invalid fields, identifiers, oversized bodies and traversal are rejected', async () => {
  await withServer(async (base) => {
    for (const input of [{ ...scenarios[0]!.input, amountSol: '1e2' }, { ...scenarios[0]!.input, instruction: 'alice@example.com' }, { ...scenarios[0]!.input, signingKey: 'secret' }]) {
      const response = await fetch(`${base}/api/review`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /alice@example.com|secret/);
    }
    const huge = await fetch(`${base}/api/review`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: ' '.repeat(9_000) });
    assert.equal(huge.status, 413);
    assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/.env`)).status, 404);
    assert.equal((await fetch(`${base}/api/scenarios`)).status, 200);
  }, offline);
});

test('only two reviews can consume upstream resources concurrently', async () => {
  let entered = 0;
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const bothEntered = new Promise<void>((resolve) => { ready = resolve; });
  await withServer(async (base) => {
    const post = () => fetch(`${base}/api/review`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(scenarios[0]!.input) });
    const one = post();
    const two = post();
    await bothEntered;
    try {
      const three = await post();
      assert.equal(three.status, 429);
      assert.equal(entered, 2);
    } finally { release(); }
    assert.equal((await one).status, 200);
    assert.equal((await two).status, 200);
  }, { ...offline, simulate: async (...args) => { entered++; if (entered === 2) ready(); await gate; return offline.simulate!(...args); } });
});

test('configured ports are bounded and reject non-integer or privileged values', () => {
  assert.equal(configuredPort(''), 4173);
  assert.equal(configuredPort('1024'), 1024);
  assert.equal(configuredPort('65535'), 65535);
  for (const value of ['80', '0', '65536', '-1', '4e3', '4173.1', 'host:4173']) {
    assert.throws(() => configuredPort(value), /PORT must be an integer/);
  }
});

test('status reports the validated configured model without echoing invalid configuration', async () => {
  const previous = { model: process.env.NEAR_AI_MODEL, key: process.env.NEAR_AI_API_KEY };
  try {
    process.env.NEAR_AI_API_KEY = 'test-only-key';
    await withServer(async (base) => {
      process.env.NEAR_AI_MODEL = 'z-ai/test-model';
      const configured = await (await fetch(`${base}/api/status`)).json();
      assert.equal(configured.model, 'z-ai/test-model');
      assert.equal(configured.aiConfigured, true);
      process.env.NEAR_AI_MODEL = 'https://invalid.example/?secret=test-only-key';
      const rejected = await (await fetch(`${base}/api/status`)).json();
      assert.equal(rejected.model, 'unconfigured');
      assert.equal(rejected.aiConfigured, false);
      assert.doesNotMatch(JSON.stringify(rejected), /invalid\.example|test-only-key/);
      delete process.env.NEAR_AI_MODEL;
      const fallback = await (await fetch(`${base}/api/status`)).json();
      assert.equal(fallback.model, 'z-ai/glm-5.3-flash');
    }, offline);
  } finally {
    if (previous.model === undefined) delete process.env.NEAR_AI_MODEL; else process.env.NEAR_AI_MODEL = previous.model;
    if (previous.key === undefined) delete process.env.NEAR_AI_API_KEY; else process.env.NEAR_AI_API_KEY = previous.key;
  }
});
