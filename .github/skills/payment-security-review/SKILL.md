---
name: payment-security-review
description: "Review payment and contract flows for security risks. Use when auditing x402 verification, replay protection, auth checks, settlement logic, and abuse resistance for Synapse."
argument-hint: "Describe flow scope and threat assumptions"
user-invocable: true
---

# Payment Security Review

## Outcome
Deliver a prioritized security findings report for paid interaction flows.

## Procedure
1. Define threat model and trust boundaries.
2. Review auth, replay, and idempotency controls.
3. Review payment proof verification and recency checks.
4. Review contract/backend accounting consistency.
5. Produce severity-ranked findings and fixes.

## Output Format
1. Threat model summary
2. Findings by severity
3. Exploit path and impact
4. Recommended fix
5. Validation test cases

## Completion Criteria
- Critical and high risks have concrete remediation steps.
- Security tests are defined for each fixed issue.
