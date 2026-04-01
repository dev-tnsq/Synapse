---
name: research-tech-data-dev
description: "Research technology options and gather implementation-ready data for software development tasks. Use when comparing stacks, selecting libraries, validating architecture, estimating effort, or collecting benchmark/security/license evidence."
argument-hint: "Describe the feature/problem, constraints, and preferred stack"
user-invocable: true
---

# Research Tech And Data For Development

## Outcome
Produce a decision-ready research brief for a development task, including:
- candidate technologies
- evidence table (capability, maturity, security, license, cost, ecosystem)
- recommendation with rationale
- implementation starter plan
- risks and validation steps

## When To Use
Use this skill when you need to:
- choose between frameworks, SDKs, or databases
- compare build-vs-buy options
- validate technical feasibility under constraints
- collect data for architecture decisions (ADR-style)
- prepare a development spike with actionable next steps

## Inputs
Collect or infer:
- problem statement and target outcome
- non-functional constraints: performance, latency, scale, compliance, budget, team expertise
- environment constraints: language/runtime/cloud/platform
- timeline and acceptable risk level

If key inputs are missing, ask focused questions before deep research.

## Procedure
1. Define the decision scope.
- Write the exact decision to be made in one sentence.
- List hard constraints vs preferences.
- Define success metrics and must-have capabilities.

2. Build the candidate set.
- Include 3-5 realistic options, plus current baseline if replacing something.
- Exclude options that violate hard constraints.

3. Gather evidence.
- For each option, collect:
  - feature fit to requirements
  - maintenance signals (release cadence, issue velocity, community activity)
  - compatibility and integration effort
  - performance/benchmark signals (if available)
  - security posture (known vulnerabilities, security process)
  - license and commercial constraints
  - cost model (infra, vendor, engineering complexity)
- Prefer primary documentation, official repos, and reputable benchmarks.
- Mark each claim as: confirmed, likely, or unknown.

4. Score and compare.
- Use a weighted matrix with explicit criteria.
- Show assumptions used for weighting.
- Run a quick sensitivity check by changing top weights.

5. Recommend.
- Provide top choice and runner-up.
- Explain trade-offs and why rejected options were rejected.
- State where uncertainty remains.

6. Convert to implementation.
- Produce an execution starter:
  - minimum viable integration plan
  - migration or rollout sequence
  - test strategy (functional, performance, security)
  - observability and rollback plan

7. Final quality checks.
- Verify all hard constraints are addressed.
- Ensure every key claim has a source or is marked unknown.
- Ensure recommendation is reproducible from the evidence.

## Branching Logic
- If constraints are strict and eliminate most options: run a feasibility-first path and propose requirement adjustments.
- If no trustworthy benchmarks exist: design a local spike benchmark plan with acceptance thresholds.
- If top options are tied: recommend a short proof-of-concept with decision gates.
- If security/compliance is a blocker: escalate compliance-first recommendation and document residual risk.

## Output Format
Return results in this structure:
1. Decision statement
2. Constraints and success metrics
3. Options considered
4. Evidence matrix
5. Weighted scoring and sensitivity notes
6. Recommendation and trade-offs
7. 1-2 week implementation starter plan
8. Open risks and follow-up experiments

## Completion Criteria
The skill is complete when:
- at least 3 viable options were compared (or a documented reason fewer exist)
- evidence quality is explicit (confirmed/likely/unknown)
- recommendation is clear, constrained, and actionable
- next implementation steps can be executed without additional strategic research
