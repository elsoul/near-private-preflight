# NEAR inference and verification

Private Preflight uses `@nearai/inference-sdk` 0.3.0 through its Node entry point. It requires Node 24.22.1 or newer. The default canonical model is `z-ai/glm-5.3-flash`, listed by NEAR as a Private TEE model and used in its current JavaScript example. Set `NEAR_AI_API_KEY` on the server; `NEAR_AI_MODEL` can select another supported canonical NEAR Confidential TEE model. There is no plaintext or Incognito fallback.

## What the application checks

1. The destination is fixed to `https://cloud-api.near.ai/v1`.
2. Before sending the instruction, the official SDK verifies Gateway TLS binding and all returned model attestations. The application requires model evidence, `UpToDate` Intel TCB status and GPU evidence.
3. The SDK encrypts supported Chat fields to the attested model key (`e2ee: true`). The request uses the canonical model and disables aliasing.
4. After inference, the SDK verifies the response signature against its captured exact request and response bytes and its retained preflight evidence.
5. The application labels a response `verified` only when the SDK returns a `provider_tee` receipt with model attestations. A Gateway-only receipt is explicitly `unverified`. Verification failure withholds the model output.

The application never creates an attestation verifier that accepts arbitrary quotes, overrides signature verification or treats an HTTP success as verification. Tests replace the SDK boundary to exercise application behavior; they do not establish that a real TEE or live inference has been verified.

## Data boundary

The inference payload contains demo recipient aliases, numeric amounts, the instruction, policy check IDs/booleans, and the simulation status. RPC logs, raw transactions, account addresses, policy detail strings and credentials are excluded. Instructions containing recognizable wallet addresses, email addresses, URLs, IPv4 addresses or key assignments are refused before contacting NEAR. This pattern check is a narrow demo safeguard, not a general personal-data detector: use only fictional demo instructions.

The instruction is untrusted data in a JSON record. The model has no tools, signer or transaction sender, and its output does not change the policy result. Public blockchain data and ERPC requests are not made confidential by this integration. E2EE protects supported prompt fields between this application server and the model; the browser and application server necessarily see the user's input.

## Limits

- Hardware and response-signature verification does not prove that an explanation is correct or a transaction is safe.
- There is no application-maintained allowlist of model image measurements or reproducible-build provenance. SDK attestation checks authenticate the supplied measured environment; they do not constitute an independent source-code audit.
- A model's instances can share a signing key. The receipt does not prove the exact serving instance or a complete model-to-Gateway-to-final-response provenance chain.
- A 45-second application deadline bounds the request. Inference receives an abort signal and SDK retries are disabled. The SDK does not expose cancellation for its attestation or signature helper: an already-started evidence request can finish after timeout, but no subsequent inference step is started and no late answer is accepted. Response records are cleared after each request.
- API errors and SDK errors are replaced by fixed messages so headers, input text and raw responses cannot appear in error output.
- No live verification result is implied by having installed the SDK or passed unit tests. The UI reports the result for each request.

## Official references checked 2026-11-11

- [JavaScript SDK and E2EE](https://docs.near.ai/cloud/inference-sdk/javascript)
- [Current model catalog](https://near.ai/models)
- [Privacy tiers](https://docs.near.ai/cloud/models)
- [Gateway attestation](https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation)
- [Model attestation](https://docs.near.ai/cloud/verification/cloud-api/model-attestations)
- [Response signatures and their limits](https://docs.near.ai/cloud/verification/cloud-api/response-signatures)
