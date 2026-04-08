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

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "FAIL: Missing required command '${cmd}'"
    exit 1
  fi
}

source_env_file "${ROOT_DIR}/.env"
source_env_file "${ROOT_DIR}/services/gateway/.env"

require_command curl
require_command jq

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8787}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT INT TERM

hard_failures=0

pass() {
  echo "PASS: $1"
}

note() {
  echo "NOTE: $1"
}

fail() {
  echo "FAIL: $1"
  hard_failures=$((hard_failures + 1))
}

append_offset_limit_if_required() {
  local operation_json="$1"
  local url="$2"

  local requires_offset_limit
  requires_offset_limit="$(printf '%s' "${operation_json}" | jq -r '
    def reqs(v):
      if v == null then []
      elif (v | type) == "array" then v
      else []
      end;

    def required_query_from_parameters:
      if (.parameters? | type) == "array" then
        [.parameters[] | select((.in // .location // "") == "query" and (.required == true)) | (.name // empty)]
      else
        []
      end;

    (
      reqs(.querySchema?.required)
      + reqs(.request?.querySchema?.required)
      + reqs(.request?.query?.required)
      + reqs(.inputSchema?.required)
      + reqs(.schema?.query?.required)
      + required_query_from_parameters
    )
    | map(tostring | ascii_downcase)
    | ((index("offset") != null) and (index("limit") != null))
  ' 2>/dev/null || echo "false")"

  if [[ "${requires_offset_limit}" == "true" ]]; then
    if [[ "${url}" == *"?"* ]]; then
      printf '%s&offset=0&limit=10' "${url}"
    else
      printf '%s?offset=0&limit=10' "${url}"
    fi
    return
  fi

  printf '%s' "${url}"
}

invoke_operation() {
  local method="$1"
  local url="$2"
  local idempotency_key="$3"
  local headers_file="$4"
  local body_file="$5"

  if [[ "${method}" == "POST" ]]; then
    curl -sS -D "${headers_file}" -o "${body_file}" -w "%{http_code}" \
      -X POST "${url}" \
      -H "content-type: application/json" \
      -H "idempotency-key: ${idempotency_key}" \
      -d '{}'
    return
  fi

  curl -sS -D "${headers_file}" -o "${body_file}" -w "%{http_code}" \
    -X GET "${url}" \
    -H "idempotency-key: ${idempotency_key}"
}

enrich_operation_with_tool_schema() {
  local operation_json="$1"
  local tools_file="$2"

  if [[ -z "${operation_json}" || ! -f "${tools_file}" ]]; then
    printf '%s' "${operation_json}"
    return
  fi

  local operation_id
  operation_id="$(printf '%s' "${operation_json}" | jq -r '.id // empty' 2>/dev/null || true)"
  if [[ -z "${operation_id}" ]]; then
    printf '%s' "${operation_json}"
    return
  fi

  local required_json
  required_json="$(jq -c --arg op_id "${operation_id}" '
    (.tools // [])
    | map(select(.name == $op_id))
    | .[0].inputSchema.required // empty
  ' "${tools_file}" 2>/dev/null || true)"

  if [[ -z "${required_json}" ]]; then
    printf '%s' "${operation_json}"
    return
  fi

  printf '%s' "${operation_json}" | jq -c --argjson required "${required_json}" '
    . + { inputSchema: ((.inputSchema // {}) + { required: $required }) }
  '
}

echo "Provider smoke check against ${GATEWAY_URL}"

# Step 1
for endpoint in "/health" "/api/v1/discovery/manifest" "/api/v1/discovery/operations"; do
  status="$(curl -sS -o /dev/null -w "%{http_code}" "${GATEWAY_URL}${endpoint}")"
  if [[ "${status}" == "200" ]]; then
    pass "Step 1 ${endpoint} returned HTTP 200"
  else
    fail "Step 1 ${endpoint} expected HTTP 200 but got ${status}"
  fi
done

# Step 2
operations_file="${TMP_DIR}/operations.json"
tools_file="${TMP_DIR}/agent-tools.json"
if ! curl -fsS "${GATEWAY_URL}/api/v1/discovery/operations" -o "${operations_file}"; then
  fail "Step 2 unable to fetch operations JSON"
else
  curl -fsS "${GATEWAY_URL}/api/v1/discovery/agent-tools" -o "${tools_file}" >/dev/null 2>&1 || true

  free_op_json="$(jq -c '
    (.operations // []) as $ops
    | (
      $ops
      | map(select(.paymentRequired == false and ((.method // "" | ascii_upcase) == "GET") and ((.path // "") | endswith("/list"))))
      | .[0]
    )
    // ($ops | map(select(.paymentRequired == false)) | .[0])
    // empty
  ' "${operations_file}")"
  paid_op_json="$(jq -c '
    (.operations // []) as $ops
    | (
      $ops
      | map(select(.paymentRequired == true and ((.method // "" | ascii_upcase) == "POST")))
      | .[0]
    )
    // ($ops | map(select(.paymentRequired == true)) | .[0])
    // empty
  ' "${operations_file}")"

  if [[ -z "${free_op_json}" ]]; then
    fail "Step 2 did not find a free operation"
  else
    free_op_json="$(enrich_operation_with_tool_schema "${free_op_json}" "${tools_file}")"
    free_op_id="$(printf '%s' "${free_op_json}" | jq -r '.id // "<unknown>"')"
    pass "Step 2 selected free operation ${free_op_id}"
  fi

  if [[ -z "${paid_op_json}" ]]; then
    fail "Step 2 did not find a paid operation"
  else
    paid_op_json="$(enrich_operation_with_tool_schema "${paid_op_json}" "${tools_file}")"
    paid_op_id="$(printf '%s' "${paid_op_json}" | jq -r '.id // "<unknown>"')"
    pass "Step 2 selected paid operation ${paid_op_id}"
  fi
fi

# Step 3
if [[ -n "${free_op_json:-}" ]]; then
  free_method="$(printf '%s' "${free_op_json}" | jq -r '.method // "GET"' | tr '[:lower:]' '[:upper:]')"
  free_path="$(printf '%s' "${free_op_json}" | jq -r '.path // empty')"

  if [[ -z "${free_path}" ]]; then
    fail "Step 3 free operation path is empty"
  else
    free_url="${GATEWAY_URL}${free_path}"
    if [[ "${free_method}" == "GET" ]]; then
      free_url="$(append_offset_limit_if_required "${free_op_json}" "${free_url}")"
    fi

    free_idempotency_key="provider-smoke-free-$(date +%s)-${RANDOM}"
    free_headers_file="${TMP_DIR}/free.headers"
    free_body_file="${TMP_DIR}/free.body"
    free_status="$(invoke_operation "${free_method}" "${free_url}" "${free_idempotency_key}" "${free_headers_file}" "${free_body_file}")"

    if [[ "${free_status}" == "200" ]]; then
      pass "Step 3 free invocation returned HTTP 200"
    else
      free_error_code="$(jq -r '.error.code // empty' "${free_body_file}" 2>/dev/null || true)"
      if [[ "${free_status}" =~ ^4[0-9][0-9]$ && "${free_error_code}" == "INVALID_REQUEST" ]]; then
        pass "Step 3 free invocation returned deterministic INVALID_REQUEST (${free_status})"
        note "Free operation likely requires additional args; smoke check allows deterministic INVALID_REQUEST"
      else
        fail "Step 3 free invocation expected 200 or deterministic INVALID_REQUEST, got HTTP ${free_status}"
      fi
    fi
  fi
fi

# Step 4 and 5
if [[ -n "${paid_op_json:-}" ]]; then
  paid_method="$(printf '%s' "${paid_op_json}" | jq -r '.method // "GET"' | tr '[:lower:]' '[:upper:]')"
  paid_path="$(printf '%s' "${paid_op_json}" | jq -r '.path // empty')"

  if [[ -z "${paid_path}" ]]; then
    fail "Step 4 paid operation path is empty"
  else
    paid_url="${GATEWAY_URL}${paid_path}"
    if [[ "${paid_method}" == "GET" ]]; then
      paid_url="$(append_offset_limit_if_required "${paid_op_json}" "${paid_url}")"
    fi

    paid_idempotency_key="provider-smoke-paid-$(date +%s)-${RANDOM}"

    paid_headers_first="${TMP_DIR}/paid.first.headers"
    paid_body_first="${TMP_DIR}/paid.first.body"
    paid_status_first="$(invoke_operation "${paid_method}" "${paid_url}" "${paid_idempotency_key}" "${paid_headers_first}" "${paid_body_first}")"

    if [[ "${paid_status_first}" == "402" ]]; then
      pass "Step 4 paid invocation returned HTTP 402 challenge"
    else
      fail "Step 4 paid invocation expected HTTP 402 but got ${paid_status_first}"
    fi

    paid_headers_replay="${TMP_DIR}/paid.replay.headers"
    paid_body_replay="${TMP_DIR}/paid.replay.body"
    paid_status_replay="$(invoke_operation "${paid_method}" "${paid_url}" "${paid_idempotency_key}" "${paid_headers_replay}" "${paid_body_replay}")"

    replay_header_present="false"
    if grep -iq '^x-idempotent-replay:[[:space:]]*true[[:space:]]*$' "${paid_headers_replay}"; then
      replay_header_present="true"
    fi

    if [[ "${paid_status_replay}" == "${paid_status_first}" && "${replay_header_present}" == "true" ]]; then
      pass "Step 5 replay preserved status ${paid_status_replay} and returned x-idempotent-replay=true"
    else
      fail "Step 5 replay expected status ${paid_status_first} and x-idempotent-replay=true, got status ${paid_status_replay}"
    fi
  fi
fi

if [[ "${hard_failures}" -gt 0 ]]; then
  echo "FAIL: Provider smoke-check completed with ${hard_failures} hard failure(s)"
  exit 1
fi

echo "PASS: Provider smoke-check completed successfully"
