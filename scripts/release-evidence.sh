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

source_env_file "${ROOT_DIR}/.env"
source_env_file "${ROOT_DIR}/services/gateway/.env"

mkdir -p "${ROOT_DIR}/artifacts/runtime-logs"

timestamp="$(date +%Y%m%d-%H%M%S)"
report_path="${ROOT_DIR}/artifacts/runtime-logs/release-evidence.${timestamp}.md"

http_code() {
  local url="$1"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "${url}" || true)"
  if [[ -z "${code}" ]]; then
    code="000"
  fi
  printf '%s' "${code}"
}

listener_status() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    echo "UNKNOWN (lsof not installed)"
    return
  fi

  local row
  row="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sed -n '2p' || true)"
  if [[ -n "${row}" ]]; then
    echo "LISTEN"
  else
    echo "NOT_LISTENING"
  fi
}

pg_status="UNKNOWN"
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    pg_status="READY"
  else
    pg_status="NOT_READY"
  fi
else
  pg_status="UNAVAILABLE (pg_isready not installed)"
fi

provider_smoke_status="PASS"
provider_smoke_output_file="$(mktemp)"
set +e
npm run provider:smoke >"${provider_smoke_output_file}" 2>&1
provider_smoke_exit=$?
set -e
if [[ ${provider_smoke_exit} -ne 0 ]]; then
  provider_smoke_status="FAIL"
fi
provider_smoke_snippet="$(tail -n 30 "${provider_smoke_output_file}")"
rm -f "${provider_smoke_output_file}"

git_status_tail="$(git status --short | tail -n 20 || true)"
git_changed_lines="$(git diff --numstat HEAD 2>/dev/null | awk '{if ($1 ~ /^[0-9]+$/) add += $1; if ($2 ~ /^[0-9]+$/) del += $2} END {print (add + del + 0)}')"

{
  echo "# Release Evidence"
  echo
  echo "- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- PWD: ${ROOT_DIR}"
  echo
  echo "## Environment"
  echo
  echo "- date: $(date)"
  echo "- pwd: $(pwd)"
  echo "- node: $(node -v 2>/dev/null || echo 'UNAVAILABLE')"
  echo "- npm: $(npm -v 2>/dev/null || echo 'UNAVAILABLE')"
  echo
  echo "## Listener Checks"
  echo
  echo "- 8787: $(listener_status 8787)"
  echo "- 3000: $(listener_status 3000)"
  echo "- 3001: $(listener_status 3001)"
  echo
  echo "## Postgres Readiness"
  echo
  echo "- pg_isready 127.0.0.1:5432: ${pg_status}"
  echo
  echo "## Endpoint Status Codes"
  echo
  echo "- 8787 /health: $(http_code "http://127.0.0.1:8787/health")"
  echo "- 8787 /api/v1/discovery/manifest: $(http_code "http://127.0.0.1:8787/api/v1/discovery/manifest")"
  echo "- 8787 /api/v1/discovery/operations: $(http_code "http://127.0.0.1:8787/api/v1/discovery/operations")"
  echo "- 8787 /api/v1/discovery/agent-tools: $(http_code "http://127.0.0.1:8787/api/v1/discovery/agent-tools")"
  echo "- 3001 /: $(http_code "http://127.0.0.1:3001/")"
  echo "- 3000 /: $(http_code "http://127.0.0.1:3000/")"
  echo
  echo "## Provider Smoke"
  echo
  echo "- command: npm run provider:smoke"
  echo "- result: ${provider_smoke_status} (exit ${provider_smoke_exit})"
  echo "- output snippet (tail -n 30):"
  echo
  echo '```text'
  printf '%s\n' "${provider_smoke_snippet}"
  echo '```'
  echo
  echo "## Git Working Tree"
  echo
  echo "- changed lines vs HEAD: ${git_changed_lines}"
  echo "- git status --short tail -n 20:"
  echo
  echo '```text'
  if [[ -n "${git_status_tail}" ]]; then
    printf '%s\n' "${git_status_tail}"
  else
    echo "(clean)"
  fi
  echo '```'
} >"${report_path}"

echo "${report_path}"
