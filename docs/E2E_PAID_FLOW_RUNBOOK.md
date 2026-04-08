# E2E Paid Flow Runbook

This runbook executes one full paid-flow scenario and captures evidence artifact output from the project script.

## 1) Prerequisites and Environment Setup

Required tools:

- `bash`
- `jq`
- `curl`
- `npm`
- Soroban CLI (`stellar` or `soroban`)

Required repository state:

- workspace dependencies installed (`npm install`)
- contracts and gateway code available

Base environment:

```bash
export SOROBAN_NETWORK=testnet
export SOROBAN_ADMIN_ADDRESS=<ADMIN_ADDRESS>
export SOROBAN_SOURCE_ALIAS=<SOURCE_ALIAS_OR_ACCOUNT>

# If not using SOROBAN_NETWORK_ONLY=1, also set:
# export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
# export STELLAR_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
```

Optional run controls:

- `SKIP_DEPLOY=1` to skip contract deployment phase.
- `GATEWAY_PORT` to avoid local port collisions (default `4021`).
- `GATEWAY_HOST` (default `127.0.0.1`).

## 2) Exact Command Sequence

From repository root:

```bash
npm install
bash contracts/scripts/e2e_proof_flow.sh
```

The script performs:

1. deploys contracts (unless `SKIP_DEPLOY=1`)
2. starts gateway in background
3. registers registry and receipt ABIs
4. requests a payment challenge on paid endpoint
5. invokes a read operation
6. writes evidence JSON into `contracts/target`

## 3) Generated Artifact

Primary output artifact:

- `contracts/target/e2e-proof.<timestamp>.json`

Script also prints:

- artifact path
- gateway log path (`contracts/target/gateway-e2e.log`)

## 4) Evidence Checklist

Open latest artifact and verify these fields:

- deployment evidence:
- `deployedAtUnix`
- `registryContractId`
- `receiptContractId`
- `adminAddress`
- registration evidence:
- `registerRegistryExit` equals `0`
- `registerReceiptExit` equals `0`
- `registerRegistryStatus` is `ok` or `duplicate-ok`
- `registerReceiptStatus` is `ok` or `duplicate-ok`
- challenge evidence:
- `paymentChallengeStatus` should be `402`
- `paymentChallengeResponse.error.code` should indicate payment required
- invocation evidence:
- `invokeHttpStatus` should be `200`
- `invokeResponse.ok` should be `true`
- tx and explorer evidence when present:
- `txHash`
- `explorerLinks.tx`
- contract explorer links:
- `explorerLinks.registryContract`
- `explorerLinks.receiptContract`

Quick check command:

```bash
LATEST_PROOF="$(ls -t contracts/target/e2e-proof.*.json | head -n 1)"
jq '{paymentChallengeStatus, invokeHttpStatus, txHash, explorerLinks}' "${LATEST_PROOF}"
```

## 5) Pass/Fail Criteria

Pass criteria:

- artifact file exists and is valid JSON
- challenge status is exactly `402`
- invoke status is exactly `200`
- registration exits are successful (`0`)
- operations count in artifact is positive (`operationsCount > 0`)

Conditional pass:

- `txHash` missing but invoke success is true and receipt fields are present
- keep as operational pass with reduced settlement evidence

Fail criteria:

- no artifact generated
- gateway health check timeout
- challenge status not `402`
- invoke status not `200`
- registration failures not marked `duplicate-ok`

## 6) Common Failure Triage

### Port already in use

Symptom: script exits with port collision error.

Action:

```bash
export GATEWAY_PORT=4123
bash contracts/scripts/e2e_proof_flow.sh
```

### Missing deployment metadata

Symptom: missing `contracts/target/deployments.<network>.json`.

Action:

- run `bash contracts/scripts/deploy.sh` manually
- verify required env vars for deploy are set

### Gateway never becomes healthy

Symptom: health check timeout.

Action:

- inspect `contracts/target/gateway-e2e.log`
- verify gateway env vars and Soroban account env vars
- verify no CLI mismatch (`stellar`/`soroban`) in PATH

### Payment challenge not returned as 402

Symptom: `paymentChallengeStatus` not `402`.

Action:

- ensure tested function is paid in registry
- confirm operation registration succeeded
- inspect operation metadata from `GET /operations`

### Invocation failure after challenge

Symptom: `invokeHttpStatus` is not `200`.

Action:

- inspect `invokeResponse` in artifact
- inspect gateway log for `INVALID_REQUEST` or contract invocation errors
- confirm deployed contract ids match current network

## 7) Go/No-Go Recommendation Rubric

Go:

- all pass criteria met in 2 consecutive runs
- no unresolved gateway startup or registration instability
- deterministic challenge and invoke statuses maintained
- evidence links and artifact integrity confirmed

No-Go:

- any hard fail criteria
- inconsistent statuses across repeated runs
- missing audit-critical evidence (challenge/invoke status, contract ids)

Conditional Go:

- core statuses pass but optional tx linkage absent
- acceptable only for internal testing, not final external proof package
