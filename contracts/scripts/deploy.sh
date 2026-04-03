#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
TARGET_DIR="${CONTRACTS_DIR}/target"
ABI_SCRIPT="${CONTRACTS_DIR}/scripts/generate-abi.sh"

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

if command -v stellar >/dev/null 2>&1; then
  CONTRACT_CLI="stellar"
elif command -v soroban >/dev/null 2>&1; then
  CONTRACT_CLI="soroban"
else
  echo "Error: Required command 'stellar' or 'soroban' is not installed or not in PATH." >&2
  exit 1
fi

require_command cargo
require_command jq

require_env SOROBAN_NETWORK
require_env SOROBAN_ADMIN_ADDRESS

case "${SOROBAN_NETWORK}" in
  testnet|mainnet)
    ;;
  *)
    echo "Error: SOROBAN_NETWORK must be either 'testnet' or 'mainnet'." >&2
    exit 1
    ;;
esac

if [[ -n "${SOROBAN_SOURCE_ALIAS:-}" ]]; then
  SOURCE_ACCOUNT="${SOROBAN_SOURCE_ALIAS}"
  SIGNER_MODE="source alias"
elif [[ -n "${SOROBAN_SOURCE_ACCOUNT:-}" ]]; then
  SOURCE_ACCOUNT="${SOROBAN_SOURCE_ACCOUNT}"
  SIGNER_MODE="source account"
else
  echo "Error: Set either SOROBAN_SOURCE_ALIAS or SOROBAN_SOURCE_ACCOUNT." >&2
  exit 1
fi

NETWORK_ONLY="${SOROBAN_NETWORK_ONLY:-0}"
NETWORK_ARGS=()
NETWORK_SUMMARY=""

if [[ "${NETWORK_ONLY}" == "1" ]]; then
  NETWORK_ARGS=(
    --network "${SOROBAN_NETWORK}"
    --global
  )
  NETWORK_SUMMARY="network-only (--network ${SOROBAN_NETWORK} --global)"
else
  require_env SOROBAN_RPC_URL
  require_env SOROBAN_NETWORK_PASSPHRASE
  NETWORK_ARGS=(
    --rpc-url "${SOROBAN_RPC_URL}"
    --network-passphrase "${SOROBAN_NETWORK_PASSPHRASE}"
  )
  NETWORK_SUMMARY="rpc mode (${SOROBAN_RPC_URL})"
fi

echo "Building contracts (target: wasm32v1-none, profile: release)..."
(
  cd "${CONTRACTS_DIR}"
  cargo build --target wasm32v1-none --release
)

REGISTRY_WASM_IN="${TARGET_DIR}/wasm32v1-none/release/registry.wasm"
RECEIPT_WASM_IN="${TARGET_DIR}/wasm32v1-none/release/receipt.wasm"
REGISTRY_WASM_OPT="${TARGET_DIR}/registry.optimized.wasm"
RECEIPT_WASM_OPT="${TARGET_DIR}/receipt.optimized.wasm"
SKIP_CONTRACT_OPTIMIZE="${SKIP_CONTRACT_OPTIMIZE:-0}"

if [[ "${SKIP_CONTRACT_OPTIMIZE}" == "1" ]]; then
  echo "Contract optimization: skipped (SKIP_CONTRACT_OPTIMIZE=1). Using release WASM artifacts."
  REGISTRY_WASM_DEPLOY="${REGISTRY_WASM_IN}"
  RECEIPT_WASM_DEPLOY="${RECEIPT_WASM_IN}"
else
  echo "Contract optimization: enabled. Generating optimized WASM artifacts."

  echo "Optimizing registry contract..."
  "${CONTRACT_CLI}" contract optimize \
    --wasm "${REGISTRY_WASM_IN}" \
    --wasm-out "${REGISTRY_WASM_OPT}"

  echo "Optimizing receipt contract..."
  "${CONTRACT_CLI}" contract optimize \
    --wasm "${RECEIPT_WASM_IN}" \
    --wasm-out "${RECEIPT_WASM_OPT}"

  REGISTRY_WASM_DEPLOY="${REGISTRY_WASM_OPT}"
  RECEIPT_WASM_DEPLOY="${RECEIPT_WASM_OPT}"
fi

