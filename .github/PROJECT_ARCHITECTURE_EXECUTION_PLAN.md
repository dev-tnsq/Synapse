# Project Architecture Execution Plan: StellarMCP Gateway

## 1) Idea Judgment

### North Star
Enable developers to register a Soroban contract once and automatically expose each operation as both x402-paid HTTP API and MCP tool, with deterministic Stellar-backed settlement and verifiable proofs.

### Judge-Facing Value
- Real utility: autonomous paid invocation via both API and MCP, not mock payments.
- Technical depth: x402 challenge/response + on-chain proof + replay-safe verification.
- Ecosystem fit: Stellar rails for low-cost, fast stablecoin micropayments.
- Demo clarity: end-to-end paid call from agent request to contract event receipt.

### Scope Decision (Build Now vs Later)
- Build now:
- One canonical contract operation schema generated from ABI.
- Dual interface generation: OpenAPI endpoint + MCP tool for each operation.
- x402 verification middleware with idempotency and anti-replay.
- Soroban contract for payment intent/receipt logging.
- Basic observability and reconciliation report.
- Defer:
- Multi-chain expansion.
- Dynamic pricing marketplace UI.
- Advanced agent reputation and credit scoring.

## 2) Architecture Layers

1. Contract Interface Compiler Layer
- Parses Soroban ABI/XDR and normalizes function signatures, docs, and pricing metadata.
- Produces canonical operation specs used by both HTTP and MCP surfaces.

2. Dual Exposure Layer (API + MCP)
- Generates x402-paid REST endpoints and matching MCP tool definitions from the same operation spec.
- Ensures API and MCP remain semantically identical for args, auth, pricing, and outputs.

3. Agent Runtime Layer
- Orchestrates task graph and chooses MCP tools.
- Injects payment-capable HTTP client for x402 retries.

4. Gateway Execution Layer
- Applies x402 payment guard for both API and MCP entrypoints.
- Maps validated operations to contract invocation handlers and settlement hooks.

5. x402 Payment Protocol Layer
- Returns 402 challenge with accepted asset, amount, payee, nonce, expiry.
- Accepts payment proof headers and validates signature/proof freshness.
- Implements idempotency key and replay protection.

6. Settlement + Contract Layer (Soroban)
- Writes payment intent/receipt event keyed by request hash.
- Verifies amount, recipient, expiry, and one-time nonce usage.
- Exposes query endpoint for proof-of-payment retrieval.

7. Service Execution Layer
- Runs the paid business operation after payment verification.
- Returns result + payment receipt pointer + correlation ID.

8. Observability + Reconciliation Layer
- Structured logs across challenge, pay, verify, execute, settle.
- Daily reconciliation for paid requests vs contract receipts mismatch.

## 3) Unified Interface Contract

Each ABI function compiles into one canonical operation object:
- `operationId`
- `inputSchema`
- `outputSchema`
- `pricing`
- `x402Policy`
- `authPolicy`

The gateway then emits:
- `/api/v1/ops/{operationId}` (x402-paid HTTP)
- `tool:{namespace}__{operationId}` (MCP tool)

This keeps APIs and MCP tools as two transport surfaces over the same contract operation.

## 4) 6-Step Paid Call Flow

1. Register + Compile
- Developer registers contract ABI once.
- Gateway compiles canonical operation specs.

2. Dual Surface Publish
- Gateway publishes OpenAPI endpoints and MCP tools from those specs.

3. Initial Invocation
- Agent calls API or MCP without payment proof.
- Gateway returns HTTP 402 with payment challenge (amount, asset, nonce, expiry, payee, request hash).

4. Payment + Proof
- Agent submits Stellar payment and attaches x402 proof headers + idempotency key.

5. Verification + Execute
- Gateway validates proof, nonce freshness, expiry, amount, destination, and duplicate use.
- Gateway executes the same canonical operation handler regardless of API or MCP entrypoint.
- Emits Soroban payment receipt event with request hash and settlement metadata.

