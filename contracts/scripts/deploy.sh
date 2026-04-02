#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
ARTIFACTS_DIR="${CONTRACTS_DIR}/artifacts"

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: Required command '${cmd}' is not installed or not in PATH." >&2
    exit 1
  fi
}

require_env() {
  local var_name="$1"
  if [[ -z "${!var_name:-}" ]]; then
    echo "Error: Required environment variable ${var_name} is not set." >&2
    exit 1
  fi
}

require_command soroban
require_command cargo
require_command jq

require_env SOROBAN_NETWORK
require_env SOROBAN_RPC_URL
require_env SOROBAN_NETWORK_PASSPHRASE
require_env SOROBAN_SOURCE_ACCOUNT
require_env SOROBAN_SOURCE_SECRET
require_env SOROBAN_ADMIN_ADDRESS

case "${SOROBAN_NETWORK}" in
  testnet|mainnet)
    ;;
  *)
    echo "Error: SOROBAN_NETWORK must be either 'testnet' or 'mainnet'." >&2
    exit 1
    ;;
esac

mkdir -p "${ARTIFACTS_DIR}"

echo "Building contracts (target: wasm32v1-none, profile: release)..."
(
  cd "${CONTRACTS_DIR}"
  cargo build --target wasm32v1-none --release
)

REGISTRY_WASM_IN="${CONTRACTS_DIR}/target/wasm32v1-none/release/registry.wasm"
RECEIPT_WASM_IN="${CONTRACTS_DIR}/target/wasm32v1-none/release/receipt.wasm"
REGISTRY_WASM_OPT="${ARTIFACTS_DIR}/registry.optimized.wasm"
RECEIPT_WASM_OPT="${ARTIFACTS_DIR}/receipt.optimized.wasm"

echo "Optimizing registry contract..."
soroban contract optimize \
  --wasm "${REGISTRY_WASM_IN}" \
  --wasm-out "${REGISTRY_WASM_OPT}"

echo "Optimizing receipt contract..."
soroban contract optimize \
  --wasm "${RECEIPT_WASM_IN}" \
  --wasm-out "${RECEIPT_WASM_OPT}"

echo "Deploying registry contract..."
REGISTRY_CONTRACT_ID="$(soroban contract deploy \
  --wasm "${REGISTRY_WASM_OPT}" \
  --rpc-url "${SOROBAN_RPC_URL}" \
  --network-passphrase "${SOROBAN_NETWORK_PASSPHRASE}" \
  --source-account "${SOROBAN_SOURCE_ACCOUNT}" \
  --secret-key "${SOROBAN_SOURCE_SECRET}")"

echo "Deploying receipt contract..."
RECEIPT_CONTRACT_ID="$(soroban contract deploy \
  --wasm "${RECEIPT_WASM_OPT}" \
  --rpc-url "${SOROBAN_RPC_URL}" \
  --network-passphrase "${SOROBAN_NETWORK_PASSPHRASE}" \
  --source-account "${SOROBAN_SOURCE_ACCOUNT}" \
  --secret-key "${SOROBAN_SOURCE_SECRET}")"

echo "Initializing registry contract..."
soroban contract invoke \
  --id "${REGISTRY_CONTRACT_ID}" \
  --rpc-url "${SOROBAN_RPC_URL}" \
  --network-passphrase "${SOROBAN_NETWORK_PASSPHRASE}" \
  --source-account "${SOROBAN_SOURCE_ACCOUNT}" \
  --secret-key "${SOROBAN_SOURCE_SECRET}" \
  -- \
  init \
  --admin "${SOROBAN_ADMIN_ADDRESS}"

echo "Initializing receipt contract..."
soroban contract invoke \
  --id "${RECEIPT_CONTRACT_ID}" \
  --rpc-url "${SOROBAN_RPC_URL}" \
  --network-passphrase "${SOROBAN_NETWORK_PASSPHRASE}" \
  --source-account "${SOROBAN_SOURCE_ACCOUNT}" \
  --secret-key "${SOROBAN_SOURCE_SECRET}" \
  -- \
  init \
  --admin "${SOROBAN_ADMIN_ADDRESS}"

DEPLOYED_AT_UNIX="$(date +%s)"
DEPLOYMENTS_JSON="${ARTIFACTS_DIR}/deployments.${SOROBAN_NETWORK}.json"
DEPLOYMENTS_ENV="${ARTIFACTS_DIR}/deployments.${SOROBAN_NETWORK}.env"

jq -n \
  --arg network "${SOROBAN_NETWORK}" \
  --arg rpcUrl "${SOROBAN_RPC_URL}" \
  --arg registryContractId "${REGISTRY_CONTRACT_ID}" \
  --arg receiptContractId "${RECEIPT_CONTRACT_ID}" \
  --arg adminAddress "${SOROBAN_ADMIN_ADDRESS}" \
  --argjson deployedAtUnix "${DEPLOYED_AT_UNIX}" \
  '{
    network: $network,
    rpcUrl: $rpcUrl,
    registryContractId: $registryContractId,
    receiptContractId: $receiptContractId,
    adminAddress: $adminAddress,
    deployedAtUnix: $deployedAtUnix
  }' >"${DEPLOYMENTS_JSON}"

cat > "${DEPLOYMENTS_ENV}" <<ENVEOF
export SYNAPSE_STELLAR_NETWORK="${SOROBAN_NETWORK}"
export SYNAPSE_SOROBAN_RPC_URL="${SOROBAN_RPC_URL}"
export SYNAPSE_REGISTRY_CONTRACT_ID="${REGISTRY_CONTRACT_ID}"
export SYNAPSE_RECEIPT_CONTRACT_ID="${RECEIPT_CONTRACT_ID}"
export SYNAPSE_ADMIN_ADDRESS="${SOROBAN_ADMIN_ADDRESS}"
ENVEOF

echo "Deployment complete"
echo "Network: ${SOROBAN_NETWORK}"
echo "RPC URL: ${SOROBAN_RPC_URL}"
echo "Registry contract ID: ${REGISTRY_CONTRACT_ID}"
echo "Receipt contract ID: ${RECEIPT_CONTRACT_ID}"
echo "Admin address: ${SOROBAN_ADMIN_ADDRESS}"
echo "JSON artifact: ${DEPLOYMENTS_JSON}"
echo "ENV artifact: ${DEPLOYMENTS_ENV}"
