#!/usr/bin/env bash
# ==============================================================================
# Bare-Minimum Kind Test: Core Governance Isolation (No MLOps)
# ==============================================================================
# 도입 배경: MLOps가 비활성화된 Core 전용 K8s 환경에서 제로 리소스 풋프린트와
#           순수 거버넌스 컴포넌트의 정상 배포 여부를 초경량 Kind 클러스터에서 실증
# 기대 효과: 최소 하드웨어 리소스만으로 Core 배포 무결성 검증 및 MLOps 완전 격리 입증
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/kind-bare-config.yaml"
CLUSTER_NAME="bare-mod-core"

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
NC="\033[0m"

PASSED_COUNT=0
FAILED_COUNT=0

log_header() { echo -e "\n${BOLD}${BLUE}=== $* ===${NC}"; }
log_info()   { echo -e "${CYAN}[INFO]${NC} $*"; }
log_pass()   { echo -e "  ${GREEN}✔ [PASS]${NC} $*"; PASSED_COUNT=$((PASSED_COUNT + 1)); }
log_fail()   { echo -e "  ${RED}✖ [FAIL]${NC} $*" >&2; FAILED_COUNT=$((FAILED_COUNT + 1)); }

# 자원 자동 회수 트랩
cleanup() {
  local exit_code=$?
  log_info "Cleaning up Kind cluster '${CLUSTER_NAME}'..."
  kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
  docker volume prune -f >/dev/null 2>&1 || true
  if [ "${FAILED_COUNT}" -eq 0 ] && [ ${exit_code} -eq 0 ]; then
    echo -e "${GREEN}${BOLD}🎉 Core Isolation Test Suite Passed (${PASSED_COUNT} checks passed)!${NC}"
  else
    echo -e "${RED}${BOLD}✖ Core Isolation Test Suite Failed (${FAILED_COUNT} failed)!${NC}" >&2
  fi
  exit ${exit_code}
}
trap cleanup EXIT INT TERM

log_header "Provisioning Bare-Minimum Core Cluster: ${CLUSTER_NAME}"
kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"

log_header "Deploying Core Base Manifests (k8s-manifests/base)"
kubectl apply -k "${ROOT_DIR}/k8s-manifests/base"

log_header "Deploying Core Governance Policies (k8s-manifests/policies/*.yaml)"
# Core 정책 파일만 단독 배포 (MLOps 디렉터리 제외)
for policy_file in "${ROOT_DIR}"/k8s-manifests/policies/*.yaml; do
  [ -f "${policy_file}" ] && kubectl apply -f "${policy_file}" >/dev/null 2>&1 || true
done

log_header "Verification Phase: Core Resources Presence"
# 1. Core 네임스페이스 존재 검증
if kubectl get namespace kyverno-platform >/dev/null 2>&1; then
  log_pass "Core namespace 'kyverno-platform' is present."
else
  log_fail "Core namespace 'kyverno-platform' missing."
fi

# 2. Core 서비스 계정 및 RBAC 존재 검증
if kubectl get serviceaccount kyverno-backend-sa -n kyverno-platform >/dev/null 2>&1; then
  log_pass "Core ServiceAccount 'kyverno-backend-sa' is present."
else
  log_fail "Core ServiceAccount 'kyverno-backend-sa' missing."
fi

if kubectl get clusterrole kyverno-backend-cluster-role >/dev/null 2>&1; then
  log_pass "Core ClusterRole 'kyverno-backend-cluster-role' is present."
else
  log_fail "Core ClusterRole 'kyverno-backend-cluster-role' missing."
fi

# 3. Core 서비스 리소스 정의 검증
if kubectl get service kyverno-backend -n kyverno-platform >/dev/null 2>&1 && \
   kubectl get service kyverno-frontend -n kyverno-platform >/dev/null 2>&1 && \
   kubectl get service postgres -n kyverno-platform >/dev/null 2>&1; then
  log_pass "Core services (backend, frontend, postgres) are registered."
else
  log_fail "One or more core services are missing."
fi

log_header "Verification Phase: MLOps Zero-Resource Isolation"
# 4. Kubeflow CRD 부재 검증 (Zero Footprint)
if kubectl get crd notebooks.kubeflow.org >/dev/null 2>&1; then
  log_fail "Kubeflow CRD 'notebooks.kubeflow.org' unexpectedly exists in Core-only environment!"
else
  log_pass "Kubeflow CRD 'notebooks.kubeflow.org' is NOT installed (Zero Footprint verified)."
fi

# 5. Kubeflow 네임스페이스 부재 검증
if kubectl get namespace kubeflow >/dev/null 2>&1; then
  log_fail "Namespace 'kubeflow' unexpectedly exists!"
else
  log_pass "Namespace 'kubeflow' is NOT created."
fi

# 6. MLOps Notebook Controller 컨트롤러 부재 검증
if kubectl get deployment notebook-controller-deployment -A >/dev/null 2>&1; then
  log_fail "Notebook Controller deployment unexpectedly exists!"
else
  log_pass "Notebook Controller workload is completely absent."
fi

# 7. MLOps 전용 정책 부재 검증
if kubectl get clusterpolicy limit-gpu-per-namespace >/dev/null 2>&1 || \
   kubectl get clusterpolicy enforce-spot-node-selector >/dev/null 2>&1; then
  log_fail "MLOps-specific policies unexpectedly deployed in Core environment!"
else
  log_pass "MLOps-specific policies are completely excluded."
fi

echo -e "\n=========================================="
echo -e "Core Test Summary: ${GREEN}${PASSED_COUNT} Passed${NC}, ${RED}${FAILED_COUNT} Failed${NC}"
echo -e "=========================================="

[ "${FAILED_COUNT}" -eq 0 ] || exit 1
