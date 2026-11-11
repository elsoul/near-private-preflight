import { z } from 'zod';
import type { PolicyResult, ReviewInput } from './types.ts';

const SOL_AMOUNT = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,9})?$/;
// Demo-only boundary: do not accept account identifiers or credentials in prose.
const IDENTIFIER = /(?:\b0x[a-f\d]{40,}\b|\b[1-9A-HJ-NP-Za-km-z]{32,}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:api[-_ ]?key|private[-_ ]?key|password|bearer)\s*[:=]\s*\S+)/i;

export const reviewInputSchema = z.object({
  scenarioId: z.enum(['within-budget', 'over-budget', 'unknown-recipient', 'injected-request']),
  amountSol: z.string().regex(SOL_AMOUNT),
  limitSol: z.string().regex(SOL_AMOUNT),
  recipient: z.enum(['demo-vendor', 'unknown-vendor']),
  instruction: z.string().max(1_000).refine((value) => !IDENTIFIER.test(value)),
}).strict();

/** Exact decimal conversion. Reject scientific notation, negatives and sub-lamport amounts. */
export function solToLamports(value: string): bigint {
  if (!SOL_AMOUNT.test(value)) throw new Error('Invalid SOL decimal.');
  const [whole, fractional = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000_000n + BigInt(fractional.padEnd(9, '0'));
}

/** This is a user-selected demo policy, not signing authority or a custodial limit. */
export function evaluatePolicy(input: ReviewInput): PolicyResult {
  const valid = reviewInputSchema.parse(input);
  const amount = solToLamports(valid.amountSol);
  const limit = solToLamports(valid.limitSol);
  const checks = [
    { id: 'positive-amount', label: 'Positive transfer', passed: amount > 0n,
      detail: 'The amount must be at least one lamport.' },
    { id: 'amount-limit', label: 'Within demo budget', passed: amount <= limit,
      detail: 'Amount and limit are compared as integer lamports; fees are not included in this demo limit.' },
    { id: 'recipient-allowlist', label: 'Known demo recipient', passed: valid.recipient === 'demo-vendor',
      detail: 'Only the demo-vendor alias is allowlisted.' },
    { id: 'instruction-is-data', label: 'Prose cannot override policy', passed: true,
      detail: 'Instructions are explanatory data. They never change the amount, limit or allowlist.' },
  ];
  return { decision: checks.every((check) => check.passed) ? 'allow' : 'block', checks };
}
