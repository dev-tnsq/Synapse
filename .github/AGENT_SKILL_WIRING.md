# AGENT_SKILL_WIRING

## Purpose
Define how Synapse agents and skills are wired so orchestration is predictable, handoffs are consistent, and delivery stays aligned to hackathon outcomes while exposing each contract operation as both x402 API and MCP tool from one canonical interface.

## Agent List
- Synapse Master Orchestrator
- Synapse System Planner
- Stellar Protocol Expert
- Machine Payments Architect
- Blockchain Systems Engineer
- Soroban Smart Contract Engineer
- Backend Payment Engineer
- Frontend Demo Designer
- Hackathon Demo Strategist
- Synapse Innovation Strategist
- GitHub Repo Operations

## Skill List
- synapse-delivery-planning
- stellar-ecosystem-research
- x402-payment-flow-spec
- blockchain-system-integration
- soroban-contract-design
- mcp-gateway-tooling
- e2e-integration-readiness
- payment-security-review
- hackathon-demo-package
- innovation-feature-bets
- research-tech-data-dev

## Agent to Skill Mapping
| Agent | Primary Skills | Secondary Skills | Expected Output |
|---|---|---|---|
| Synapse Master Orchestrator | synapse-delivery-planning, e2e-integration-readiness | hackathon-demo-package, payment-security-review | Integrated execution cycle |
| Synapse System Planner | synapse-delivery-planning | research-tech-data-dev, e2e-integration-readiness | Milestones, owners, stage gates |
| Stellar Protocol Expert | stellar-ecosystem-research | x402-payment-flow-spec, research-tech-data-dev | Protocol decisions and constraints |
| Machine Payments Architect | x402-payment-flow-spec | payment-security-review, stellar-ecosystem-research | 402 contract, verification rules, anti-replay model |
| Blockchain Systems Engineer | blockchain-system-integration | e2e-integration-readiness, payment-security-review | Chain/off-chain integration blueprint and recovery model |
| Soroban Smart Contract Engineer | soroban-contract-design | payment-security-review, blockchain-system-integration | Contract interfaces, auth model, events, tests |
| Backend Payment Engineer | mcp-gateway-tooling | x402-payment-flow-spec, blockchain-system-integration | Paid API middleware and invocation reliability |
| Frontend Demo Designer | e2e-integration-readiness | hackathon-demo-package | UI proof surfaces and clear economic-flow storytelling |
| Hackathon Demo Strategist | hackathon-demo-package | e2e-integration-readiness, innovation-feature-bets | Demo script, claims-to-proof mapping, fallback plan |
| Synapse Innovation Strategist | innovation-feature-bets | research-tech-data-dev, hackathon-demo-package | High-impact bets with scope cuts |
| GitHub Repo Operations | research-tech-data-dev | synapse-delivery-planning | Clean commit history, safe sync, and release-ready change narrative |

## Invocation Order
1. Synapse Master Orchestrator sets mission, deadline, and success criteria.
2. Synapse System Planner runs synapse-delivery-planning and produces milestone graph.
3. Stellar Protocol Expert runs stellar-ecosystem-research for protocol guardrails.
4. Soroban Smart Contract Engineer runs soroban-contract-design for canonical operation schema.
5. Backend Payment Engineer runs mcp-gateway-tooling to generate both API and MCP surfaces.
6. Machine Payments Architect runs x402-payment-flow-spec for one shared paid interaction contract.
7. Blockchain Systems Engineer runs blockchain-system-integration for lifecycle and reconciliation.
8. Parallel validation:
- payment-security-review over payment and contract flows
- e2e-integration-readiness over critical scenario paths
9. Frontend Demo Designer prepares proof-first UI using validated flows.
10. Synapse Innovation Strategist applies innovation-feature-bets for differentiation upgrades.
11. GitHub Repo Operations prepares atomic commits, synchronization sequence, and push confirmation.
12. Hackathon Demo Strategist runs hackathon-demo-package to finalize demo narrative and submission assets.
13. Synapse Master Orchestrator performs final gate review and launch decision.

## Handoff Packet Schema
```yaml
handoff_packet:
  meta:
    cycle_id: string
    stage: [plan, protocol, build, integrate, demo]
    owner_agent: string
    timestamp_utc: string
  objective:
    problem_statement: string
    success_criteria: [string]
    deadline: string
  inputs:
    upstream_dependencies: [string]
    assumptions: [string]
    constraints: [string]
  decisions:
    selected_option: string
    alternatives_considered: [string]
    rationale: [string]
  contracts:
    api_or_tool_contracts: [string]
    contract_interfaces: [string]
    data_events: [string]
  risks:
    risk_id: string
    severity: [low, medium, high, critical]
    mitigation: string
    owner: string
  evidence:
    test_results: [string]
    tx_or_receipt_refs: [string]
    demo_artifacts: [string]
  next_actions:
    action: string
    owner: string
    due_utc: string
```

## Stage Gates
| Gate | Entry Criteria | Exit Criteria | Owner | Required Evidence |
|---|---|---|---|---|
| G0 Scope Lock | Mission and deadline defined | Milestones, owners, critical path approved | Synapse System Planner | Plan artifact with dependencies |
| G1 Protocol Lock | Core flows identified | Stellar and x402 decisions signed off | Stellar Protocol Expert + Machine Payments Architect | Decision matrix and flow spec |
| G2 Build Ready | Interfaces stable | Contract and backend implementation tasks unblocked | Blockchain Systems Engineer | Integration blueprint and contracts |
| G3 Security Ready | First integrated flows exist | High/Critical payment risks mitigated | Backend Payment Engineer + Soroban Smart Contract Engineer | Security findings and fix validation |
| G4 E2E Ready | End-to-end path assembled | Paid call succeeds from request to UI proof | Synapse Master Orchestrator | Scenario pass report and evidence links |
| G5 Demo Ready | Narrative drafted | Primary + fallback demo scripts pass rehearsal | Hackathon Demo Strategist | Timed script, claim-to-proof sheet |
| G6 Submission Ready | Assets assembled | Final package complete and truthful | Synapse Master Orchestrator | Checklist pass and final sign-off |
