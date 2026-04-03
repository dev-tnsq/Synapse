#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
TARGET_DIR="${CONTRACTS_DIR}/target"
ABI_DIR="${CONTRACTS_DIR}/abi"

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: Required command '${cmd}' is not installed or not in PATH." >&2
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

if [[ ! -d "${ABI_DIR}" ]]; then
  echo "Error: ABI directory '${ABI_DIR}' does not exist. Create contracts/abi once manually, then rerun this script." >&2
  exit 1
fi

echo "Building contracts (target: wasm32v1-none, profile: release)..."
(
  cd "${CONTRACTS_DIR}"
  cargo build --target wasm32v1-none --release
)

REGISTRY_WASM="${TARGET_DIR}/wasm32v1-none/release/registry.wasm"
RECEIPT_WASM="${TARGET_DIR}/wasm32v1-none/release/receipt.wasm"
REGISTRY_ABI="${ABI_DIR}/registry.json"
RECEIPT_ABI="${ABI_DIR}/receipt.json"

echo "Generating ABI/spec JSON for registry..."
"${CONTRACT_CLI}" contract bindings json --wasm "${REGISTRY_WASM}" > "${REGISTRY_ABI}"

echo "Generating ABI/spec JSON for receipt..."
"${CONTRACT_CLI}" contract bindings json --wasm "${RECEIPT_WASM}" > "${RECEIPT_ABI}"

echo "ABI generation complete"
echo "Registry ABI: ${REGISTRY_ABI}"
echo "Receipt ABI: ${RECEIPT_ABI}"
