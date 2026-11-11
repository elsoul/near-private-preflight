import {
  AccountRole, address, appendTransactionMessageInstruction, blockhash, compileTransaction,
  createTransactionMessage, getAddressDecoder, getBase64EncodedWireTransaction, pipe,
  setTransactionMessageConfig, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { z } from 'zod';
import { evaluatePolicy, solToLamports } from './policy.ts';
import type { ReviewInput, SimulationResult } from './types.ts';

export const ERPC_TESTNET_URL = 'https://testnet.erpc.global';
// Pin the complete testnet genesis hash, confirmed through ERPC during integration.
// Its first 32 characters match https://namespaces.chainagnostic.org/solana/caip2.
export const TESTNET_GENESIS_HASH = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';
// Public-only fixtures. No signer, seed phrase or private key is created or loaded.
export const DEMO_SENDER = getAddressDecoder().decode(new Uint8Array(32).fill(3));
const DEMO_RECIPIENT = getAddressDecoder().decode(new Uint8Array(32).fill(4));
const NETWORK = { network: 'solana-testnet', provider: 'ERPC' } as const;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const context = z.object({ slot: integer });
const latestSchema = z.object({ context, value: z.object({ blockhash: z.string(), lastValidBlockHeight: integer }) });
const simulationSchema = z.object({ context, value: z.object({
  err: z.union([z.null(), z.string().max(1_024), z.record(z.string(), z.unknown())]),
  unitsConsumed: integer.max(1_400_000).optional(),
}) });

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('RPC unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 256 * 1_024) throw new Error('RPC response exceeds limit.');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface SimulatorOptions {
  fetch?: typeof fetch;
  env?: Pick<NodeJS.ProcessEnv, 'ERPC_RPC_KEY' | 'SOLANA_TESTNET_SENDER'>;
  timeoutMs?: number;
}

export function createSimulator(options: SimulatorOptions = {}) {
  const transport = options.fetch ?? fetch;
  return async (input: ReviewInput): Promise<SimulationResult> => {
    if (evaluatePolicy(input).decision !== 'allow') {
      return { ...NETWORK, status: 'not-run', detail: 'The deterministic policy blocked this request. No RPC simulation was requested.' };
    }
    const env = options.env ?? process.env;
    const key = env.ERPC_RPC_KEY?.trim();
    if (!key) return { ...NETWORK, status: 'unavailable', detail: 'ERPC is not configured; no simulation request was sent.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let requestId = 0;
    const rpc = async (method: 'getGenesisHash' | 'getLatestBlockhash' | 'simulateTransaction', params: unknown[]) => {
      const id = ++requestId;
      // ERPC authenticates this endpoint through api-key. This server-only URL is
      // never returned to the browser, persisted, or included in an error log.
      const url = new URL(ERPC_TESTNET_URL);
      url.searchParams.set('api-key', key);
      const response = await transport(url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      const body = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(id), result: z.unknown(), error: z.unknown().optional() }).parse(await boundedJson(response));
      if (body.error !== undefined || body.result === undefined) throw new Error('RPC rejected request.');
      return body.result;
    };
    try {
      const sender = address(env.SOLANA_TESTNET_SENDER?.trim() || DEMO_SENDER);
      const genesis = await rpc('getGenesisHash', []);
      if (genesis !== TESTNET_GENESIS_HASH) {
        return { ...NETWORK, status: 'unavailable', detail: 'The RPC did not identify as Solana testnet. Simulation was refused.' };
      }
      blockhash(genesis);
      const latest = latestSchema.parse(await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]));
      const data = Buffer.alloc(12);
      data.writeUInt32LE(2, 0); // SystemProgram::Transfer
      data.writeBigUInt64LE(solToLamports(input.amountSol), 4);
      const message = pipe(
        createTransactionMessage({ version: 1 }),
        (tx) => setTransactionMessageFeePayer(sender, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash({
          blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
        }, tx),
        (tx) => appendTransactionMessageInstruction({ programAddress: address('11111111111111111111111111111111'),
          accounts: [{ address: sender, role: AccountRole.WRITABLE_SIGNER }, { address: DEMO_RECIPIENT, role: AccountRole.WRITABLE }], data }, tx),
        // Deliberate maximum caps for simulation only. We report measured units below;
        // these are not production resource estimates and no transaction is broadcast.
        (tx) => setTransactionMessageConfig({ computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1_024 * 1_024, priorityFeeLamports: 0n }, tx),
      );
      const transaction = compileTransaction(message); // All required signatures remain null.
      const result = simulationSchema.parse(await rpc('simulateTransaction', [getBase64EncodedWireTransaction(transaction), {
        encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
        minContextSlot: latest.context.slot,
      }]));
      if (result.context.slot < latest.context.slot) throw new Error('RPC context moved backwards.');
      return { ...NETWORK, status: result.value.err === null ? 'passed' : 'failed',
        slot: result.context.slot, unitsConsumed: result.value.unitsConsumed, transactionVersion: 1,
        detail: result.value.err === null
          ? 'ERPC simulated an unsigned native SOL transfer on verified Solana testnet. No transaction was signed or sent.'
          : 'ERPC reported a simulation failure. Check the test-only sender funding and RPC compatibility. No transaction was signed or sent.',
      };
    } catch {
      // Never expose RPC bodies, logs, headers, account addresses or credentials.
      return { ...NETWORK, status: 'unavailable', detail: controller.signal.aborted
        ? 'ERPC simulation timed out. No result is marked successful.'
        : 'ERPC simulation was unavailable or returned an invalid response. No result is marked successful.' };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

export const simulateTransfer = createSimulator();
