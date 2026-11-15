# Noxicon

**Check an inference report before accepting its claim.** Noxicon introduces the evidence workflow on its homepage. The dedicated verifier at `/verify` contains a genuine historical Groq report, an explicit read-only NEAR Testnet publication check, and an offline experiment showing how changing a model or timing breaks the commitment. Creating new benchmark reports remains a secondary workflow at `/app`.

The verifier requires no inference or signing credentials. Click **Verify on NEAR** to query the fixed archival Testnet RPC. Changing the demonstration copy stays in the browser and does not upload or publish it. Local digest equality is shown separately from live transaction verification. This checks integrity and account attribution—not honest measurements or model execution.

The dedicated `/api/demo/verify` POST endpoint accepts no body, query parameters, RPC URL, account or transaction selection. It requires same-origin browser requests, permits one in-flight check and four checks per minute per process, uses the unchanged verifier with pinned historical inputs, and never invokes signing. Existing authenticated proof endpoints remain protected. The limit is not a distributed public-service quota; review hosting-level abuse protection before broad deployment.


**Measure AI inference. Carry the evidence. Check its public commitment.**

Noxicon is a local AI inference benchmarking application. It measures streamed requests, exports a structured JSON report, and lets a reader check that the report's evidence matches a commitment published by a known account on NEAR Testnet.

Developers evaluating an inference service need more than a screenshot of a latency number. Noxicon makes the workload, individual outcomes, token accounting and measurement definitions portable. NEAR gives other people a public reference against which to check the report's integrity. It does **not** certify that the measurements are honest or prove GPU/TEE execution.

## Quick start — no credentials or spending

