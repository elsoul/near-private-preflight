# Validation record

Validated on 2026-11-11 during development, on Node.js 26.12.1. These are observations, not performance guarantees or a security certification.

## Local checks

- 26 tests passed: exact lamport boundaries, invalid inputs, prompt injection independence, unavailable providers, wrong network, malformed and oversized RPC data, unsigned v1 serialization, credential-error redaction, localhost/Origin checks, request limits and configured-port/model validation.
- TypeScript typecheck and production build passed.
- The public testnet fixture preparation command completed through ERPC. It selects existing public account state and creates no key, signature or transaction.
- Desktop (1920×1080) and mobile (390×844) layouts were inspected.

## Real service observations

- ERPC testnet accepted the RPC key in the `api-key` query parameter. Bearer-header authentication was rejected by this particular endpoint, so the adapter uses the required query form internally without logging it.
- `getGenesisHash` returned Solana testnet's full genesis hash. Mainnet and unrecognized networks are rejected.
- An unsigned native SOL v1 transfer simulation passed at slot **463208185**, consuming **150 compute units** in that observation. No transaction was signed or broadcast. The simulator had no signing authority over the public testnet account used as its fixture.
- The official NEAR AI SDK verified model evidence for `z-ai/glm-5.3-flash`, completed encrypted inference and verified a `provider_tee` reply signature. Gateway-only evidence would not receive the model-verified label.
- The narration has seven independently generated scene files. Speech-to-text comparison matched the script after normalizing case, punctuation and spacing.

## Demo artifact

- [Public video](https://youtu.be/Fgn99nVjG_A): **95.900 seconds** by ffprobe, 1920×1080, 30 fps, H.264/yuv420p/limited range, AAC audio. Audio duration is 95.867 seconds (one video-frame difference).
- File size: 5,929,966 bytes. SHA-256: `ac677578eb46f1ca4ea6e93b27b4cde2f9943ab24981e8bd1c7e6f4c433b8831`.
- 609 changed frames extracted with `mpdecimate` were visually reviewed across contact sheets; significant text/state transitions were also inspected at original resolution. No personal information, credentials, wallet addresses, IPs or account balances were found. OCR over all 609 frames also found no identifier-pattern matches.
- The allowance, over-budget and injection scenes show actual provider results. Three provider wait spans are shortened and labeled; the video makes no response-time claim.
- The first GitHub Checks run was blocked before execution by the organization's action-SHA policy. Actions were then pinned to release commit SHAs; [Checks passed](https://github.com/elsoul/near-private-preflight/actions/runs/42994138843), including install, tests, typecheck and build. CodeQL also passed on that source revision.

## Dependency limitation

`npm audit --omit=dev` currently reports one unresolved low-severity advisory in the transitive `elliptic` dependency, also attributed to `@phala/dcap-qvl` and `@nearai/inference-sdk`. The registry reports no available fix. The application uses the official verifier; it does not claim an independent cryptographic audit. The direct Zod dependency was updated to a version outside the reported affected range.

Full verification scope: [NEAR verification](near-verification.md).
