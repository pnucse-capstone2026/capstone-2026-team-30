#!/usr/bin/env bash
# ==============================================================================
# PaC Kyverno Governance Platform - K8s Manifest Modular Integrity Test
# ==============================================================================
# 도입 배경: Base와 MLOps 모듈 간의 K8s 매니페스트 분리 무결성을 자동 검증
# 기대 효과: Core 단독 배포 시 MLOps 리소스 누출 방지 및 모듈별 독립 렌더링 보장
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

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
  if grep -q -- "${pattern}" "${file}"; then
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
  if ! grep -q -- "${pattern}" "${file}"; then
    echo -e "  ${GREEN}✔ [PASS]${NC} ${desc}"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo -e "  ${RED}✖ [FAIL]${NC} ${desc} (Unexpected match for '${pattern}')" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

assert_file_exists() {
  local desc="$1"
  local filepath="$2"
  if [ -f "${filepath}" ]; then
    echo -e "  ${GREEN}✔ [PASS]${NC} ${desc}"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo -e "  ${RED}✖ [FAIL]${NC} ${desc} (File not found: ${filepath})" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

assert_dir_exists() {
  local desc="$1"
  local dirpath="$2"
  if [ -d "${dirpath}" ]; then
    echo -e "  ${GREEN}✔ [PASS]${NC} ${desc}"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo -e "  ${RED}✖ [FAIL]${NC} ${desc} (Directory not found: ${dirpath})" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

echo -e "${BOLD}Starting K8s Manifest Modular Integrity Test Suite...${NC}"

# ------------------------------------------------------------------------------
# Test 1: Base Manifest Integrity (Core Only)
# ------------------------------------------------------------------------------
log_header "Test 1: Base Manifest Rendering & Isolation"

BASE_FILE="${TMP_DIR}/base.yaml"
kubectl kustomize "${ROOT_DIR}/k8s-manifests/base" > "${BASE_FILE}"

assert_file_contains "Base includes kyverno-platform namespace" "name: kyverno-platform" "${BASE_FILE}"
assert_file_contains "Base includes backend deployment" "name: kyverno-backend" "${BASE_FILE}"
assert_file_contains "Base includes frontend deployment" "name: kyverno-frontend" "${BASE_FILE}"
assert_file_contains "Base includes postgres deployment" "name: postgres" "${BASE_FILE}"
assert_file_not_contains "Base DOES NOT include kubeflow namespace" "name: kubeflow" "${BASE_FILE}"
assert_file_not_contains "Base DOES NOT include notebook-controller" "notebook-controller" "${BASE_FILE}"
assert_file_not_contains "Base DOES NOT include Kubeflow CRD" "notebooks.kubeflow.org" "${BASE_FILE}"

# ------------------------------------------------------------------------------
# Test 2: MLOps Module Manifest Integrity
# ------------------------------------------------------------------------------
log_header "Test 2: MLOps Module Rendering & Specificity"

MLOPS_FILE="${TMP_DIR}/mlops.yaml"
kubectl kustomize "${ROOT_DIR}/k8s-manifests/modules/mlops" > "${MLOPS_FILE}"

assert_file_contains "MLOps includes notebooks.kubeflow.org CRD" "notebooks.kubeflow.org" "${MLOPS_FILE}"
assert_file_contains "MLOps includes kubeflow namespace" "name: kubeflow" "${MLOPS_FILE}"
assert_file_contains "MLOps includes notebook-controller deployment" "name: notebook-controller-deployment" "${MLOPS_FILE}"
assert_file_not_contains "MLOps DOES NOT include backend deployment" "name: kyverno-backend" "${MLOPS_FILE}"
assert_file_not_contains "MLOps DOES NOT include frontend deployment" "name: kyverno-frontend" "${MLOPS_FILE}"
assert_file_not_contains "MLOps DOES NOT include postgres deployment" "name: postgres" "${MLOPS_FILE}"

# ------------------------------------------------------------------------------
# Test 3: Overlay Compatibility (EKS & On-Prem)
# ------------------------------------------------------------------------------
log_header "Test 3: Overlay Compatibility"

EKS_FILE="${TMP_DIR}/eks.yaml"
kubectl kustomize "${ROOT_DIR}/k8s-manifests/overlays/eks" > "${EKS_FILE}"
assert_file_contains "EKS overlay renders backend" "name: kyverno-backend" "${EKS_FILE}"
assert_file_not_contains "EKS overlay maintains MLOps isolation" "notebook-controller" "${EKS_FILE}"

ONPREM_FILE="${TMP_DIR}/onprem.yaml"
kubectl kustomize "${ROOT_DIR}/k8s-manifests/overlays/onprem" > "${ONPREM_FILE}"
assert_file_contains "On-prem overlay renders backend" "name: kyverno-backend" "${ONPREM_FILE}"
assert_file_not_contains "On-prem overlay maintains MLOps isolation" "notebook-controller" "${ONPREM_FILE}"

# ------------------------------------------------------------------------------
# Test 4: Policies Segregation Integrity
# ------------------------------------------------------------------------------
log_header "Test 4: Policy Hierarchy Segregation"

assert_dir_exists "Core policy dir exists" "${ROOT_DIR}/k8s-manifests/policies"
assert_file_exists "Core disallow-privileged-containers policy exists" "${ROOT_DIR}/k8s-manifests/policies/disallow-privileged-containers.yaml"
assert_dir_exists "MLOps policy dir exists" "${ROOT_DIR}/k8s-manifests/policies/mlops"
assert_file_exists "MLOps limit-gpu-per-namespace policy exists in mlops/" "${ROOT_DIR}/k8s-manifests/policies/mlops/limit-gpu-per-namespace.yaml"
assert_file_exists "MLOps spot-node-selector policy exists in mlops/" "${ROOT_DIR}/k8s-manifests/policies/mlops/enforce-spot-node-selector.yaml"

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