Use **Node.js 24.22.1** and npm. With [nvm](https://github.com/nvm-sh/nvm) installed, run these commands from the cloned repository:

```sh
nvm install
nvm use
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3100
```

Open **http://localhost:3100/app**. Use `localhost` in the browser: this Next version normalizes route URLs to that host, and the strict Host/Origin checks reject a `127.0.0.1` browser origin. No environment file is required for evaluation. Choose **View sample report** for the explicitly synthetic sample, or **Import report** and select [`evidence/groq-report.json`](evidence/groq-report.json) for the genuine recorded Groq run. Inspect the request, timing definitions and evidence details, then export JSON. Importing a report performs local consistency checks; it does not call an inference provider or verify the blockchain.

The homepage at `/` introduces the product and links to the credential-free historical evidence check at `/verify`. The benchmark workspace at `/app` displays the configured provider and can create or import reports. Its publication status remains unchecked: a new benchmark does not automatically acquire the historical receipt. New-report publication and verification remain explicit operator workflows. Local report fingerprints in the workspace differ from the publication digest shown in the verifier. Neither interface proves model execution.

## Reproduce the real NEAR proof

After `npm ci`, run:

```sh
npm run verify:demo
```

This read-only command uses the included original report and receipt, independently expects publisher `veyra-proof.testnet`, queries public NEAR Testnet RPC, and checks finalized execution and the actual transaction actions. It needs **no API key, wallet, signing key, macOS Keychain, environment file or local proof journal**. It never publishes a transaction or runs inference.

Successful output includes `"verified": true`, `"status": "verified"` and `"code": "commitment_verified"`. Exit codes: `0` verified; `2` mismatch, failure, pending or unavailable RPC; `1` invalid command/file. Network access to `https://archival-rpc.testnet.near.org` is required. An RPC outage is reported as unavailable, not as successful verification; try this read-only command later if necessary.

| Genuine smoke-test evidence | Value |
| --- | --- |
| Provider / model | Groq / `qwen/qwen3.8-27b` |
| Recorded at | 2026-11-12 23:32 UTC |
| Measured requests | 1 successful request, no warm-ups, concurrency 1 |
| Total request latency | 356.053 ms |
| Time to first visible content | 235.584 ms |
| Completion usage | 32 provider-reported tokens; `finishReason: length` (truncated) |
| Run ID | `66a5cda1-ee54-4057-b9b5-3a2fb2ade78e` |
| Publisher / network | `veyra-proof.testnet` / NEAR Testnet |

**Evidence commitment (SHA-256):**

```text
7ba15a1cb551de64840d2748fd73f13c0ad8b32dce424429d404877dedc9545c
```

**Transaction:** [CHzwHrtoUYfPMj1uHrqNeNCBv2fLVht1mT3gQunQYurQ](https://testnet.nearblocks.io/txns/CHzwHrtoUYfPMj1uHrqNeNCBv2fLVht1mT3gQunQYurQ). The [report](evidence/groq-report.json) and [receipt](evidence/near-testnet-receipt.json) are unchanged copies of the successful run's artifacts. The report includes fixed public workload prompts, a completion identifier and timestamps; no provider credential or generated response text. This single request is a smoke test, **not a statistically significant model comparison**.

Reproduce the commitment entirely offline, without application imports or dependencies:

```sh
node scripts/reproduce-proof.mjs evidence/groq-report.json
```

The script assumes an already validated report. To also validate the report's schema and aggregate consistency, use:

```sh
npm run proof -- preview --report evidence/groq-report.json
```

### Explain an evidence change offline

Compare two exported reports without keys, RPC access or publication:

```sh
npm run proof:compare -- evidence/groq-report.json evidence/groq-report.json
```

Output includes both publication digests and `changedPaths` (JSON Pointer paths into committed evidence). Identical evidence returns `sameCommitment: true`, an empty path list and exit `0`. Comparing the original against the modified copy below returns `/config/model`, different digests and exit `2`. Invalid reports return exit `1`. Values such as prompts are not printed. This identifies changes; it does not establish which measurement is truthful or verify a transaction. Use `verify:demo` for the historical on-chain check.

### Demonstrate tamper detection

Create a copy with a changed model identifier; leave the original untouched:

```sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const report = JSON.parse(readFileSync('evidence/groq-report.json', 'utf8'));
report.config.model = 'modified/model';
const path = join(tmpdir(), 'veyra-tampered-report.json');
writeFileSync(path, JSON.stringify(report), { mode: 0o600 });
console.log(path);
JS
```

Use the printed path:

```sh
npm run verify:demo -- --report /path/printed/above/veyra-tampered-report.json
```

Expected: `verified: false`, `status: mismatch`, `code: report_mismatch`, exit `2`. This rejection occurs before any RPC request. Tests also cover modified timings with recomputed aggregates, request outcomes, wrong publishers/networks, missing commitments, failed transactions and RPC outages.

## What is implemented

- Real server-side model discovery and streaming inference adapters for Groq and NEAR AI Cloud, sharing one benchmark engine.
- Fixed workload, configurable bounded warm-ups/request counts/concurrency, cancellation and deadlines; no automatic inference retries or provider fallback.
- Per-request outcomes, latency, first-content timing, completion usage and successful-request P50/P95/mean.
- Strict v1/v2 report import/export and deterministic commitments; old report schemas and original hashes remain compatible.
- Explicit NEAR Testnet commitment publication, durable idempotency/spending reservations, and independent read-only verification.
- Mocked provider/signing/RPC tests; a genuine public report and receipt for credential-free verification.

## Architecture and measurement definitions

```text
Groq / NEAR AI Cloud
  → shared streaming benchmark engine
  → schema v2 report (workload + request observations + aggregates)
  → versioned canonical SHA-256 evidence commitment
  → explicit NEAR Testnet transaction
  → independent report + transaction verification
```

`src/lib/server/compute-*.ts` implements transports, scheduling and budgets. `src/lib/compute/` defines reports, validation, serialization and metrics. `src/lib/server/proof-*.ts` implements commitments, signing, journaling and verification. `src/cli/` exposes explicit operator commands and the read-only judge workflow.

Timing uses the runner's monotonic clock. Latency runs from dispatch through complete stream consumption, including the final usage data. “TTFT” is arrival of the first nonempty visible content chunk, not an observed GPU token. Throughput is provider-reported completion tokens divided by total request seconds; counts may include reasoning tokens. It is not raw GPU decoding speed. Schema v2 leaves absent usage unavailable rather than estimating it. Warm-ups, failed and skipped requests do not enter successful latency distributions; P50/P95 use nearest rank.

### Precisely what NEAR records

The transaction is self-addressed and contains **AddKey followed by DeleteKey** for the same temporary public key. Its zero-allowance FunctionCall permission carries four ordered method-name strings:

```text
veyra-benchmark-evidence:v1
sha256:<64 lowercase hex characters>
run:<report UUID>
network:testnet
```

These are Noxicon metadata fields, not contract calls. The temporary key is deleted in the same successful transaction. No custom contract, prompts, responses or signing secrets go on-chain. This minimal native-action record leaves the commitment independently retrievable from transaction history without storing the whole report.

Verification recalculates the digest, checks the expected account/network, queries finalized transaction data, requires successful overall and receipt outcomes, and compares the exact two actions and metadata. A stored hash or explorer URL alone is never verification. This is RPC-based verification, not a light-client inclusion proof. A match establishes that the expected account published this evidence commitment; it does not authenticate the benchmark runner, its clock, hardware or provider claims. Testnet can reset, and RPC availability/retention is external.

### Commitment format

The unchanged format is `veyra-benchmark-evidence`, version `1`, algorithm `sha256`. Validate the v1/v2 report first. Remove top-level `verification` and each request's `verification` and `verificationMs`; retain all other evidence. Wrap as `{format, version, algorithm, evidence}`. Serialize recursively with keys sorted by JavaScript UTF-16 code-unit order, array order preserved, ECMAScript `JSON.stringify` primitive/number encoding, no Unicode normalization or extra whitespace. Hash the UTF-8 bytes and encode lowercase hexadecimal. Unsupported/non-finite values are rejected. Publication metadata lives in a separate receipt, avoiding circular hashing. The standalone reproducer and regression tests pin the published digest. This publication digest is distinct from the original report/configuration/result hashes displayed in the UI.

## Optional new inference — explicit operator action

Evaluation does not require this step. To run Groq inference, create a key at [Groq Console](https://console.groq.com/keys), confirm the key belongs to a **Free-plan organization**, then place these server-only settings in `.env.local` and restart:

```dotenv
VEYRA_COMPUTE_PROVIDER=groq
GROQ_API_KEY=your_private_key
GROQ_FREE_TIER_CONFIRMED=true
```

The free-tier flag is an operator assertion, not a billing guarantee. If free access is unavailable, stop. Select a currently discovered model; availability can change. For a small smoke test, use zero warm-ups, one measured request, concurrency one and 32 output tokens. The model in the historical report need not remain available to verify that report.

NEAR AI Cloud remains selectable with `VEYRA_COMPUTE_PROVIDER=near-ai-cloud` (also the default) and `NEAR_AI_API_KEY`. Authenticated NEAR AI Cloud inference has **not** been live-validated here and may consume paid credits. Do not enable it merely to evaluate this submission. All settings are listed in [`.env.example`](.env.example); never use `NEXT_PUBLIC_` credentials.

## Tests and production build

```sh
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
npm run start -- --hostname 127.0.0.1 --port 3100
```

Run TypeScript checks and the build sequentially: Next regenerates its type files during build. Unit, DOM and integration tests use synthetic providers/signers/RPC; they require no paid API calls or Mac credential. The bundled real fixture is validated offline during tests.

Browser tests use Playwright-managed Chromium, not a personally installed Chrome:

```sh
npx playwright install chromium
npm run build -- --webpack
npm run test:browser -- --config=playwright.production.config.ts --workers=1
```

On Linux, Playwright may also require its documented system dependencies (`npx playwright install --with-deps chromium`). Browser tests mock benchmark requests. The suite covers the marketing homepage, dedicated historical verification, tampering, desktop/mobile benchmark workflows, responsive layouts, keyboard interaction and reduced motion. Browser checks run serially to keep responsive screenshots and interaction checks reproducible on one host; assertion timeouts are unchanged. Generated browser artifacts are ignored.

## Security and private publication

Run this prototype locally on loopback. Inference routes enforce local Host/Origin checks, a single active run and shared hourly limits (6 reservations, 40 attempts, 6,000 requested output tokens). These are **not** authenticated multi-user quotas suitable for a public hosted service. Cancellation aborts the client request but cannot guarantee upstream work stops.

New publication is separate from benchmark completion/page load. It requires explicit digest approval, signing enablement and a dedicated allowlisted Testnet account. HTTP publication additionally requires a private bearer token and local origin; body/rate limits apply. The durable private journal limits reservations to three per 24 hours and twenty total, serializes signing, records the expected hash before one broadcast, and never blindly retries ambiguous submissions. Fee preflight has a 0.01 Testnet NEAR estimated ceiling, not a protocol-enforced future gas-price cap. Keep the journal on durable single-host storage; never delete it to force a retry.

The existing `npm run proof -- preview|publish|verify|reconcile` operator CLI is separate from `verify:demo`. Its configuration is in `.env.example`. Backend `NEAR_TESTNET_PRIVATE_KEY` signing retains strict validation. An optional local macOS adapter uses official near-cli-rs **0.31.1** offline Keychain signing; it requires `NEAR_TESTNET_SIGNER=keychain`, the existing public key and an absolute native CLI path. It checks returned bytes and signature and rejects legacy-file fallback output. The official CLI reads the secret into its own memory: this is not non-exportable hardware signing. Keychain signing cannot be enabled through HTTP. Judges do not need either signing mode.

Do not include `.env.local`, `.env.proof.local`, `.veyra-proof-state`, private receipts, keys or credentials in Git. The public evidence directory intentionally contains only the reviewed original report and public receipt. This project has no GPU execution proof, TEE attestation, trusted timing enclave or public hosting deployment supplied here. Historical financial modules remain in source/tests for regression compatibility; they are not the active application.

## Implementation provenance

Noxicon was previously named Veyra Compute. Historical `veyra-compute` report identifiers, `veyra-benchmark-evidence` commitment formats, `VEYRA_*` settings, download filenames and the `veyra-proof.testnet` publisher remain unchanged for compatibility. They are technical identifiers, not current product branding.

The application uses Next.js, React, TypeScript, Zod and the official NEAR JavaScript SDK; optional Mac signing delegates to official near-cli-rs. Development used AI coding assistance. Earlier financial modules are retained as baseline/regression code, not presented as Compute features. The committed evidence and current Compute/NEAR implementation are the work to evaluate.

## Assets and licensing

The accelerator is conceptual artwork, not a photograph of the benchmark hardware. Manrope is self-hosted under the included [SIL OFL notice](public/manrope-OFL.txt); asset/runtime attribution is in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md). Noxicon source code is licensed under the [ISC License](LICENSE), copyright © 2026 Leye-Adebayo John Oluseyi. Third-party assets and dependencies retain their respective licenses.

### Verify the current workspace report

In `/app`, import or run a report, then choose **Upload receipt & verify** under Verification status. Select its matching publication receipt. The read-only `/api/proofs/check` endpoint checks the report commitment, publisher and finalized transaction through the existing verifier. It never signs or publishes. The expected publisher is `NEAR_TESTNET_PUBLISHER`, defaulting to the historical demo account `veyra-proof.testnet`; the uploaded receipt cannot choose the trusted publisher. `NEAR_TESTNET_VERIFY_RPC_URL` may select an existing allowlisted Testnet RPC. No API token or signing key is needed. Checks are same-origin, body-limited and capped at 30 requests per minute per process.

A fresh benchmark still needs separate operator publication before it has a receipt. An unavailable RPC is shown as unavailable, not verified. Publication integrity does not authenticate measurements or establish execution attestation.
