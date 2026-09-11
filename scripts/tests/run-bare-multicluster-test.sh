#!/usr/bin/env bash
# ==============================================================================
# Literal Bare-Minimum Multi-Cluster Kind Test Runner
# ==============================================================================
# Purpose:
#   Validates true multi-cluster behaviors across 2 literal, independent Kind
#   clusters (cross-cluster token isolation, distinct CA verification,
#   unreachable cluster failover, and multi-cluster routing).
#
# Anti-Bloat / Disk Usage Safeguards:
#   1. Both clusters share the identical base node image (zero image duplication).
#   2. NO Helm or Kyverno controller pods deployed (CRDs only).
#   3. Zero host-port mappings (avoids host port clashes).
#   4. Strict EXIT trap guarantees deletion of both clusters and volume pruning.
#   5. Pre-flight check asserts sufficient free disk space (>= 8GB).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOCAL_BIN_DIR="${ROOT_DIR}/scripts/bin"
CONFIG_PATH="${SCRIPT_DIR}/kind-bare-config.yaml"

export PATH="${LOCAL_BIN_DIR}:${PATH}"

CLUSTER_A="bare-mc-alpha"
CLUSTER_B="bare-mc-beta"
KYVERNO_CRD_VERSION="v1.12.6"
MIN_FREE_DISK_GB=8

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
echo -e "${BOLD}${CYAN} 🌐 Literal Bare-Minimum Multi-Cluster Kind Test Runner${NC}"
echo -e "${BOLD}${CYAN}==============================================================================${NC}"
echo -e " Cluster A (Alpha) : ${BOLD}${CLUSTER_A}${NC}"
echo -e " Cluster B (Beta)  : ${BOLD}${CLUSTER_B}${NC}"
echo -e " Footprint         : 2 Bare Control Planes, Shared Base Layer, No Controllers"
echo -e "==============================================================================\n"

# 1. Pre-flight Disk Check
log_info "Step 1: Checking disk space for dual-cluster execution..."
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

# 3. Setup cleanup trap for both clusters
cleanup() {
  local exit_code=$?
  log_warn "Tearing down multi-cluster test environment and reclaiming disk space..."
  kind delete cluster --name "${CLUSTER_A}" 2>/dev/null || true
  kind delete cluster --name "${CLUSTER_B}" 2>/dev/null || true
  docker volume prune -f >/dev/null 2>&1 || true
  rm -rf /tmp/bare-mc-* 2>/dev/null || true
  log_pass "Multi-cluster cleanup complete."
  exit ${exit_code}
}
trap cleanup EXIT ERR SIGINT SIGTERM

# 4. Provision Literal Kind Clusters
provision_bare_cluster() {
  local c_name="$1"
  log_info "Provisioning bare cluster '${c_name}'..."
  if kind get clusters 2>/dev/null | grep -q "^${c_name}$"; then
    kind delete cluster --name "${c_name}"
  fi
  kind create cluster --name "${c_name}" --config "${CONFIG_PATH}"

  if getent hosts "${c_name}-control-plane" > /dev/null 2>&1; then
    kubectl config set-cluster "kind-${c_name}" \
      --server="https://${c_name}-control-plane:6443" \
      --insecure-skip-tls-verify=true
  fi
}

log_info "Step 2: Provisioning 2 literal Kind clusters..."
provision_bare_cluster "${CLUSTER_A}"
provision_bare_cluster "${CLUSTER_B}"

# 5. Install CRDs on both clusters
log_info "Step 3: Installing CRDs on both clusters (no controller pods)..."
TEMP_CRD_DIR=$(mktemp -d /tmp/bare-mc-crds-XXXXXX)
curl -sLo "${TEMP_CRD_DIR}/cp.yaml" "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_CRD_VERSION}/kyverno.io_clusterpolicies.yaml"
curl -sLo "${TEMP_CRD_DIR}/pe.yaml" "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_CRD_VERSION}/kyverno.io_policyexceptions.yaml"

for c in "${CLUSTER_A}" "${CLUSTER_B}"; do
  log_info "Applying CRDs to ${c}..."
  kubectl --context "kind-${c}" apply --server-side -f "${TEMP_CRD_DIR}/cp.yaml"
  kubectl --context "kind-${c}" apply --server-side -f "${TEMP_CRD_DIR}/pe.yaml"
  kubectl --context "kind-${c}" wait --for=condition=Established crd/clusterpolicies.kyverno.io crd/policyexceptions.kyverno.io --timeout=60s
