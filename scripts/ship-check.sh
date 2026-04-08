#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

source_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
}

run_section() {
  local title="$1"
  local cmd="$2"

  echo
  echo "==> ${title}"
  ${cmd}
}

source_env_file "${ROOT_DIR}/.env"
source_env_file "${ROOT_DIR}/services/gateway/.env"

run_section "Checking gateway database status" "npm run gateway:db:status"
run_section "Building gateway" "npm run -w services/gateway build"
run_section "Building CLI" "npm run -w tools/cli build"
run_section "Building web app" "npm run -w apps/web build"
run_section "Running provider smoke checks" "npm run provider:smoke"

echo
echo "PASS: ship check completed successfully"