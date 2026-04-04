#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
TARGET_DIR="${CONTRACTS_DIR}/target"
DEPLOY_SCRIPT="${CONTRACTS_DIR}/scripts/deploy.sh"
REGISTRY_ABI_PATH="${CONTRACTS_DIR}/abi/registry.json"
RECEIPT_ABI_PATH="${CONTRACTS_DIR}/abi/receipt.json"

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: Required command '${cmd}' is not installed or not in PATH." >&2
    exit 1
  fi
}

require_command jq
require_command curl
require_command npm

SOROBAN_NETWORK="${SOROBAN_NETWORK:-testnet}"
export SOROBAN_NETWORK

case "${SOROBAN_NETWORK}" in
  testnet)
    DEFAULT_PASSPHRASE="Test SDF Network ; September 2015"
    EXPLORER_BASE="https://stellar.expert/explorer/testnet"
    ;;
  mainnet)
    DEFAULT_PASSPHRASE="Public Global Stellar Network ; September 2015"
    EXPLORER_BASE="https://stellar.expert/explorer/public"
    ;;
  *)
    DEFAULT_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-}"
    EXPLORER_BASE="https://stellar.expert/explorer/testnet"
    ;;
esac

GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-4021}"
GATEWAY_LOG_LEVEL="${GATEWAY_LOG_LEVEL:-info}"
STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-${DEFAULT_PASSPHRASE}}"
GATEWAY_CHALLENGE_TTL_SECONDS="${GATEWAY_CHALLENGE_TTL_SECONDS:-60}"
GATEWAY_MAX_PROOF_AGE_MS="${GATEWAY_MAX_PROOF_AGE_MS:-300000}"
GATEWAY_HORIZON_URL="${GATEWAY_HORIZON_URL:-https://horizon-testnet.stellar.org}"
GATEWAY_MAX_TX_AGE_MS="${GATEWAY_MAX_TX_AGE_MS:-600000}"
GATEWAY_X402_FACILITATOR_URL="${GATEWAY_X402_FACILITATOR_URL:-https://example.invalid}"
GATEWAY_IDEMPOTENCY_TTL_MS="${GATEWAY_IDEMPOTENCY_TTL_MS:-600000}"

echo "Running deploy script..."
bash "${DEPLOY_SCRIPT}"

DEPLOYMENTS_FILE="${TARGET_DIR}/deployments.${SOROBAN_NETWORK}.json"
if [[ ! -f "${DEPLOYMENTS_FILE}" ]]; then
  echo "Error: Expected deployment file not found: ${DEPLOYMENTS_FILE}" >&2
  exit 1
fi

registry_contract_id="$(jq -r '.registryContractId' "${DEPLOYMENTS_FILE}")"
receipt_contract_id="$(jq -r '.receiptContractId' "${DEPLOYMENTS_FILE}")"
admin_address="$(jq -r '.adminAddress' "${DEPLOYMENTS_FILE}")"
source_account="$(jq -r '.sourceAccount' "${DEPLOYMENTS_FILE}")"
deployed_at_unix="$(jq -r '.deployedAtUnix' "${DEPLOYMENTS_FILE}")"

if [[ -z "${registry_contract_id}" || "${registry_contract_id}" == "null" ]]; then
  echo "Error: Missing registryContractId in ${DEPLOYMENTS_FILE}" >&2
  exit 1
fi
if [[ -z "${receipt_contract_id}" || "${receipt_contract_id}" == "null" ]]; then
  echo "Error: Missing receiptContractId in ${DEPLOYMENTS_FILE}" >&2
  exit 1
fi
if [[ -z "${admin_address}" || "${admin_address}" == "null" ]]; then
  echo "Error: Missing adminAddress in ${DEPLOYMENTS_FILE}" >&2
  exit 1
fi
if [[ -z "${source_account}" || "${source_account}" == "null" ]]; then
  echo "Error: Missing sourceAccount in ${DEPLOYMENTS_FILE}" >&2
  exit 1
fi

GATEWAY_PAY_TO_ADDRESS="${GATEWAY_PAY_TO_ADDRESS:-${admin_address}}"
GATEWAY_URL="http://${GATEWAY_HOST}:${GATEWAY_PORT}"

gateway_log="${TARGET_DIR}/gateway-e2e.log"
gateway_pid=""

cleanup() {
  if [[ -n "${gateway_pid}" ]] && kill -0 "${gateway_pid}" >/dev/null 2>&1; then
    kill "${gateway_pid}" >/dev/null 2>&1 || true
    wait "${gateway_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting gateway at ${GATEWAY_URL}..."
(
  cd "${ROOT_DIR}"
  GATEWAY_HOST="${GATEWAY_HOST}" \
  GATEWAY_PORT="${GATEWAY_PORT}" \
  GATEWAY_LOG_LEVEL="${GATEWAY_LOG_LEVEL}" \
  STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE}" \
  GATEWAY_PAY_TO_ADDRESS="${GATEWAY_PAY_TO_ADDRESS}" \
  GATEWAY_CHALLENGE_TTL_SECONDS="${GATEWAY_CHALLENGE_TTL_SECONDS}" \
  GATEWAY_MAX_PROOF_AGE_MS="${GATEWAY_MAX_PROOF_AGE_MS}" \
  GATEWAY_HORIZON_URL="${GATEWAY_HORIZON_URL}" \
  GATEWAY_MAX_TX_AGE_MS="${GATEWAY_MAX_TX_AGE_MS}" \
  GATEWAY_X402_FACILITATOR_URL="${GATEWAY_X402_FACILITATOR_URL}" \
  GATEWAY_IDEMPOTENCY_TTL_MS="${GATEWAY_IDEMPOTENCY_TTL_MS}" \
  SOROBAN_NETWORK_ONLY=1 \
  SOROBAN_NETWORK="${SOROBAN_NETWORK}" \
  SOROBAN_SOURCE_ALIAS="${source_account}" \
  npm run -w services/gateway dev
) >"${gateway_log}" 2>&1 &
gateway_pid="$!"

