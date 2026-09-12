#!/usr/bin/env bash
# ==============================================================================
# Bare-Minimum Kind Test: MLOps Module Standalone & Spec Integrity
# ==============================================================================
# 도입 배경: Core 워크로드 없이 MLOps 확장 모듈(CRD, Controller, Policy)이
#           초경량 Kind 클러스터에서 독립적으로 온전히 배포되고 유효한지 실증
# 기대 효과: MLOps 모듈의 K8s 스키마 정합성과 정책 분리 배포 안정성 독립 검증
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/kind-bare-config.yaml"
CLUSTER_NAME="bare-mod-mlops"

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
    echo -e "${GREEN}${BOLD}🎉 MLOps Module Test Suite Passed (${PASSED_COUNT} checks passed)!${NC}"
  else
    echo -e "${RED}${BOLD}✖ MLOps Module Test Suite Failed (${FAILED_COUNT} failed)!${NC}" >&2
  fi
  exit ${exit_code}
}
trap cleanup EXIT INT TERM

log_header "Provisioning Bare-Minimum MLOps Cluster: ${CLUSTER_NAME}"
kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"

log_header "Deploying MLOps Extension Manifests (k8s-manifests/modules/mlops)"
kubectl apply -k "${ROOT_DIR}/k8s-manifests/modules/mlops"

log_header "Verification Phase: MLOps CRD & Controller Resources"
# 1. Kubeflow CRD 등록 및 Established 상태 검증
if kubectl wait --for=condition=Established crd/notebooks.kubeflow.org --timeout=30s >/dev/null 2>&1; then
  log_pass "CRD 'notebooks.kubeflow.org' is registered and Established in API server."
else
  log_fail "CRD 'notebooks.kubeflow.org' failed to establish."
fi

# 2. kubeflow 네임스페이스 검증
if kubectl get namespace kubeflow >/dev/null 2>&1; then
  log_pass "Namespace 'kubeflow' is present."
else
  log_fail "Namespace 'kubeflow' missing."
fi

# 3. Notebook Controller RBAC 및 Deployment 정의 검증
if kubectl get serviceaccount notebook-controller-service-account -n kubeflow >/dev/null 2>&1 && \
   kubectl get clusterrole notebook-controller-role >/dev/null 2>&1 && \
   kubectl get deployment notebook-controller-deployment -n kubeflow >/dev/null 2>&1; then
  log_pass "Notebook Controller workload & RBAC manifests successfully registered."
else
  log_fail "Notebook Controller components missing."
fi

# 4. Core 워크로드 격리 검증 (MLOps 단독 클러스터에 Core가 섞이지 않았는지 확인)
if kubectl get namespace kyverno-platform >/dev/null 2>&1; then
  log_fail "Core namespace 'kyverno-platform' unexpectedly found in standalone MLOps environment!"
else
  log_pass "Core namespace is cleanly excluded from standalone MLOps module."
fi

log_header "Verification Phase: MLOps Policy Deployment"
# 5. MLOps 전용 정책 파일 배포 및 검증 (Kyverno CRD 스키마만 가볍게 등록)
if [ -d "${ROOT_DIR}/k8s-manifests/policies/mlops" ]; then
  log_info "Installing Kyverno ClusterPolicy CRD schema (without controller)..."
  kubectl apply --server-side -f "https://github.com/kyverno/kyverno/releases/download/v1.12.6/kyverno.io_clusterpolicies.yaml" >/dev/null 2>&1 || true
  kubectl wait --for=condition=Established crd/clusterpolicies.kyverno.io --timeout=30s >/dev/null 2>&1 || true

  log_info "Deploying MLOps policies..."
  kubectl apply -f "${ROOT_DIR}/k8s-manifests/policies/mlops/" >/dev/null 2>&1 && \
    log_pass "MLOps policies successfully validated and accepted by Kubernetes API." || \
    log_fail "Failed to apply MLOps policies."
else
  log_fail "MLOps policy directory not found."
fi

log_header "Verification Phase: Sample Custom Resource Schema Validation"
# 6. Kubeflow Notebook CR 스키마 검증 (dry-run=server)
cat <<'INNER_EOF' | kubectl apply --dry-run=server -f - >/dev/null 2>&1 && \
  log_pass "Sample Notebook Custom Resource passed API server OpenAPI schema validation." || \
  log_fail "Sample Notebook Custom Resource failed schema validation."
apiVersion: kubeflow.org/v1
kind: Notebook
metadata:
  name: test-pytorch-notebook
  namespace: default
spec:
  template:
    spec:
      containers:
      - name: test-pytorch-notebook
        image: kubeflownotebookswg/jupyter-scipy:v1.8.0
        resources:
          requests:
            cpu: "0.5"
            memory: "1Gi"
          limits:
            cpu: "1"
            memory: "2Gi"
INNER_EOF

echo -e "\n=========================================="
echo -e "MLOps Test Summary: ${GREEN}${PASSED_COUNT} Passed${NC}, ${RED}${FAILED_COUNT} Failed${NC}"
echo -e "=========================================="

[ "${FAILED_COUNT}" -eq 0 ] || exit 1
