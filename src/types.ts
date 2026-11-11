export type ScenarioId = 'within-budget' | 'over-budget' | 'unknown-recipient' | 'injected-request';
export interface ReviewInput {
  scenarioId: ScenarioId;
  amountSol: string;
  limitSol: string;
  recipient: 'demo-vendor' | 'unknown-vendor';
  instruction: string;
}
export interface PolicyCheck { id: string; label: string; passed: boolean; detail: string }
export interface PolicyResult { decision: 'allow' | 'block'; checks: PolicyCheck[] }
export interface SimulationResult {
  status: 'passed' | 'failed' | 'unavailable' | 'not-run';
  network: 'solana-testnet';
  provider: 'ERPC';
  slot?: number;
  unitsConsumed?: number;
  detail: string;
  transactionVersion?: number;
}
export interface ExplanationResult {
  status: 'complete' | 'unavailable';
  text: string;
  model: string;
  verification: {
    status: 'verified' | 'unverified' | 'unavailable';
    detail: string;
    responseId?: string;
    signer?: string;
  };
}
export interface ReviewResult {
  id: string;
  reviewedAt: string;
  input: ReviewInput;
  policy: PolicyResult;
  simulation: SimulationResult;
  explanation: ExplanationResult;
  mode: 'live' | 'offline';
}
