#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="${ROOT_DIR}/contracts/scripts/deploy.sh"

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: Required command '${cmd}' is not installed or not in PATH." >&2
    exit 1
  fi
}

require_command stellar

NEW_ALIAS_DEFAULT="synapse-deployer-$(date +%Y%m%d-%H%M%S)"
NEW_ALIAS="${NEW_DEPLOYER_ALIAS:-${NEW_ALIAS_DEFAULT}}"
SOROBAN_NETWORK="${SOROBAN_NETWORK:-testnet}"
export SOROBAN_NETWORK

if stellar keys address "${NEW_ALIAS}" >/dev/null 2>&1; then
  echo "Using existing alias: ${NEW_ALIAS}"
else
  echo "Creating alias: ${NEW_ALIAS}"
  if ! stellar keys generate "${NEW_ALIAS}" >/dev/null 2>&1; then
    echo "Error: Failed to generate alias '${NEW_ALIAS}'." >&2
    exit 1
  fi
fi

ALIAS_ADDRESS="$(stellar keys address "${NEW_ALIAS}")"

if [[ "${SOROBAN_NETWORK}" == "testnet" ]]; then
  echo "Funding alias on testnet: ${NEW_ALIAS}"
  stellar keys fund "${NEW_ALIAS}" --network testnet >/dev/null
fi

export SOROBAN_SOURCE_ALIAS="${NEW_ALIAS}"
if [[ -z "${SOROBAN_ADMIN_ADDRESS:-}" ]]; then
  export SOROBAN_ADMIN_ADDRESS="${ALIAS_ADDRESS}"
fi

bash "${DEPLOY_SCRIPT}"

DEPLOYMENT_FILE="${ROOT_DIR}/contracts/target/deployments.${SOROBAN_NETWORK}.json"

echo "Alias: ${NEW_ALIAS}"
echo "Address: ${ALIAS_ADDRESS}"
echo "Deployment file: ${DEPLOYMENT_FILE}"
