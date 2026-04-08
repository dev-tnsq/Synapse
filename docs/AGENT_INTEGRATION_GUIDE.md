# Agent Integration Guide

Audience: external autonomous agent developers integrating with Synapse over HTTP APIs.

## 1) Discovery-First Integration Model

Use discovery endpoints as the source of truth before every invocation session.

1. Fetch manifest for network, payment defaults, and summary.
2. Fetch operations for per-operation method/path/paymentRequired/price.
3. Optionally fetch contracts and OpenAPI for richer planning/tool generation, including discovery freshness metadata (`discovery.updatedAt`, `discovery.openapiHash`).
4. Cache with short TTL and refresh on `OPERATION_NOT_FOUND` or schema mismatch.

Discovery endpoints:

- `GET /api/v1/discovery/manifest`
- `GET /api/v1/discovery/contracts`
- `GET /api/v1/discovery/operations`
- `GET /api/v1/discovery/openapi.json`
- `GET /api/v1/discovery/proofs`

## 2) Fetch and Interpret Manifest, Contracts, Operations, OpenAPI, Proofs

### Manifest (`/api/v1/discovery/manifest`)

Use for:

- network selection and `paymentDefaults`
- operation counts (`summary`)
- latest proof summary (`proof.latestProof`)

### Contracts (`/api/v1/discovery/contracts`)

Use for:

- contract grouping
- paid/free operation split
- price bounds per contract

### Operations (`/api/v1/discovery/operations`)

Use for execution planning:

- `id`, `method`, `path`
- `paymentRequired`
- `priceStroops`
- operation-level payment hints (`payment.*`)
- discovery freshness metadata (`discovery.updatedAt`, `discovery.openapiHash`)

### OpenAPI (`/api/v1/discovery/openapi.json`)

Use to generate client stubs and validators.

Important extension:

- `x-synapse-payment.required`
- `x-synapse-payment.priceStroops`
- `x-synapse-payment.payToAddress`
- `x-synapse-payment.networkPassphrase`

### Proofs (`/api/v1/discovery/proofs`)

Use for operator audit dashboards and evidence retrieval:

- proof file name
- generated timestamp
- challenge and invoke statuses
- optional tx hash + explorer URL
- discovery freshness metadata (`discovery.updatedAt`, `discovery.openapiHash`)

## 3) Free Operation Invocation Flow

1. Discover operation and confirm `paymentRequired = false`.
2. Generate unique `idempotency-key`.
3. Call operation endpoint.
4. On success, persist canonical receipt.
5. On retry, reuse same key only with identical payload.

Example (GET free operation):

```bash
curl -i \
  -X GET "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${FUNCTION_NAME}" \
  -H "idempotency-key: ${IDEMPOTENCY_KEY}"
```

Example (POST free operation):

```bash
curl -i \
  -X POST "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${FUNCTION_NAME}" \
  -H "content-type: application/json" \
  -H "idempotency-key: ${IDEMPOTENCY_KEY}" \
  -d '{"arg1":"value"}'
```

## 4) Paid Operation Invocation Flow (Initial Call -> 402 -> Pay -> Retry)

Current gateway behavior is deterministic and must be handled as follows.

1. Discover operation and confirm `paymentRequired = true`.
2. Send initial call with `idempotency-key` and no `payment-signature`.
3. Receive `402` with `payment-required` header and canonical failure body.
4. Produce payment proof/signature from challenge.
5. Retry same operation with `payment-signature` and a new `idempotency-key`.
6. Receive `200` with canonical success body and receipt.

Why new key on paid retry:

- Current implementation stores the initial `402` under the first key.
- Reusing that key replays stored failure with `x-idempotent-replay: true`.

Step A: request challenge

```bash
curl -i \
  -X POST "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${PAID_FUNCTION}" \
  -H "content-type: application/json" \
  -H "idempotency-key: ${CHALLENGE_KEY}" \
  -d '{"arg1":"value"}'
```

Step B: pay externally and obtain encoded payment payload as `${PAYMENT_SIGNATURE}`.

Step C: retry paid call

