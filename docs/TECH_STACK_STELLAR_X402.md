# Stellar + x402 Technical Stack

## Chosen Stack
- Frontend: Next.js App Router in `apps/web`
- Gateway backend: Fastify service in `services/gateway`
- Contracts: Soroban smart contracts in Rust under `contracts`

## Selected Libraries for Stellar and x402
- `@stellar/stellar-sdk`: transaction, Horizon, and network primitives
- `x402` via exported subpaths: `x402/shared`, `x402/verify`, `x402/client`, `x402/paywall`, `x402/facilitator`
- `zod`: request/response schema validation
- `ioredis`: nonce/replay cache and short-lived payment state
- `jose`: signature and token verification utilities
- `pino`: structured logs for payment lifecycle traces
- `@opentelemetry/api` and OpenTelemetry SDK packages: end-to-end paid invocation tracing

## Why x402 Root Import Fails
The package uses export maps and does not expose all internals through its root entrypoint. Depending on runtime and bundler resolution, `import { ... } from "x402"` can fail for symbols that are only exported from subpaths.

Use explicit subpath imports instead.

```ts
import { safeBase64Encode } from "x402/shared";
import { verify } from "x402/verify";

const bodyHash = safeBase64Encode(new TextEncoder().encode(JSON.stringify(payload)));
const result = await verify({ paymentHeader, bodyHash });
```

This keeps imports deterministic across Node ESM/CJS boundaries and avoids missing export errors.

## MPP Handling Strategy in Gateway
- Accept optional proof-level MPP summary fields to support split-route payments.
- Validate summary total (`deliveredAmountStroops`) and leg count before execution.
- If detailed legs are supplied, sum all legs and enforce the minimum amount.
- When tx hash proof is present, cross-check the delivered destination amount through Horizon payment-like operations.
- Keep deterministic verifier errors for underpayment, replay, and malformed proof paths.

## Near-Term Integrations
- Facilitator endpoint integration for upstream payment confirmation and reconciliation.
- Persisted settlement receipts keyed by proof id and tx hash.
- Background reconciliation job that verifies facilitator + Horizon consistency.
