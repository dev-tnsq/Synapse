---
name: blockchain-system-integration
description: "Design end-to-end blockchain integration between contracts and backend. Use when specifying transaction lifecycle, indexing, reconciliation, and operational reliability for Synapse."
argument-hint: "Describe subsystem boundaries and reliability goals"
user-invocable: true
---

# Blockchain System Integration

## Outcome
Create an integration blueprint linking on-chain operations to backend services.

## Procedure
1. Define on-chain and off-chain boundaries.
2. Map transaction lifecycle and state transitions.
3. Define indexing and event consumption model.
4. Define reconciliation and recovery strategy.
5. Define operational SLOs and alert thresholds.

## Output Format
1. Boundary map
2. Lifecycle spec
3. Data sync model
4. Recovery playbook
5. SLO and observability plan

## Completion Criteria
- No ambiguous ownership across components.
- Failure recovery path exists for each critical flow.
