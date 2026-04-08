# Synapse

Synapse is a StellarMCP Gateway that turns Soroban contract ABIs into a unified interface exposed as x402-paid HTTP APIs and MCP tools, producing verifiable proof for each paid invocation from request through settlement and result.

## Quickstart prerequisites

- Node.js 20+
- npm 10+
- Rust toolchain
- Soroban CLI
- jq

Install workspace dependencies:

npm install

Start local Postgres (Docker):

```bash
docker compose up -d postgres
```

Generate Prisma client and apply gateway migrations:

```bash
npm run -w services/gateway prisma:generate
npm run -w services/gateway prisma:migrate:deploy
```

## One-command local startup

1. Copy env templates:

```bash
cp .env.example .env
cp services/gateway/.env.example services/gateway/.env
cp apps/web/.env.local.example apps/web/.env.local
cp contracts/.env.example contracts/.env
```

2. Configure required values in your copied env files (especially signer/account keys and pay-to address).

3. Start both gateway and web:

```bash
npm run project:dev
```

4. Verify local health and UI:

```bash
curl -sS http://127.0.0.1:8787/health
open http://localhost:3000
```

## Local run order

1. Start the gateway:

npm run -w services/gateway dev

Optional local migration workflow during development:

npm run -w services/gateway prisma:migrate:dev

2. Generate ABI JSON from built contracts:

bash contracts/scripts/generate-abi.sh

3. Register a contract ABI with the CLI:

npm run -w tools/cli dev -- register --gateway http://localhost:8787 --contract-id <CONTRACT_ID> --abi-file <PATH_TO_ABI_JSON> --base-path /v1/ops [--pricing-config <PATH_TO_PRICING_JSON>]

Pricing override precedence for non-readonly functions is: per-function pricing-config override > pricing-config defaultPriceStroops > --default-price-stroops.

4. Inspect machine-readable discovery endpoints:

- GET /api/v1/discovery/contracts
- GET /api/v1/discovery/operations
- GET /api/v1/discovery/agent-tools
- GET /api/v1/discovery/proofs
- GET /api/v1/discovery/manifest
- GET /api/v1/discovery/openapi.json

## Manual end-to-end test

1. Deploy contracts:

```bash
set -a; source contracts/.env; set +a
bash contracts/scripts/deploy.sh
```

2. Generate ABI artifacts:

```bash
bash contracts/scripts/generate-abi.sh
```

3. Register contract ABI via CLI:

```bash
npm run -w tools/cli dev -- register --gateway http://127.0.0.1:8787 --contract-id <CONTRACT_ID> --abi-file contracts/abi/registry.json --base-path /api/v1/op [--pricing-config <PATH_TO_PRICING_JSON>]
```

4. Hit discovery endpoints:

```bash
curl -sS http://127.0.0.1:8787/api/v1/discovery/manifest | jq .summary
curl -sS http://127.0.0.1:8787/api/v1/discovery/operations | jq '.operations[] | {id,method,path,paymentRequired,priceStroops}'
```

5. Invoke one free op and one paid flow:

```bash
# Free/read-only example (replace placeholders)
curl -i "http://127.0.0.1:8787/api/v1/op/<CONTRACT_ID>/<READONLY_FUNCTION>" \
	-H "idempotency-key: manual-free-001"

# Paid example: first call should return 402 challenge
curl -i -X POST "http://127.0.0.1:8787/api/v1/op/<CONTRACT_ID>/<PAID_FUNCTION>" \
	-H "content-type: application/json" \
	-H "idempotency-key: manual-paid-001" \
	-d '{}'

# Complete payment with facilitator/wallet, then replay same call with payment proof headers.
```

## Contract deploy flow

Run the deployment script:

bash contracts/scripts/deploy.sh

Required environment variables:

- SOROBAN_NETWORK (testnet or mainnet)
- SOROBAN_ADMIN_ADDRESS
- Either SOROBAN_SOURCE_ALIAS or SOROBAN_SOURCE_ACCOUNT

Additional required variables when SOROBAN_NETWORK_ONLY is not set to 1:

- SOROBAN_RPC_URL
- SOROBAN_NETWORK_PASSPHRASE

Optional deployment controls:

- SOROBAN_NETWORK_ONLY=1: use --network <testnet|mainnet> with --global instead of explicit RPC/passphrase flags
- SKIP_CONTRACT_OPTIMIZE=1: skip soroban contract optimize and deploy release WASM directly

Example (RPC mode):

export SOROBAN_NETWORK=testnet
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export SOROBAN_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
export SOROBAN_SOURCE_ALIAS=<SOURCE_ALIAS_OR_ACCOUNT>
export SOROBAN_ADMIN_ADDRESS=<ADMIN_ADDRESS>

bash contracts/scripts/deploy.sh

## ABI and deployment artifacts

ABI/spec JSON files are auto-generated from contract build output by contracts/scripts/generate-abi.sh:

- contracts/abi/registry.json
- contracts/abi/receipt.json

Deployment metadata is written to contracts/target:

- deployments.<network>.json
- deployments.<network>.env
- registry.optimized.wasm (unless optimization is skipped)
- receipt.optimized.wasm (unless optimization is skipped)

## Operation execution wiring

The gateway executes registered operations through Soroban CLI invocation wiring in services/gateway/src/index.ts and services/gateway/src/stellar/invoker.ts.

## Gateway environment variables

Required for gateway startup:

- GATEWAY_HOST (example: 127.0.0.1)
- GATEWAY_PORT (example: 8787)
- GATEWAY_LOG_LEVEL (debug | info | warn | error)
- STELLAR_NETWORK_PASSPHRASE (example testnet: Test SDF Network ; September 2015)
- GATEWAY_PAY_TO_ADDRESS (recipient address for paid operations)
- GATEWAY_CHALLENGE_TTL_SECONDS (example: 60)
- GATEWAY_MAX_PROOF_AGE_MS (example: 300000)
- GATEWAY_HORIZON_URL (example: https://horizon-testnet.stellar.org)
- GATEWAY_MAX_TX_AGE_MS (example: 600000)
- GATEWAY_X402_FACILITATOR_URL (required by config parser; use real facilitator for x402 mode)
- GATEWAY_IDEMPOTENCY_TTL_MS (example: 600000)

Required for Soroban invocation wiring:

- SOROBAN_SOURCE_ALIAS or SOROBAN_SOURCE_ACCOUNT or SOROBAN_ACCOUNT
- If SOROBAN_NETWORK_ONLY=1: SOROBAN_NETWORK
- Otherwise: SOROBAN_RPC_URL and STELLAR_NETWORK_PASSPHRASE

Required when using MPP mode:

- GATEWAY_PAYMENT_PROVIDER=mpp
- MPP_SECRET_KEY

## Agent access model

Agents can access the bazaar model through the HTTP discovery and operation APIs:

- GET /health
- GET /operations
- GET /api/v1/discovery/manifest
- GET /api/v1/discovery/contracts
- GET /api/v1/discovery/operations
- GET /api/v1/discovery/agent-tools
- GET /api/v1/discovery/proofs
- GET /api/v1/discovery/openapi.json
- POST /api/v1/contracts/register
- GET/POST operation endpoints generated under the registered base path (for example /api/v1/op/...)

Current MCP status:

- MCP runtime exists in-process in the gateway.
- A separate external MCP transport endpoint is not yet exposed; agents currently integrate over HTTP discovery + operation APIs.

## Protocol and Integration Docs

- docs/X402_PROTOCOL_CONTRACT.md
- docs/AGENT_INTEGRATION_GUIDE.md
- docs/E2E_PAID_FLOW_RUNBOOK.md
- docs/TRUST_MINIMIZED_ROADMAP.md

## Provider flow from scratch

This is how a new provider brings a contract into the bazaar.

1. Build and deploy contract(s):

cd contracts
cargo build --target wasm32v1-none --release
bash scripts/deploy.sh

2. Generate ABI files:

bash contracts/scripts/generate-abi.sh

3. Register and publish each contract in one command:

npm run -w tools/cli dev -- publish --gateway http://localhost:8787 --contract-id <REGISTRY_OR_RECEIPT_CONTRACT_ID> --abi-file <ABI_JSON_PATH> --base-path /api/v1/op [--pricing-config <PATH_TO_PRICING_JSON>]

Alternative (register only):

npm run -w tools/cli dev -- register --gateway http://localhost:8787 --contract-id <REGISTRY_OR_RECEIPT_CONTRACT_ID> --abi-file <ABI_JSON_PATH> --base-path /api/v1/op [--pricing-config <PATH_TO_PRICING_JSON>]

4. Verify discovery surfaces include your contract:

curl -sS http://localhost:8787/api/v1/discovery/manifest | jq .summary
curl -sS http://localhost:8787/api/v1/discovery/contracts | jq .contracts
curl -sS http://localhost:8787/api/v1/discovery/openapi.json | jq '.paths | keys'

5. Share your machine-readable links with agent builders:

- /api/v1/discovery/manifest
- /api/v1/discovery/operations
- /api/v1/discovery/openapi.json
- /api/v1/discovery/agent-tools

## Agent usage flow

This is how agent clients discover and call tools.

1. Discover capabilities:

curl -sS http://localhost:8787/api/v1/discovery/manifest | jq .
curl -sS http://localhost:8787/api/v1/discovery/operations | jq '.operations[] | {id,method,path,paymentRequired,priceStroops}'
curl -sS http://localhost:8787/api/v1/discovery/agent-tools | jq .tools

The agent-tools endpoint is the direct machine bundle for agents: it includes invocation fields, idempotency and payment headers, and request inputSchema per tool.

2. Pick an operation and call it with idempotency:

curl -i -X GET "http://localhost:8787/api/v1/op/<contract>/<function>" -H "idempotency-key: agent-run-001"

3. If 402 is returned, complete payment challenge flow, then replay with payment proof headers.

4. Read proofs and explorer links for audit trail:

curl -sS "http://localhost:8787/api/v1/discovery/proofs?limit=10" | jq .proofs

## Generate agent tools from discovery

The generator now prefers the native endpoint below as canonical source:

- GET /api/v1/discovery/agent-tools

If that endpoint is unavailable (404 or fetch failure), the generator falls back to composing from manifest + operations + OpenAPI discovery. Output format and CLI args stay the same.

Generate tool definitions:

```bash
npm run agent:tools
```

```bash
npm run agent:tools -- --gateway http://localhost:8787 --out artifacts/agent-tools.md --format markdown
```

Fallback inputs when native endpoint is unavailable:

- GET /api/v1/discovery/manifest
- GET /api/v1/discovery/operations
- GET /api/v1/discovery/openapi.json

## Publishing the CLI

Package: @synapse/cli

1. Validate package locally:

cd tools/cli
npm run typecheck
npm run build
npm run publish:check

2. Publish public package:

npm publish --access public

3. Consumers can then install and register contracts:

npm install -g @synapse/cli
synapse register --gateway http://localhost:8787 --contract-id <ID> --abi-file <PATH> --base-path /api/v1/op [--pricing-config <PATH_TO_PRICING_JSON>]