```bash
curl -i \
  -X POST "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${PAID_FUNCTION}" \
  -H "content-type: application/json" \
  -H "idempotency-key: ${PAID_RETRY_KEY}" \
  -H "payment-signature: ${PAYMENT_SIGNATURE}" \
  -d '{"arg1":"value"}'
```

## 5) Idempotency Strategy Best Practices

- Generate cryptographically random keys per invocation attempt.
- Keep separate keys for:
- challenge acquisition,
- paid execution retry,
- any materially changed payload.
- Reuse a key only when payload, path, method, and query are identical.
- Persist mapping `{key -> request fingerprint -> response}` in agent state.
- Treat `409 IDEMPOTENCY_CONFLICT` as deterministic client error, not transient server failure.

## 6) Proof Retrieval and Audit Verification

Use proof endpoints and operation receipts together.

1. Read latest proofs:

```bash
curl -sS "${GATEWAY_URL}/api/v1/discovery/proofs?limit=10"
```

2. Verify each record includes expected statuses:

- `paymentChallengeStatus`
- `invokeHttpStatus`
- `txHash` (when available)

3. Cross-check operation response receipt fields:

- `receipt.receiptId`
- `receipt.operationId`
- `receipt.paymentProofId`

4. If tx hash is present, resolve explorer URL and archive link in audit log.

## 7) Current MCP Status and Practical Guidance Now

Current status:

- MCP runtime exists in-process in gateway (`services/gateway/src/mcp/runtime.ts`).
- External MCP transport endpoint is not exposed yet.

Practical integration guidance now:

- Integrate over HTTP discovery + operation APIs for production traffic.
- Use operation `id` as internal tool identifier in your agent planner.
- Keep tool schemas derived from `openapi.json` + `operations` endpoints.
- Preserve compatibility with future external MCP transport by retaining operation id and canonical result envelope assumptions.

## 8) Production Hardening Checklist for Agent Clients

- Discovery cache with refresh-on-error policy.
- Pin `discovery.openapiHash` per session and refresh discovery/OpenAPI when hash changes.
- Strict canonical error handling by `error.code`.
- Deterministic idempotency ledger and conflict handling.
- Payment proof lifecycle management (freshness, replay avoidance).
- Request timeout + bounded retries with jitter.
- Structured logging with correlation ids and idempotency keys.
- Evidence archival for paid calls (challenge, proof, receipt, tx link).
- Circuit-breaker behavior for repeated `INVALID_PAYMENT_PROOF`.
- Alerting on `INTERNAL_ERROR` and abnormal 402/409 rates.

## 9) Copy-Paste Bootstrap Commands

Set variables:

```bash
export GATEWAY_URL="http://127.0.0.1:8787"
export CONTRACT_ID="<CONTRACT_ID>"
export FUNCTION_NAME="<FUNCTION_NAME>"
export PAID_FUNCTION="<PAID_FUNCTION_NAME>"
export IDEMPOTENCY_KEY="agent-$(date +%s)-free"
export CHALLENGE_KEY="agent-$(date +%s)-challenge"
export PAID_RETRY_KEY="agent-$(date +%s)-paid"
export PAYMENT_SIGNATURE="<ENCODED_PAYMENT_SIGNATURE>"
```

Discover operations:

```bash
curl -sS "${GATEWAY_URL}/api/v1/discovery/operations"
```

Call free op:

```bash
curl -i \
  -X GET "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${FUNCTION_NAME}" \
  -H "idempotency-key: ${IDEMPOTENCY_KEY}"
```

Challenge then paid retry:

```bash
curl -i \
  -X POST "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${PAID_FUNCTION}" \
  -H "content-type: application/json" \
  -H "idempotency-key: ${CHALLENGE_KEY}" \
  -d '{}'

curl -i \
  -X POST "${GATEWAY_URL}/api/v1/op/${CONTRACT_ID}/${PAID_FUNCTION}" \
  -H "content-type: application/json" \
  -H "idempotency-key: ${PAID_RETRY_KEY}" \
  -H "payment-signature: ${PAYMENT_SIGNATURE}" \
  -d '{}'
```