echo "Signer mode: ${SIGNER_MODE} (${SOURCE_ACCOUNT})"
echo "Connection mode: ${NETWORK_SUMMARY}"

echo "Deploying registry contract..."
REGISTRY_CONTRACT_ID="$("${CONTRACT_CLI}" contract deploy \
  --wasm "${REGISTRY_WASM_DEPLOY}" \
  "${NETWORK_ARGS[@]}" \
  --source-account "${SOURCE_ACCOUNT}")"

echo "Deploying receipt contract..."
RECEIPT_CONTRACT_ID="$("${CONTRACT_CLI}" contract deploy \
  --wasm "${RECEIPT_WASM_DEPLOY}" \
  "${NETWORK_ARGS[@]}" \
  --source-account "${SOURCE_ACCOUNT}")"

echo "Initializing registry contract..."
"${CONTRACT_CLI}" contract invoke \
  --id "${REGISTRY_CONTRACT_ID}" \
  "${NETWORK_ARGS[@]}" \
  --source-account "${SOURCE_ACCOUNT}" \
  -- \
  init \
  --admin "${SOROBAN_ADMIN_ADDRESS}"

echo "Initializing receipt contract..."
"${CONTRACT_CLI}" contract invoke \
  --id "${RECEIPT_CONTRACT_ID}" \
  "${NETWORK_ARGS[@]}" \
  --source-account "${SOURCE_ACCOUNT}" \
  -- \
  init \
  --admin "${SOROBAN_ADMIN_ADDRESS}"

DEPLOYED_AT_UNIX="$(date +%s)"
DEPLOYMENTS_JSON="${TARGET_DIR}/deployments.${SOROBAN_NETWORK}.json"
DEPLOYMENTS_ENV="${TARGET_DIR}/deployments.${SOROBAN_NETWORK}.env"
RPC_URL_VALUE="${SOROBAN_RPC_URL:-}"

jq -n \
  --arg network "${SOROBAN_NETWORK}" \
  --arg rpcUrl "${RPC_URL_VALUE}" \
  --arg networkMode "${NETWORK_SUMMARY}" \
  --arg sourceAccount "${SOURCE_ACCOUNT}" \
  --arg registryContractId "${REGISTRY_CONTRACT_ID}" \
  --arg receiptContractId "${RECEIPT_CONTRACT_ID}" \
  --arg adminAddress "${SOROBAN_ADMIN_ADDRESS}" \
  --argjson deployedAtUnix "${DEPLOYED_AT_UNIX}" \
  '{
    network: $network,
    rpcUrl: $rpcUrl,
    networkMode: $networkMode,
    sourceAccount: $sourceAccount,
    registryContractId: $registryContractId,
    receiptContractId: $receiptContractId,
    adminAddress: $adminAddress,
    deployedAtUnix: $deployedAtUnix
  }' >"${DEPLOYMENTS_JSON}"

cat > "${DEPLOYMENTS_ENV}" <<ENVEOF
export SYNAPSE_STELLAR_NETWORK="${SOROBAN_NETWORK}"
export SYNAPSE_SOROBAN_RPC_URL="${RPC_URL_VALUE}"
export SYNAPSE_REGISTRY_CONTRACT_ID="${REGISTRY_CONTRACT_ID}"
export SYNAPSE_RECEIPT_CONTRACT_ID="${RECEIPT_CONTRACT_ID}"
export SYNAPSE_ADMIN_ADDRESS="${SOROBAN_ADMIN_ADDRESS}"
ENVEOF

echo "Regenerating ABI/spec JSON artifacts..."
bash "${ABI_SCRIPT}"

echo "Deployment complete"
echo "Network: ${SOROBAN_NETWORK}"
echo "Connection mode: ${NETWORK_SUMMARY}"
if [[ -n "${RPC_URL_VALUE}" ]]; then
  echo "RPC URL: ${RPC_URL_VALUE}"
fi
echo "Registry contract ID: ${REGISTRY_CONTRACT_ID}"
echo "Receipt contract ID: ${RECEIPT_CONTRACT_ID}"
echo "Admin address: ${SOROBAN_ADMIN_ADDRESS}"
echo "JSON artifact: ${DEPLOYMENTS_JSON}"
echo "ENV artifact: ${DEPLOYMENTS_ENV}"
