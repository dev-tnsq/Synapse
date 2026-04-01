---
name: soroban-contract-design
description: "Design Soroban contracts for production-ready behavior. Use when defining interfaces, storage, auth, events, pricing logic, and upgrade-safe patterns for Synapse contracts."
argument-hint: "Describe contract purpose, invariants, and constraints"
user-invocable: true
---

# Soroban Contract Design

## Outcome
Turn a product requirement into a secure, testable Soroban contract specification.

## Procedure
1. Define invariants, actors, and auth requirements.
2. Design contract interface and data model.
3. Specify event schema and error model.
4. Define test plan for core and edge cases.
5. Add security review checklist.

## Output Format
1. Contract scope
2. Interface spec
3. Storage model
4. Events and errors
5. Test matrix
6. Security notes

## Completion Criteria
- Auth and accounting rules are explicit.
- Interface can be implemented without hidden assumptions.
