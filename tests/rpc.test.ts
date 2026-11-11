import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulator, ERPC_TESTNET_URL, TESTNET_GENESIS_HASH } from '../src/rpc.ts';
import { scenarios } from '../src/scenarios.ts';

const GENESIS = TESTNET_GENESIS_HASH;
const BLOCKHASH = '11111111111111111111111111111111';
type Call = { url: string; method: string; params: unknown[]; init: RequestInit };
function fixture(results: unknown[]) {
  const calls: Call[] = [];
  const mockFetch = (async (url: string | URL | Request, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    calls.push({ url: String(url), method: body.method, params: body.params, init });
    return Response.json({ jsonrpc: '2.0', id: body.id, result: results[calls.length - 1] });
  }) as typeof fetch;
  return { calls, run: createSimulator({ fetch: mockFetch, env: { ERPC_RPC_KEY: 'test-only-key' } }) };
}
const latest = { context: { slot: 100 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 200 } };

test('real RPC schema yields an unsigned v1 simulation with no send method or raw account output', async () => {
  const f = fixture([GENESIS, latest, { context: { slot: 101 }, value: { err: null, unitsConsumed: 150, logs: ['sensitive raw program text'] } }]);
  const result = await f.run(scenarios[0]!.input);
  assert.equal(result.status, 'passed');
  assert.equal(result.unitsConsumed, 150);
  assert.equal(result.transactionVersion, 1);
  assert.deepEqual(f.calls.map((call) => call.method), ['getGenesisHash', 'getLatestBlockhash', 'simulateTransaction']);
  for (const call of f.calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, ERPC_TESTNET_URL);
    assert.equal(url.pathname, '/');
    assert.deepEqual([...url.searchParams], [['api-key', 'test-only-key']]);
    assert.equal(call.init.redirect, 'error');
    assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json' });
  }
  const wire = Buffer.from(f.calls[2]!.params[0] as string, 'base64');
  assert.equal(wire[0], 0x81);
  assert.ok(wire.subarray(-64).every((byte) => byte === 0), 'required signature remains all zeroes');
  assert.deepEqual(f.calls[2]!.params[1], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', minContextSlot: 100 });
  assert.doesNotMatch(JSON.stringify(result), /test-only-key|sensitive raw|11111111111111111111111111111111/);
});

test('a wrong network stops before blockhash lookup or simulation', async () => {
  for (const genesis of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', `${GENESIS.slice(0, -1)}Z`]) {
    const f = fixture([genesis]);
    assert.equal((await f.run(scenarios[0]!.input)).status, 'unavailable');
    assert.equal(f.calls.length, 1);
  }
});

test('malformed response cannot become a successful simulation', async () => {
  for (const bad of [null, {}, { context: { slot: 1 }, value: {} }, { context: { slot: -1 }, value: { err: null } }, { context: { slot: 1 }, value: { err: false } }]) {
    const f = fixture([GENESIS, latest, bad]);
    assert.equal((await f.run(scenarios[0]!.input)).status, 'unavailable');
  }
  const f = fixture([GENESIS, latest, { context: { slot: 101 }, value: { err: { InstructionError: [0, 'Custom'] }, unitsConsumed: 0 } }]);
  assert.equal((await f.run(scenarios[0]!.input)).status, 'failed');
});

test('blocked requests and missing credentials do not touch the transport', async () => {
  let calls = 0;
  const transport = (async () => { calls++; throw new Error('must not run'); }) as typeof fetch;
  const simulate = createSimulator({ fetch: transport, env: {} });
  assert.equal((await simulate(scenarios[0]!.input)).status, 'unavailable');
  assert.equal((await simulate(scenarios[3]!.input)).status, 'not-run');
  assert.equal(calls, 0);
});

test('timeouts and RPC errors are sanitized', async () => {
  const simulate = createSimulator({ env: { ERPC_RPC_KEY: 'test-only-key' }, timeoutMs: 5,
    fetch: ((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('private provider secret')), { once: true });
    })) as typeof fetch });
  const result = await simulate(scenarios[0]!.input);
  assert.equal(result.status, 'unavailable');
  assert.match(result.detail, /timed out/);
  assert.doesNotMatch(result.detail, /private provider secret|test-only-key/);
});

test('a mismatched JSON-RPC envelope and oversized response are not trusted', async () => {
  for (const makeResponse of [
    () => Response.json({ jsonrpc: '2.0', id: 99, result: GENESIS }),
    () => Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'private provider body' } }),
    () => new Response('x'.repeat(256 * 1_024 + 1)),
  ]) {
    const simulate = createSimulator({ env: { ERPC_RPC_KEY: 'test-only-key' }, fetch: (async () => makeResponse()) as typeof fetch });
    const result = await simulate(scenarios[0]!.input);
    assert.equal(result.status, 'unavailable');
    assert.doesNotMatch(result.detail, /private provider body|test-only-key/);
  }
});

test('transport errors containing authenticated URLs never leave the RPC adapter', async () => {
  const simulate = createSimulator({ env: { ERPC_RPC_KEY: 'test-only-key' }, fetch: (async (url) => {
    throw new Error(`Failed to fetch ${String(url)}`);
  }) as typeof fetch });
  const result = await simulate(scenarios[0]!.input);
  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /api-key|test-only-key|testnet\.erpc\.global|https:/);
});