6. Respond + Audit
- Gateway returns business response + receipt reference.
- Logs correlation IDs for full traceability and reconciliation.

## 5) 7-Day Execution Plan

### Day 1: Contract Schema and Interface Model
- Owner: Contract + Gateway
- Output: canonical operation schema, receipt event schema, x402 header schema
- Completion criteria: one ABI function maps deterministically to both API and MCP definitions

### Day 2: 402 Challenge + Verify Middleware
- Owner: Gateway
- Output: 402 challenge endpoint, proof verification middleware, anti-replay store
- Completion criteria: Invalid proof, expired nonce, wrong amount all rejected deterministically

### Day 3: API + MCP Generation Pipeline
- Owner: Gateway + Backend
- Output: generated OpenAPI routes and MCP tools from canonical operation schema
- Completion criteria: same operation produces identical validation and pricing rules on both surfaces

### Day 4: Soroban Receipt Contract Integration
- Owner: Contract
- Output: contract methods for receipt write/read, event emission
- Completion criteria: local invoke + event query pass with fixture data

### Day 5: Paid Operation End-to-End
- Owner: Gateway + Service
- Output: one paid operation fully wired through API and MCP surfaces
- Completion criteria: successful paid call returns business result + receipt ID from both entrypoints

### Day 6: Observability and Reconciliation
- Owner: Platform
- Output: structured logs, trace IDs, reconciliation script/report
- Completion criteria: mismatch scenarios surfaced with actionable reason codes

### Day 7: Hardening + Demo Packaging
- Owner: Security + QA
- Output: tests for replay, double-submit, timeout, chain delay, insufficient funds; demo script and proof artifacts
- Completion criteria: critical-path test suite green and 3 clean rehearsal runs under time limit

## 6) Command Runbook

### Stellar CLI
```bash
stellar --version
stellar keys generate demo-sender
stellar keys generate demo-receiver
stellar network use testnet
stellar account show <PUBLIC_KEY> --network testnet
```

### Soroban / Contract Ops
```bash
soroban --version
soroban contract build
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/<contract>.wasm
soroban contract deploy --wasm <contract>.optimized.wasm --source <KEY> --network testnet
soroban contract invoke --id <CONTRACT_ID> --source <KEY> --network testnet -- <fn> --arg <value>
```

### Node Tooling (npm)
```bash
npm ci
npm run build
npm run test
npm run lint
npm run dev
```

### Node Tooling (pnpm)
```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm dev
```

### Gateway Generation (Design Target)
```bash
# Compile Soroban ABI to canonical operation specs
pnpm run gateway:compile-abi -- --abi ./abi.json --out ./generated/ops

# Generate both OpenAPI routes and MCP tools from canonical ops
pnpm run gateway:generate-surfaces -- --ops ./generated/ops
```

## 7) Risk Register

1. Replay and double-spend acceptance
- Impact: financial loss, invalid service execution
- Mitigation: nonce store + short expiry + request hash binding + idempotency key

2. Chain latency or temporary RPC failure
- Impact: false negatives in proof verification
- Mitigation: bounded retry policy, async settlement confirmation mode, clear pending state

3. Price/asset mismatch between challenge and proof
- Impact: underpayment or settlement ambiguity
- Mitigation: canonical challenge hash signed by gateway and validated before execute

4. Incomplete observability for dispute resolution
- Impact: cannot prove who paid for what
- Mitigation: mandatory correlation IDs, immutable receipt event, daily reconciliation

5. Scope creep during hackathon window
- Impact: no stable end-to-end demo
- Mitigation: freeze one canonical operation exposed on both API and MCP by Day 2; any extras behind feature flags

6. Wallet/key handling mistakes in demo env
- Impact: failed payment path on stage
- Mitigation: pre-funded test keys, dry-run checklist, backup wallet and prerecorded fallback proof
