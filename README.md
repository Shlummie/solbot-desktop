# Solbot Desktop

An Electron/React control room for managing one main Solana wallet and multiple side wallets, inspecting balances/RPC health, preparing randomized funding, submitting Pump Portal or Jupiter trades, running a scheduler, and sweeping assets back to the main wallet.

This is high-risk experimental software. Public builds start in **dry-run mode**, which blocks funding, trade, and sweep submissions at the service boundary. Live mode is an explicit setting and can irreversibly transfer or lose assets.

## Features

- Create/import/export Solana keypairs and assign main/side roles.
- Inspect balances and configured token accounts.
- Configure funding ranges, concurrency, QPS, jitter, fees, and token mints.
- Try Pump Portal transaction construction first and Jupiter as a fallback.
- Run a randomized buy/sell automation loop across selected wallets.
- Sweep selected tokens and SOL from side wallets to the main wallet.
- Inspect RPC endpoint latency, failures, throttling, and recent activity.
- Package a Windows desktop application with Electron Builder.

## Safety architecture

```text
React UI -> typed preload/IPC -> service operation -> execution-mode gate
                                              dry-run -> reject before signing/submission
                                              live    -> wallet + RPC + external trade APIs
```

`assertLiveExecution` is called at the entry points for funding, trading, and sweeping. The committed configuration defaults to `executionMode: "dry-run"`. Keep this gate intact and add tests for every new write path.

Dry-run currently means **blocked execution**, not simulated fills or projected balances. Read-only RPC calls such as balance and health checks may still contact configured endpoints.

## Install and verify

Requirements: Node.js 20+ and npm 10+.

```bash
npm install
npm run typecheck
npm test -- --run
npm run build
npm run dev
```

Create a packaged build with `npm run dist`. Build artifacts are ignored.

## Configuration

On first run, the app writes validated defaults to local `config.json`; that file is ignored. `config.example.json` shows the public baseline.

Important sections:

- `executionMode` - `dry-run` or `live`.
- `rpc` - primary/fallback Solana RPC endpoints.
- `mainWalletPath`, `walletsDir` - key storage.
- `funding` - random transfer range and rent buffer.
- `trade` - token mints, size range, slippage, and priority-fee cap.
- `limits` - concurrency, QPS, jitter, and scheduler cycle.
- `logging` - level, JSON output, and optional file.

No private RPC endpoint, wallet, mint list, or local config is included.

## Wallet and transaction risks

- Keys use unencrypted Solana-keygen JSON. Anyone who can read a wallet file can control its funds. Use disposable test wallets, encrypted storage outside this project, strict filesystem permissions, offline backups, and minimal balances.
- Devnet is the default endpoint. Changing the RPC to mainnet and selecting live mode can submit irreversible mainnet transactions.
- Pump Portal and Jupiter are external services with changing APIs, availability, routing, and terms.
- The code has not received an independent security audit. Slippage floors, priority fees, token programs, account creation, transaction confirmation, retries, and partial failures require adversarial review.
- Automation can amplify configuration errors across many wallets. Test kill switches and stop behavior before live use.
- Token prices, liquidity, taxes, transfer restrictions, malicious mints, MEV, failed transactions, and RPC inconsistency can cause losses.

Do not use this repository to evade platform rules, manipulate markets, create deceptive activity, or control assets you do not own.

## Development checklist for live changes

1. Preserve a single auditable execution gate for every signing/submission path.
2. Add dry-run rejection and explicit live-mode tests.
3. Test against a non-production cluster or disposable assets when an integration supports it.
4. Log intent and result without logging secret keys.
5. Handle ambiguous transaction status and idempotency before retrying.
6. Review dependency and external endpoint changes.

## Dependency audit snapshot

At the 2026-08-12 publication-prep snapshot, all compatible application and build-tool fixes have been applied, including Electron 43.4, Electron Builder 26.15, Vite 7.3, Vitest 3.2, and patched WebSocket transitive versions. A full `npm audit` reports eight affected-package entries (three high and five moderate), all propagated from two unresolved legacy Solana SDK findings: `bigint-buffer` (`GHSA-3gc7-fjrx-p6mg`) and `uuid` (`GHSA-w5hq-g745-h8pq`). The former has no patched package release, and the latter sits behind `jayson`; removing them safely requires a tested migration away from the legacy Solana Web3.js v1 dependency chain. Do not use `npm audit fix --force`, which proposes incompatible historical package downgrades. Re-run the audit before any live use.

## License and disclaimer

Original source is MIT licensed. Solana, Pump Portal, Jupiter, Electron, React, and dependencies retain their own terms. This is not financial advice, a custody service, or a guarantee of transaction safety.