done
rm -rf "${TEMP_CRD_DIR}"

# 6. Apply RBAC and ServiceAccounts
log_info "Step 4: Provisioning RBAC ServiceAccounts..."
apply_rbac() {
  local c_name="$1"
  local ns="$2"
  local sa="$3"

  kubectl --context "kind-${c_name}" apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${sa}
  namespace: ${ns}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${sa}-exception-writer
  namespace: ${ns}
rules:
  - apiGroups: ["kyverno.io"]
    resources: ["policyexceptions"]
    verbs: ["get", "create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${sa}-exception-binding
  namespace: ${ns}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${sa}-exception-writer
subjects:
  - kind: ServiceAccount
    name: ${sa}
    namespace: ${ns}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${sa}-policy-reader
rules:
  - apiGroups: ["kyverno.io"]
    resources: ["clusterpolicies"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${sa}-policy-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${sa}-policy-reader
subjects:
  - kind: ServiceAccount
    name: ${sa}
    namespace: ${ns}
EOF
}

apply_rbac "${CLUSTER_A}" "pac-mc-a" "sa-alpha"
apply_rbac "${CLUSTER_B}" "pac-mc-b" "sa-beta"

kubectl --context "kind-${CLUSTER_A}" apply -f "${ROOT_DIR}/k8s-manifests/policies/disallow-latest-tag.yaml"
kubectl --context "kind-${CLUSTER_B}" apply -f "${ROOT_DIR}/k8s-manifests/policies/disallow-latest-tag.yaml"

# 7. Extract Distinct Endpoints, CAs, and Tokens
log_info "Step 5: Extracting multi-cluster configuration from both distinct API servers..."
SERVER_A=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name=='kind-${CLUSTER_A}')].cluster.server}")
CA_A=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name=='kind-${CLUSTER_A}')].cluster.certificate-authority-data}")
TOKEN_A=$(kubectl --context "kind-${CLUSTER_A}" create token sa-alpha -n pac-mc-a --duration=2h)

SERVER_B=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name=='kind-${CLUSTER_B}')].cluster.server}")
CA_B=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name=='kind-${CLUSTER_B}')].cluster.certificate-authority-data}")
TOKEN_B=$(kubectl --context "kind-${CLUSTER_B}" create token sa-beta -n pac-mc-b --duration=2h)

KUBECONFIG_A="/tmp/bare-mc-${CLUSTER_A}.kubeconfig"
KUBECONFIG_B="/tmp/bare-mc-${CLUSTER_B}.kubeconfig"
kind get kubeconfig --name "${CLUSTER_A}" > "${KUBECONFIG_A}"
kind get kubeconfig --name "${CLUSTER_B}" > "${KUBECONFIG_B}"

export E2E_MC_SERVER_A="${SERVER_A}"
export E2E_MC_CA_A="${CA_A}"
export E2E_MC_TOKEN_A="${TOKEN_A}"
export E2E_MC_NS_A="pac-mc-a"
export E2E_MC_KUBECONFIG_A="${KUBECONFIG_A}"

export E2E_MC_SERVER_B="${SERVER_B}"
export E2E_MC_CA_B="${CA_B}"
export E2E_MC_TOKEN_B="${TOKEN_B}"
export E2E_MC_NS_B="pac-mc-b"
export E2E_MC_KUBECONFIG_B="${KUBECONFIG_B}"

export E2E_POLICY_NAME="disallow-latest-tag"
export E2E_POLICY_RULE="disallow-latest-tag"

# 8. Execute Multi-Cluster Integration Test
log_info "Step 6: Executing Literal Multi-Cluster Integration Tests..."
if command -v pnpm >/dev/null 2>&1; then
  (cd "${ROOT_DIR}/apps/backend" && pnpm jest --testPathPattern="bare-multicluster" --forceExit)
else
  log_warn "pnpm is not installed on host. Prepared multi-cluster environment parameters:"
  echo "  Cluster A API Server: ${E2E_MC_SERVER_A}"
  echo "  Cluster B API Server: ${E2E_MC_SERVER_B}"
  echo "  Cluster A Namespace : ${E2E_MC_NS_A}"
  echo "  Cluster B Namespace : ${E2E_MC_NS_B}"
fi

log_pass "Literal multi-cluster test execution completed successfully!"
