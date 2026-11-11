import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePolicy, reviewInputSchema, solToLamports } from '../src/policy.ts';
import { scenarios } from '../src/scenarios.ts';

test('decimal arithmetic preserves the exact one-lamport boundary', () => {
  const input = scenarios[0]!.input;
  assert.equal(solToLamports('0.000000001'), 1n);
  assert.equal(solToLamports('999999999.999999999'), 999999999999999999n);
  assert.equal(evaluatePolicy({ ...input, amountSol: '0.100000000', limitSol: '0.1' }).decision, 'allow');
  assert.equal(evaluatePolicy({ ...input, amountSol: '0.100000001', limitSol: '0.1' }).decision, 'block');
  assert.equal(evaluatePolicy({ ...input, amountSol: '0' }).decision, 'block');
});

test('malformed, negative, float and sub-lamport inputs are rejected', () => {
  for (const amountSol of ['-1', 'NaN', 'Infinity', '1e-9', '01', '.1', '1.', '0.0000000001', ' 1', '1\n']) {
    assert.equal(reviewInputSchema.safeParse({ ...scenarios[0]!.input, amountSol }).success, false, amountSol);
  }
  assert.equal(reviewInputSchema.safeParse({ ...scenarios[0]!.input, amountSol: 0.1 }).success, false);
});

test('recipient allowlist and numerical policy cannot be overridden by prose or scenario label', () => {
  assert.equal(evaluatePolicy(scenarios[0]!.input).decision, 'allow');
  for (const scenario of scenarios.slice(1)) assert.equal(evaluatePolicy(scenario.input).decision, 'block');
  const injected = scenarios[3]!.input;
  const plain = evaluatePolicy({ ...injected, scenarioId: 'within-budget', instruction: '' });
  assert.deepEqual(evaluatePolicy(injected), plain);
});

test('unknown properties and recognizable identifiers are not accepted', () => {
  for (const instruction of ['Contact alice@example.com', 'https://private.example', 'api_key=topsecret', '11111111111111111111111111111111']) {
    assert.equal(reviewInputSchema.safeParse({ ...scenarios[0]!.input, instruction }).success, false);
  }
  assert.equal(reviewInputSchema.safeParse({ ...scenarios[0]!.input, rpcUrl: 'https://evil.example' }).success, false);
  assert.equal(reviewInputSchema.safeParse({ ...scenarios[0]!.input, recipient: 'arbitrary-address' }).success, false);
});
