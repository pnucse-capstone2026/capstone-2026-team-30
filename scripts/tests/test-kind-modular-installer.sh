#!/usr/bin/env bash
# ==============================================================================
# Bare-Minimum Kind Test: Deploy Script Live Cluster Secret & Module Lifecycle
# ==============================================================================
# 도입 배경: deploy.sh가 실제 K8s API 서버에 Secret을 주입하고 MLOps 플래그에 따라
#           실제 리소스 배포를 동적으로 온/오프하는 생명주기 전체를 초경량으로 실증
# 기대 효과: 실 클러스터 상에서 Secret 환경변수 주입 정합성 및 런타임 토글 안정성 보장
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/kind-bare-config.yaml"
DEPLOY_SCRIPT="${ROOT_DIR}/scripts/deploy.sh"
CLUSTER_NAME="bare-mod-inst"

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

cleanup() {
  local exit_code=$?
  log_info "Cleaning up Kind cluster '${CLUSTER_NAME}'..."
  kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
  docker volume prune -f >/dev/null 2>&1 || true
  if [ "${FAILED_COUNT}" -eq 0 ] && [ ${exit_code} -eq 0 ]; then
    echo -e "${GREEN}${BOLD}🎉 Deployer Cluster Lifecycle Test Suite Passed (${PASSED_COUNT} checks passed)!${NC}"
  else
    echo -e "${RED}${BOLD}✖ Deployer Cluster Lifecycle Test Suite Failed (${FAILED_COUNT} failed)!${NC}" >&2
  fi
  exit ${exit_code}
}
trap cleanup EXIT INT TERM

log_header "Provisioning Bare-Minimum Installer Test Cluster: ${CLUSTER_NAME}"
kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"

log_header "Case A: Live Deployment with MLOps DISABLED (--disable-mlops)"
"${DEPLOY_SCRIPT}" --env onprem --disable-mlops --skip-rollout >/dev/null 2>&1

# 1. kyverno-platform-secret 내 MODULE_MLOPS_ENABLED=false 검증
MLOPS_SECRET_VAL=$(kubectl get secret kyverno-platform-secret -n kyverno-platform -o jsonpath='{.data.MODULE_MLOPS_ENABLED}' | base64 --decode)
if [ "${MLOPS_SECRET_VAL}" = "false" ]; then
  log_pass "Secret 'MODULE_MLOPS_ENABLED' is accurately set to 'false'."
else
  log_fail "Secret 'MODULE_MLOPS_ENABLED' expected 'false', got '${MLOPS_SECRET_VAL}'."
fi

# 2. MLOps CRD 미배포 검증
if kubectl get crd notebooks.kubeflow.org >/dev/null 2>&1; then
  log_fail "CRD 'notebooks.kubeflow.org' unexpectedly found when MLOps disabled!"
else
  log_pass "CRD 'notebooks.kubeflow.org' verified absent in live cluster."
fi

# 3. kubeflow 네임스페이스 미생성 검증
if kubectl get namespace kubeflow >/dev/null 2>&1; then
  log_fail "Namespace 'kubeflow' unexpectedly exists!"
else
  log_pass "Namespace 'kubeflow' verified absent in live cluster."
fi

log_header "Case B: Live Dynamic Upgrade with MLOps ENABLED (--enable-mlops)"
"${DEPLOY_SCRIPT}" --env onprem --enable-mlops --skip-rollout >/dev/null 2>&1

# 4. kyverno-platform-secret 내 MODULE_MLOPS_ENABLED=true 업데이트 검증
MLOPS_SECRET_VAL_ENABLED=$(kubectl get secret kyverno-platform-secret -n kyverno-platform -o jsonpath='{.data.MODULE_MLOPS_ENABLED}' | base64 --decode)
if [ "${MLOPS_SECRET_VAL_ENABLED}" = "true" ]; then
  log_pass "Secret 'MODULE_MLOPS_ENABLED' successfully updated to 'true'."
else
  log_fail "Secret 'MODULE_MLOPS_ENABLED' expected 'true', got '${MLOPS_SECRET_VAL_ENABLED}'."
fi

# 5. Kubeflow CRD 배포 완료 검증
if kubectl wait --for=condition=Established crd/notebooks.kubeflow.org --timeout=30s >/dev/null 2>&1; then
  log_pass "CRD 'notebooks.kubeflow.org' successfully deployed and Established."
else
  log_fail "CRD 'notebooks.kubeflow.org' failed to deploy on enable-mlops."
fi

# 6. kubeflow 네임스페이스 및 컨트롤러 파드 정의 등록 검증
if kubectl get namespace kubeflow >/dev/null 2>&1 && \
   kubectl get deployment notebook-controller-deployment -n kubeflow >/dev/null 2>&1; then
  log_pass "MLOps controller workload and namespace successfully provisioned."
else
  log_fail "MLOps controller components missing after enable."
fi

echo -e "\n=========================================="
echo -e "Installer Test Summary: ${GREEN}${PASSED_COUNT} Passed${NC}, ${RED}${FAILED_COUNT} Failed${NC}"
echo -e "=========================================="

[ "${FAILED_COUNT}" -eq 0 ] || exit 1
