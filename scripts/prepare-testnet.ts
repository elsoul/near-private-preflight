import { writeFile } from 'node:fs/promises';
import { address } from '@solana/kit';
import { z } from 'zod';
import { ERPC_TESTNET_URL, TESTNET_GENESIS_HASH } from '../src/rpc.ts';

// Select public testnet state for unsigned simulation. This never creates a key,
// asks for an airdrop, signs, broadcasts, or acquires control of the account.
const key = process.env.ERPC_RPC_KEY?.trim();
if (!key) throw new Error('Set ERPC_RPC_KEY in the environment first.');
const url = new URL(ERPC_TESTNET_URL);
url.searchParams.set('api-key', key);
let id = 0;
async function rpc(method: string, params: unknown[]) {
  const requestId = ++id;
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
  });
  if (!response.ok) throw new Error('ERPC preparation request failed.');
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Unexpected RPC response size.');
  const result = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(requestId), result: z.unknown(), error: z.unknown().optional() }).parse(JSON.parse(text));
  if (result.error !== undefined || result.result === undefined) throw new Error('ERPC preparation request failed.');
  return result.result;
}

try {
  if (await rpc('getGenesisHash', []) !== TESTNET_GENESIS_HASH) throw new Error('Wrong network.');
  const votes = z.object({ current: z.array(z.object({ nodePubkey: z.string() })).max(10_000) }).parse(
    await rpc('getVoteAccounts', [{ commitment: 'confirmed', keepUnstakedDelinquents: false }]),
  );
  let sender: string | undefined;
  for (const candidate of votes.current.slice(0, 5)) {
    const pubkey = address(candidate.nodePubkey);
    const account = z.object({ value: z.object({ owner: z.string(), executable: z.boolean(), lamports: z.number().nonnegative(), data: z.tuple([z.string(), z.literal('base64')]) }).nullable() }).parse(
      await rpc('getAccountInfo', [pubkey, { encoding: 'base64', commitment: 'confirmed' }]),
    ).value;
    if (account?.owner === '11111111111111111111111111111111' && !account.executable && account.data[0] === '' && account.lamports > 100_000_000) {
      sender = pubkey;
      break;
    }
  }
  if (!sender) throw new Error('No suitable public simulation fixture in this sample.');
  await writeFile(new URL('../.env.testnet', import.meta.url),
    '# Public Solana testnet fixture for unsigned simulation only. No signing authority.\n' +
    `SOLANA_TESTNET_SENDER=${sender}\n`, { mode: 0o600 });
  console.log('Public testnet simulation fixture saved to ignored .env.testnet. No key, signature or transaction was created.');
} catch {
  // Avoid exposing authenticated request URLs, raw responses or public identifiers.
  console.error('Testnet preparation could not complete. Check ERPC availability and try again, or set a funded disposable testnet public address manually.');
  process.exitCode = 1;
}