echo "Waiting for gateway health check..."
health_ok=0
for _ in $(seq 1 30); do
  if curl -fsS "${GATEWAY_URL}/operations" >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  sleep 1
done

if [[ "${health_ok}" -ne 1 ]]; then
  echo "Error: Gateway did not become healthy within 30 seconds." >&2
  echo "Gateway log: ${gateway_log}" >&2
  exit 1
fi

set +e
register_registry_output="$(npm run -w tools/cli dev -- register --gateway "${GATEWAY_URL}" --contract-id "${registry_contract_id}" --abi-file "${REGISTRY_ABI_PATH}" --base-path /api/v1/op 2>&1)"
register_registry_exit="$?"
register_registry_status="ok"
if [[ "${register_registry_exit}" -ne 0 ]]; then
  if [[ "${register_registry_output}" == *"Duplicate operation id"* ]]; then
    register_registry_exit=0
    register_registry_status="duplicate-ok"
  else
    register_registry_status="failed"
  fi
fi

register_receipt_output="$(npm run -w tools/cli dev -- register --gateway "${GATEWAY_URL}" --contract-id "${receipt_contract_id}" --abi-file "${RECEIPT_ABI_PATH}" --base-path /api/v1/op 2>&1)"
register_receipt_exit="$?"
register_receipt_status="ok"
if [[ "${register_receipt_exit}" -ne 0 ]]; then
  if [[ "${register_receipt_output}" == *"Duplicate operation id"* ]]; then
    register_receipt_exit=0
    register_receipt_status="duplicate-ok"
  else
    register_receipt_status="failed"
  fi
fi
set -e

timestamp="$(date +%s)"
idempotency_key="e2e-${timestamp}"
invoke_tmp="$(mktemp)"
invoke_status="$(curl -sS -o "${invoke_tmp}" -w "%{http_code}" -X POST "${GATEWAY_URL}/api/v1/op/${receipt_contract_id}/set_admin" -H "content-type: application/json" -H "idempotency-key: ${idempotency_key}" -d "{\"new_admin\":\"${admin_address}\"}")"

operations_json="$(curl -sS "${GATEWAY_URL}/operations" || echo '[]')"
operations_count="$(printf '%s' "${operations_json}" | jq -r 'if type=="array" then length elif (type=="object" and (.operations? | type) == "array") then .operations|length elif (type=="object" and (.data? | type) == "array") then .data|length else 0 end')"

invoke_response_json="$(jq -Rs 'try fromjson catch .' "${invoke_tmp}")"
tx_hash="$(printf '%s' "${invoke_response_json}" | jq -r 'if type=="object" then (.txHash // .result.txHash? // .data.txHash? // empty) else empty end')"

output_file="${TARGET_DIR}/e2e-proof.${timestamp}.json"

jq -n \
  --argjson deployedAtUnix "${deployed_at_unix}" \
  --arg registryContractId "${registry_contract_id}" \
  --arg receiptContractId "${receipt_contract_id}" \
  --arg adminAddress "${admin_address}" \
  --arg gatewayUrl "${GATEWAY_URL}" \
  --argjson registerRegistryExit "${register_registry_exit}" \
  --argjson registerReceiptExit "${register_receipt_exit}" \
  --arg registerRegistryStatus "${register_registry_status}" \
  --arg registerReceiptStatus "${register_receipt_status}" \
  --arg registerRegistryOutput "${register_registry_output:0:800}" \
  --arg registerReceiptOutput "${register_receipt_output:0:800}" \
  --argjson invokeHttpStatus "${invoke_status}" \
  --argjson invokeResponse "${invoke_response_json}" \
  --argjson operationsCount "${operations_count}" \
  --arg txHash "${tx_hash}" \
  --arg explorerBase "${EXPLORER_BASE}" \
  '(
    {
      deployedAtUnix: $deployedAtUnix,
      registryContractId: $registryContractId,
      receiptContractId: $receiptContractId,
      adminAddress: $adminAddress,
      gatewayUrl: $gatewayUrl,
      registerRegistryExit: $registerRegistryExit,
      registerReceiptExit: $registerReceiptExit,
      registerRegistryStatus: $registerRegistryStatus,
      registerReceiptStatus: $registerReceiptStatus,
      registerRegistryOutput: $registerRegistryOutput,
      registerReceiptOutput: $registerReceiptOutput,
      invokeHttpStatus: $invokeHttpStatus,
      invokeResponse: $invokeResponse,
      operationsCount: $operationsCount,
      explorerLinks: {
        registryContract: ($explorerBase + "/contract/" + $registryContractId),
        receiptContract: ($explorerBase + "/contract/" + $receiptContractId)
      }
    }
    + (if ($txHash | length) > 0 then {
        txHash: $txHash,
        explorerLinks: {
          registryContract: ($explorerBase + "/contract/" + $registryContractId),
          receiptContract: ($explorerBase + "/contract/" + $receiptContractId),
          tx: ($explorerBase + "/tx/" + $txHash)
        }
      } else {} end)
  )' >"${output_file}"

rm -f "${invoke_tmp}"

echo "E2E proof artifact: ${output_file}"
echo "Gateway log: ${gateway_log}"
