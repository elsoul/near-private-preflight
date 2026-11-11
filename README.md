# Private Preflight

**Know what you approve.** Explain a proposed SOL transfer privately, compare it with an explicit spending policy, and simulate it on Solana testnet before any wallet signature.

Built for **NEAR HACKATHON 2026**, targeting **Privacy & Private AI** and **AI Security & Defense**. This is a new prototype built during the hackathon window. It uses NEAR AI Cloud as its private explanation engine and ERPC as its only blockchain RPC provider.

**[Watch the 95.9-second demo](https://youtu.be/Fgn99nVjG_A).** It shows actual NEAR-verified responses and ERPC testnet simulation, followed by over-budget and prompt-injection examples. Long provider waits are shortened where labeled. [Validation record](docs/validation.md).

## Try it

Requires Node.js **24.22.1+** and npm. The application runs locally; judges do not need a hosted service or a wallet extension.

```sh
npm ci
cp .env.example .env
# Add your NEAR AI Cloud key and ERPC RPC key.
npm run prepare-testnet
npm run dev
```

Open `http://localhost:4173`.

1. Select **Within budget** and run the review. The deterministic policy allows the proposed transfer. With the live services configured, the app also requests an unsigned ERPC simulation and a private NEAR AI explanation.
2. Select **Over budget** and review again. The amount exceeds the explicit limit, so the policy blocks it.
3. Select **Unknown recipient**. The recipient is outside the allowed demo alias.
4. Select **Injected request**. The request asks the AI to ignore the policy, but the numeric rule still blocks the transfer. Natural-language instructions do not change the rule engine.

Without keys, the policy checks work locally and external services are clearly shown as unavailable. Offline operation is **not** a substitute for the NEAR integration and does not fabricate AI text, chain slots, or attestation evidence.

```sh
npm test
npm run typecheck
npm run build
npm start
```

## What NEAR enables

The application uses the official `@nearai/inference-sdk` in **E2EE mode** through NEAR AI Cloud. It verifies hardware evidence before submitting the explanation prompt, and verifies the returned response. Only a successful model/provider TEE verification receives the corresponding verified label. Gateway-only evidence is not represented as model verification.

The default model is `z-ai/glm-5.3-flash`. Use a compatible **Confidential TEE** model; an Incognito model does not provide the same model-level privacy. Requests contain demo aliases, the proposed amount, the explicit limit and the instruction, rather than raw wallet addresses or RPC logs.

The local application receives the input in plaintext before encrypting it for inference. Its operator and the user's device are part of the trust boundary. It does not make public blockchain transactions private. See [verification scope](docs/near-verification.md) for exactly what is checked and what is not.

Official documentation: [JavaScript SDK](https://docs.near.ai/cloud/inference-sdk/javascript), [privacy tiers](https://docs.near.ai/cloud/models), [verification](https://docs.near.ai/cloud/verification).

## How ERPC is used

The only blockchain endpoint is ERPC's **Solana testnet** endpoint, `https://testnet.erpc.global`. It is the separate testnet host, not the multichain mainnet host `edge.erpc.global`. The app never substitutes another provider or a mainnet endpoint.

An `ERPC_RPC_KEY` is injected on the server. The application constructs an **unsigned v1 native SOL transfer** and uses `simulateTransaction` with signature verification disabled and recent-blockhash replacement enabled. It never calls a transaction broadcast method. Results reflect the state observed by the testnet RPC; a successful simulation is not a guarantee of future execution.

`npm run prepare-testnet` selects a funded public system account from **Solana testnet** through ERPC and saves only its public address to ignored `.env.testnet`. This is a read-only simulation fixture: the app has no signing authority over that account and cannot move its funds. No airdrop or wallet is required. Alternatively, set `SOLANA_TESTNET_SENDER` to your own funded disposable testnet account. If preparation is skipped, the fixed empty fixture will normally fail simulation; this is reported as failure, never as a successful result.

This testnet endpoint requires its RPC key in the `api-key` query parameter. The server constructs that authenticated URL in memory; it is never returned to the browser or logged. Do not enable HTTP debug logging or expose the server's process environment. A funded fixture may change or disappear after a testnet reset; rerun preparation if needed.

ERPC documents [testnet/devnet availability](https://erpc.global/en/news/2025/10/13/erpc-solana-firedancer-devnet-testnet-rpc/) and [Edge RPC](https://erpc.global/en/doc/rpc/edge/). Solana documents [unsigned simulation](https://solana.com/docs/rpc/http/simulatetransaction).

## Scope and privacy

- Native SOL transfer proposals only, using a small, explicit demo-recipient set. This is not a general transaction decoder or a wallet.
- The spending limit is a rule supplied by the person using this local prototype. It is an advisory preflight result, not a smart-contract spending restriction, delegated authority, or protection for a separately operated wallet.
- Code, not the LLM, compares amounts and recipient permissions. A plausible AI explanation cannot override the policy outcome.
- No signature, broadcast, mainnet funds, database, telemetry, or server-side review history.
- The server binds to loopback and checks Host/Origin. It is not a hardened public multi-user service.
- UI evidence omits raw wallet addresses, balances, signer identities, request IDs and secrets. Camera-safe examples are fictional.
- Input and results remain in the open page until it is closed or reloaded. The local app and inference providers are still part of the documented threat model.
- Environment variables contain credentials; `.env.example` contains placeholders only. Do not put a key in browser code, URLs, a recording, or Git history.

## Development and third-party work

This repository was created for the hackathon. AI-assisted implementation was used. Third-party dependencies are recorded in `package-lock.json`, principally Solana Kit, NEAR AI's official inference SDK, Zod and TypeScript; their authors retain their own licenses. No existing application code is claimed as new work.

The unit tests isolate external services and verify the application's decision and failure behavior. They do not constitute an independent audit of NEAR's TEE cryptography. Live validation results and demo links are recorded separately when available.

License: [MIT](LICENSE).
