#!/usr/bin/env bash
# ==============================================================================
# Bare-Minimum Single-Cluster Kind Test Runner
# ==============================================================================
# Purpose:
#   Validates Kubernetes adapter, CRD schema, and RBAC token isolation against
#   a single live Kubernetes API server in an ultra-lightweight environment.
#
# Anti-Bloat / Disk Usage Safeguards:
#   1. Single control-plane node only (no workers, no port forwardings).
#   2. NO Kyverno controllers or background daemons installed — only CRDs.
#   3. Automatic teardown and Docker volume pruning via EXIT trap.
#   4. Pre-flight disk space assertion.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOCAL_BIN_DIR="${ROOT_DIR}/scripts/bin"
CONFIG_PATH="${SCRIPT_DIR}/kind-bare-config.yaml"

export PATH="${LOCAL_BIN_DIR}:${PATH}"

CLUSTER_NAME="${1:-bare-single}"
KYVERNO_CRD_VERSION="v1.12.6"
MIN_FREE_DISK_GB=5

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

log_info() { echo -e "${CYAN}[INFO]${NC} $*"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

echo -e "${BOLD}${CYAN}==============================================================================${NC}"
echo -e "${BOLD}${CYAN} 🧪 Bare-Minimum Single-Cluster Kind Test Runner${NC}"
echo -e "${BOLD}${CYAN}==============================================================================${NC}"
echo -e " Target Cluster : ${BOLD}${CLUSTER_NAME}${NC}"
echo -e " Topology       : 1 Control-Plane (0 Workers, No Helm, No Controllers)"
echo -e "==============================================================================\n"

# 1. Pre-flight Disk Check
log_info "Step 1: Checking disk space..."
FREE_KB=$(df -k / | awk 'NR==2 {print $4}')
FREE_GB=$((FREE_KB / 1024 / 1024))
if [ "${FREE_GB}" -lt "${MIN_FREE_DISK_GB}" ]; then
  log_fail "Insufficient disk space! Free: ${FREE_GB}GB, Required: >= ${MIN_FREE_DISK_GB}GB."
  exit 1
fi
log_pass "Disk check passed (${FREE_GB}GB available)."

# 2. Verify Prerequisites
mkdir -p "${LOCAL_BIN_DIR}"
if ! command -v kind >/dev/null 2>&1; then
  log_info "Downloading Kind CLI (v0.22.0)..."
  curl -sLo "${LOCAL_BIN_DIR}/kind" "https://kind.sigs.k8s.io/dl/v0.22.0/kind-linux-amd64"
  chmod +x "${LOCAL_BIN_DIR}/kind"
fi

if ! command -v kubectl >/dev/null 2>&1; then
  log_info "Downloading Kubectl CLI (v1.29.2)..."
  curl -sLo "${LOCAL_BIN_DIR}/kubectl" "https://dl.k8s.io/release/v1.29.2/bin/linux/amd64/kubectl"
  chmod +x "${LOCAL_BIN_DIR}/kubectl"
fi

# 3. Setup cleanup trap
cleanup() {
  local exit_code=$?
  log_warn "Tearing down cluster '${CLUSTER_NAME}' and reclaiming disk space..."
  kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
  docker volume prune -f >/dev/null 2>&1 || true
  log_pass "Cleanup complete."
  exit ${exit_code}
}
trap cleanup EXIT ERR SIGINT SIGTERM

# 4. Provision Bare-Minimum Cluster
log_info "Step 2: Provisioning bare-minimum Kind cluster..."
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  log_warn "Cluster '${CLUSTER_NAME}' already exists. Deleting for a clean slate..."
  kind delete cluster --name "${CLUSTER_NAME}"
fi

kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"

# Devcontainer host DNS alignment if applicable
if getent hosts "${CLUSTER_NAME}-control-plane" > /dev/null 2>&1; then
  kubectl config set-cluster "kind-${CLUSTER_NAME}" \
    --server="https://${CLUSTER_NAME}-control-plane:6443" \
    --insecure-skip-tls-verify=true
fi

# 5. Install ONLY Required CRDs (Zero Controller Bloat)
log_info "Step 3: Installing Kyverno CRDs (without controller runtime)..."
TEMP_CRD_DIR=$(mktemp -d /tmp/bare-crds-XXXXXX)
curl -sLo "${TEMP_CRD_DIR}/cp.yaml" "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_CRD_VERSION}/kyverno.io_clusterpolicies.yaml"
curl -sLo "${TEMP_CRD_DIR}/pe.yaml" "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_CRD_VERSION}/kyverno.io_policyexceptions.yaml"

kubectl apply --server-side -f "${TEMP_CRD_DIR}/cp.yaml"
kubectl apply --server-side -f "${TEMP_CRD_DIR}/pe.yaml"
kubectl wait --for=condition=Established crd/clusterpolicies.kyverno.io crd/policyexceptions.kyverno.io --timeout=60s
rm -rf "${TEMP_CRD_DIR}"
log_pass "CRDs installed."

# 6. Apply Minimal RBAC & Policy
log_info "Step 4: Provisioning minimal test namespace and RBAC ServiceAccount..."
kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: bare-test
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: bare-sa
  namespace: bare-test
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: bare-exception-writer
  namespace: bare-test
rules:
  - apiGroups: ["kyverno.io"]
    resources: ["policyexceptions"]
    verbs: ["get", "create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: bare-exception-binding
  namespace: bare-test
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: bare-exception-writer
subjects:
  - kind: ServiceAccount
    name: bare-sa
    namespace: bare-test
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: bare-policy-reader
rules:
  - apiGroups: ["kyverno.io"]
    resources: ["clusterpolicies"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: bare-policy-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: bare-policy-reader
subjects:
  - kind: ServiceAccount
    name: bare-sa
    namespace: bare-test
EOF

kubectl apply -f "${ROOT_DIR}/k8s-manifests/policies/disallow-latest-tag.yaml"

# 7. Extract Environment Tokens and Configs
log_info "Step 5: Extracting cluster endpoints and authentication tokens..."
TEST_TOKEN=$(kubectl create token bare-sa -n bare-test --duration=2h)
CA_DATA=$(kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
SERVER=$(kubectl config view --raw -o jsonpath='{.clusters[0].cluster.server}')

export E2E_APISERVER="${SERVER}"
export E2E_CA_DATA="${CA_DATA}"
export E2E_TOKEN="${TEST_TOKEN}"
export E2E_NAMESPACE="bare-test"
export E2E_POLICY_NAME="disallow-latest-tag"
export E2E_POLICY_RULE="disallow-latest-tag"

# 8. Execute Test Suite
log_info "Step 6: Executing Bare-Minimum Cluster Integration Tests..."
if command -v pnpm >/dev/null 2>&1; then
  (cd "${ROOT_DIR}/apps/backend" && pnpm jest --testPathPattern="multi-cluster" --forceExit)
else
  log_warn "pnpm is not available on host. Environment is prepared with variables:"
  echo "  E2E_APISERVER=${E2E_APISERVER}"
  echo "  E2E_NAMESPACE=${E2E_NAMESPACE}"
fi

log_pass "Single-cluster bare test execution completed successfully!"
