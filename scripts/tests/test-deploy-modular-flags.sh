#!/usr/bin/env bash
# ==============================================================================
# PaC Kyverno Governance Platform - Deploy Script Modular Flags Integrity Test
# ==============================================================================
# 도입 배경: deploy.sh / install.sh의 모듈별 활성화/비활성화 CLI 플래그 동작 무결성 자동 검증
# 기대 효과: 운영자가 지정한 모듈 플래그에 따라 K8s 매니페스트 및 Secret이 일관되게 구성되는지 보장
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_SCRIPT="${ROOT_DIR}/scripts/deploy.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

PASSED_COUNT=0
FAILED_COUNT=0

log_header() { echo -e "\n${BOLD}${BLUE}=== $* ===${NC}"; }

assert_file_contains() {
  local desc="$1"
  local pattern="$2"
  local file="$3"
  if grep -F -q -- "${pattern}" "${file}"; then
    echo -e "  ${GREEN}✔ [PASS]${NC} ${desc}"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo -e "  ${RED}✖ [FAIL]${NC} ${desc} (Expected to contain '${pattern}')" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

assert_file_not_contains() {
  local desc="$1"
  local pattern="$2"
  local file="$3"
  if ! grep -F -q -- "${pattern}" "${file}"; then
    echo -e "  ${GREEN}✔ [PASS]${NC} ${desc}"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo -e "  ${RED}✖ [FAIL]${NC} ${desc} (Unexpected match for '${pattern}')" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

echo -e "${BOLD}Starting Deploy Script Modular Flags Integrity Test Suite...${NC}"

# ------------------------------------------------------------------------------
# Test 1: CLI Help Specification
# ------------------------------------------------------------------------------
log_header "Test 1: CLI Usage & Options Documentation"

HELP_FILE="${TMP_DIR}/help.txt"
"${DEPLOY_SCRIPT}" --help > "${HELP_FILE}" 2>&1

assert_file_contains "Help lists --enable-mlops" "--enable-mlops" "${HELP_FILE}"
assert_file_contains "Help lists --disable-mlops" "--disable-mlops" "${HELP_FILE}"
assert_file_contains "Help lists --enable-ai" "--enable-ai" "${HELP_FILE}"
assert_file_contains "Help lists --enable-simulation" "--enable-simulation" "${HELP_FILE}"
assert_file_contains "Help lists --modules <list>" "--modules <list>" "${HELP_FILE}"

# ------------------------------------------------------------------------------
# Test 2: Dry-run Execution with MLOps Disabled (--disable-mlops)
# ------------------------------------------------------------------------------
log_header "Test 2: Dry-run Execution with MLOps Disabled"

DRY_DISABLED_FILE="${TMP_DIR}/dry_disabled.txt"
"${DEPLOY_SCRIPT}" --env onprem --dry-run --disable-mlops > "${DRY_DISABLED_FILE}" 2>&1

assert_file_contains "Renders Core manifests successfully" "Rendering Core manifests" "${DRY_DISABLED_FILE}"
assert_file_contains "Explicitly skips MLOps manifests" "MLOps module is disabled (skipping MLOps manifests)" "${DRY_DISABLED_FILE}"
assert_file_not_contains "Does NOT output notebook-controller" "notebook-controller-deployment" "${DRY_DISABLED_FILE}"

# ------------------------------------------------------------------------------
# Test 3: Dry-run Execution with MLOps Enabled (--enable-mlops / default)
# ------------------------------------------------------------------------------
log_header "Test 3: Dry-run Execution with MLOps Enabled"

DRY_ENABLED_FILE="${TMP_DIR}/dry_enabled.txt"
"${DEPLOY_SCRIPT}" --env onprem --dry-run --enable-mlops > "${DRY_ENABLED_FILE}" 2>&1

assert_file_contains "Renders Core manifests successfully" "Rendering Core manifests" "${DRY_ENABLED_FILE}"
assert_file_contains "Renders MLOps extension manifests" "Rendering MLOps extension manifests" "${DRY_ENABLED_FILE}"
assert_file_contains "Outputs notebook-controller deployment" "notebook-controller-deployment" "${DRY_ENABLED_FILE}"

# ------------------------------------------------------------------------------
# Test 4: Explicit Comma-Separated --modules Flag
# ------------------------------------------------------------------------------
log_header "Test 4: Comma-Separated --modules Flag Processing"

MOD_SIM_FILE="${TMP_DIR}/mod_sim.txt"
"${DEPLOY_SCRIPT}" --env onprem --dry-run --modules core,simulation > "${MOD_SIM_FILE}" 2>&1
assert_file_contains "Skips MLOps when not in --modules" "MLOps module is disabled" "${MOD_SIM_FILE}"

MOD_MLOPS_FILE="${TMP_DIR}/mod_mlops.txt"
"${DEPLOY_SCRIPT}" --env onprem --dry-run --modules core,mlops > "${MOD_MLOPS_FILE}" 2>&1
assert_file_contains "Renders MLOps when explicitly in --modules" "Rendering MLOps extension manifests" "${MOD_MLOPS_FILE}"

# ------------------------------------------------------------------------------
# Test 5: Secret Generation & Environment Injection Code Integrity
# ------------------------------------------------------------------------------
log_header "Test 5: Secret Generation Code & Module Injection"

assert_file_contains "Secret injects MODULE_MLOPS_ENABLED" 'MODULE_MLOPS_ENABLED="${ENABLE_MLOPS}"' "${DEPLOY_SCRIPT}"
assert_file_contains "Secret injects MODULE_AI_AGENT_ENABLED" 'MODULE_AI_AGENT_ENABLED="${ENABLE_AI}"' "${DEPLOY_SCRIPT}"
assert_file_contains "Secret injects MODULE_SIMULATION_ENABLED" 'MODULE_SIMULATION_ENABLED="${ENABLE_SIMULATION}"' "${DEPLOY_SCRIPT}"
assert_file_contains "Secret injects MODULE_GITOPS_ENABLED" 'MODULE_GITOPS_ENABLED="${ENABLE_GITOPS}"' "${DEPLOY_SCRIPT}"
assert_file_contains "Applies policies/mlops conditionally" 'if [ "${ENABLE_MLOPS}" = true ] && [ -d "${POLICIES_DIR}/mlops" ]; then' "${DEPLOY_SCRIPT}"

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo -e "\n=========================================="
echo -e "Test Summary: ${GREEN}${PASSED_COUNT} Passed${NC}, ${RED}${FAILED_COUNT} Failed${NC}"
echo -e "=========================================="

if [ "${FAILED_COUNT}" -gt 0 ]; then
  exit 1
fi
exit 0
