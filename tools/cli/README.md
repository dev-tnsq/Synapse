# Synapse CLI

## Install

npm install -g @synapse/cli

## Commands

### register

Register a contract ABI with the Synapse gateway.

synapse register --gateway <url> --contract-id <id> --abi-file <path> [--base-path <path>]

Options:
- --gateway: Gateway base URL. Default: http://localhost:8787
- --contract-id: Contract ID to register (required)
- --abi-file: Path to ABI JSON file (required)
- --base-path: Base path for generated routes. Default: /v1/ops

## Example invocation

synapse register --gateway http://localhost:8787 --contract-id CABCDEF1234567890 --abi-file ./abi/contract.json --base-path /v1/ops

## Publish checklist

npm run typecheck
npm run build
npm run publish:check
npm publish --access public
