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

## Local run order

1. Start the gateway:

npm run -w services/gateway dev

2. Generate ABI JSON from built contracts:

bash contracts/scripts/generate-abi.sh

3. Register a contract ABI with the CLI:

npm run -w tools/cli dev -- register --gateway http://localhost:8787 --contract-id <CONTRACT_ID> --abi-file <PATH_TO_ABI_JSON> --base-path /v1/ops

When using auto-generated Soroban ABI specs through CLI conversion, non-readonly functions are registered as paid by default (100 stroops).

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

## Known gap

The operation executor in services/gateway/src/index.ts is still a placeholder and currently returns an internal error until invocation wiring is implemented.
