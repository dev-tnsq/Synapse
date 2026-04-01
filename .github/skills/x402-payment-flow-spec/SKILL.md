---
name: x402-payment-flow-spec
description: "Design x402 paid HTTP interaction flows for machine payments. Use when defining 402 challenge, payment proof, verification, anti-replay, idempotency, and settlement behavior."
argument-hint: "Describe endpoint, pricing, and trust model"
user-invocable: true
---

# x402 Payment Flow Spec

## Outcome
Produce a complete payment protocol contract for paid API or MCP tool calls.

## Procedure
1. Define call lifecycle from request to settlement.
2. Specify 402 response contract and required client headers.
3. Define payment proof validation and anti-replay rules.
4. Define timeout, retry, and idempotency behavior.
5. Define settlement and reconciliation outputs.

## Output Format
1. Lifecycle diagram (text)
2. Request and response contracts
3. Verification rules
4. Error matrix
5. Reconciliation checklist

## Completion Criteria
- Every failure path has deterministic handling.
- Replay and double-spend vectors are addressed.
