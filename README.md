# Synapse

Synapse is a StellarMCP Gateway that turns Soroban contract ABIs into a unified interface exposed as x402-paid HTTP APIs and MCP tools, producing verifiable proof for each paid invocation from request through settlement and result.

## Quickstart prerequisites

- Node.js 20+
- npm 10+
- Rust toolchain
- Rust target wasm32v1-none
- Soroban CLI
- jq

Install workspace dependencies:

npm install

Install the Rust target (once):

rustup target add wasm32v1-none

## Local run order

1. Start the gateway:

npm run -w services/gateway dev

2. Register a contract ABI with the CLI:

npm run -w tools/cli dev -- register --gateway http://localhost:8787 --contract-id <CONTRACT_ID> --abi-file <PATH_TO_ABI_JSON> --base-path /v1/ops

## Contract deploy flow

Run the deployment script:

bash contracts/scripts/deploy.sh

Required environment variables:

- SOROBAN_NETWORK (testnet or mainnet)
- SOROBAN_RPC_URL
- SOROBAN_NETWORK_PASSPHRASE
- SOROBAN_SOURCE_ACCOUNT
- SOROBAN_SOURCE_SECRET
- SOROBAN_ADMIN_ADDRESS

Example:

export SOROBAN_NETWORK=testnet
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export SOROBAN_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
export SOROBAN_SOURCE_ACCOUNT=<SOURCE_ACCOUNT>
export SOROBAN_SOURCE_SECRET=<SOURCE_SECRET>
export SOROBAN_ADMIN_ADDRESS=<ADMIN_ADDRESS>

bash contracts/scripts/deploy.sh

## Artifacts output

The deploy script writes to contracts/artifacts:

- registry.optimized.wasm
- receipt.optimized.wasm
- deployments.<network>.json
- deployments.<network>.env

## Known gap

The operation executor in services/gateway/src/index.ts is still a placeholder and currently returns an internal error until invocation wiring is implemented.
