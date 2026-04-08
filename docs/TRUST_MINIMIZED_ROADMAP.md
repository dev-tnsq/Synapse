# Trust Minimized Roadmap

## 1) Decision statement

Hosted v1 is acceptable for launch and demo velocity, but outputs must be verifiable from day 1.

Required principle:
- Any client can independently verify that a paid request, payment proof, execution result, and receipt hash match the same invocation.

## 2) Threat model

| Threat | Failure mode | Mandatory control | Verification artifact |
| --- | --- | --- | --- |
| Frontrun | Provider executes altered params after seeing intent | Bind request hash into signed receipt envelope and payment session metadata | Receipt envelope signature + request hash equality check |
| Censorship | Gateway silently drops paid or valid requests | Deterministic status codes, timeout SLA, and auditable request log IDs | Request ID timeline with accepted/rejected reason |
| Replay | Old proof or idempotency key is reused | Idempotency key uniqueness window + nonce and proof age checks | Replay rejection log with prior request reference |
| Overcharging | Charged amount exceeds advertised price | Price bound check against discovery snapshot and signed quote | Quote hash and charged amount diff report |
| Tampered response | Gateway mutates result payload | Response hash in signed receipt envelope and optional chain anchor | Client recomputation of response hash matches receipt |
| Stale discovery | Client uses outdated API/pricing metadata | Versioned discovery with updated_at and openapi_hash validation | Discovery version used in invocation proof |

## 3) V1 mandatory controls (before demo and mainnet)

1. Signed gateway receipt envelope
- Artifact: canonical JSON receipt envelope with signature over request hash, response hash, price, provider address, and timestamp.
- Check: verifier tool validates signature and canonical hash deterministically.

2. Response hash anchoring strategy
- Artifact: deterministic response hash included in receipt envelope for every paid call.
- Check: at minimum, periodic batch anchoring of receipt root hash to chain; per-call anchoring optional in v1.

3. Idempotency and anti-replay guarantees
- Artifact: idempotency store keyed by provider, endpoint, and idempotency key; proof nonce tracking.
- Check: duplicate request returns prior result or explicit replay error without second charge.

4. Provider payout policy constraints
- Artifact: payout policy document and enforced config (max payout delay, max fee spread, minimum proof fields).
- Check: payout run rejects receipts missing required fields or price bound proof.

5. Open-source reproducible gateway server release
- Artifact: tagged source release, build script, lockfile, and reproducible container digest.
- Check: independent build reproduces the published binary/container digest.

## 4) Smart account guardrails (OpenZeppelin policies)

Apply policy modules at payout and settlement boundaries:
- Spend caps: per provider, per interval, and global daily cap.
- Allowlists: only approved payout destinations and contract targets.
- Expiry: signed authorizations and policy sessions must expire.
- Nonce: strictly monotonic or one-time nonce to block replay.

Minimum implementation artifact:
- Policy config manifest committed in repo and loaded at startup.

Minimum check:
- Every payout transaction references policy decision output in logs.

## 5) Discovery scale architecture

Registry contract record fields:
- api_url
- openapi_hash
- pricing_mode
- provider_address
- status
- updated_at

Indexed API behavior:
- Indexer consumes registry events and materializes query-optimized views.
- Discovery endpoints return only active status by default and support status filters.
- Responses include updated_at and openapi_hash so clients can pin and verify metadata.
- Cache invalidation is event-driven, with periodic full sync reconciliation.

## 6) Pricing model progression

Current mode:
- Static per-function pricing from registry/discovery metadata.

Next mode:
- Dynamic contract callback for context-aware pricing.

Deterministic fallback behavior:
- If callback fails, times out, or returns invalid data, use last valid static price.
- If no static fallback exists, return deterministic pricing_unavailable error and do not execute.

## 7) Migration phases with owner and exit gates

| Phase | Owner | Scope | Exit gate |
| --- | --- | --- | --- |
| Phase A: hosted verifiable gateway | Gateway team | Centralized routing with mandatory signed receipts and replay protection | External verifier passes on recorded paid flow and reproducible release is published |
| Phase B: shared gateway routing via registry | Gateway + indexing team | Multi-provider routing driven by registry and indexed discovery | Registry-index consistency SLO met and stale discovery detection active |
| Phase C: decentralized/serverless/verifiable compute paths | Protocol + platform team | Multiple execution paths with independent proof validation and minimized trusted operators | Clients can verify result integrity and settlement without trusting a single hosted gateway |

## 8) Hard release gates and no-go conditions

Hard release gates:
- Signed receipt verification passes for all paid smoke tests.
- Anti-replay tests pass for nonce and idempotency edge cases.
- Price bound enforcement blocks overcharge attempts.
- Discovery freshness checks reject stale metadata beyond policy threshold.
- Reproducible build verification is documented and repeatable.

No-go conditions:
- Any paid path lacks signed receipt envelope.
- Duplicate charge is possible under retry or replay.
- Pricing fallback is nondeterministic.
- Registry and discovery views disagree without alerting.
- Payout policy can be bypassed by configuration drift.

## 9) Judge and demo evidence checklist

- [ ] Paid invocation packet: request, 402/payment proof, response, signed receipt.
- [ ] Independent verifier output showing signature, hash, and pricing checks passed.
- [ ] Replay attempt evidence showing rejection without extra charge.
- [ ] Discovery pinning evidence using openapi_hash and updated_at.
- [ ] Reproducible build evidence: source tag, build command, resulting digest.
- [ ] Payout policy enforcement logs showing spend cap/allowlist/expiry/nonce checks.
- [ ] Migration phase status sheet with current phase and unmet exit gates.