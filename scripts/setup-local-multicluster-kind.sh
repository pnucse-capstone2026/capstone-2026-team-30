#!/usr/bin/env bash
# ==============================================================================
# 로컬 가상 멀티클러스터(Kind Hub & Spoke with Argo CD) 원클릭 자동 구축 스크립트
# ==============================================================================
# [도입 배경] AWS 클라우드 비용 없이 로컬에서 분산 멀티클러스터 거버넌스,
#             Argo CD 배포 인시던트 감지 및 MLOps 거버넌스를 정밀 재현하기 위함
# [기대 효과] 2개의 독립된 Kind 클러스터(k8s-hub, k8s-spoke)에 Kyverno, Argo CD,
#             Kubeflow CRD 및 RBAC를 자동 배포하고 백엔드용 KUBERNETES_CLUSTERS 설정을 즉시 바인딩
# ==============================================================================

set -euo pipefail

HUB_CLUSTER="k8s-hub"
SPOKE_CLUSTER="k8s-spoke"
SPOKE_ID="external-argocd-cluster"
INSTALL_ARGOCD=true
INSTALL_MLOPS=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
CONFIG_PATH="${SCRIPT_DIR}/kind-config.yaml"

mkdir -p "${LOCAL_BIN_DIR}" 2>/dev/null || true
export PATH="${LOCAL_BIN_DIR}:${PATH}"

usage() {
  cat <<HELP
Usage: $(basename "$0") [OPTIONS]

Setup local dual-cluster Kind environment (Hub & Spoke) with Kyverno and Argo CD.

Options:
  --hub-name <name>         Kind cluster name for Hub (default: k8s-hub)
  --spoke-name <name>       Kind cluster name for Spoke (default: k8s-spoke)
  --spoke-id <id>           Logical Cluster ID for Spoke (default: external-argocd-cluster)
  --install-argocd          Deploy Argo CD to Spoke cluster (default: true)
  --no-argocd               Skip Argo CD deployment on Spoke cluster
  --install-mlops           Deploy Kubeflow Notebook CRD to Spoke cluster (default: true)
  --no-mlops                Skip Kubeflow Notebook CRD deployment
  -h, --help                Show this help message
HELP
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hub-name)
      HUB_CLUSTER="$2"
      shift 2
      ;;
    --spoke-name)
      SPOKE_CLUSTER="$2"
      shift 2
      ;;
    --spoke-id)
      SPOKE_ID="$2"
      shift 2
      ;;
    --install-argocd)
      INSTALL_ARGOCD=true
      shift
      ;;
    --no-argocd)
      INSTALL_ARGOCD=false
      shift
      ;;
    --install-mlops)
      INSTALL_MLOPS=true
      shift
      ;;
    --no-mlops)
      INSTALL_MLOPS=false
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

KUBECTL="kubectl"
if [ -f "${LOCAL_BIN_DIR}/kubectl" ]; then
  KUBECTL="${LOCAL_BIN_DIR}/kubectl"
fi

echo "=============================================================================="
echo " 🏗️  Setting up Local Multi-Cluster (Kind Hub & Spoke with Argo CD)"
echo "=============================================================================="
echo " 🌐 Hub Cluster   : ${HUB_CLUSTER} (id: ${HUB_CLUSTER})"
echo " 🌐 Spoke Cluster : ${SPOKE_CLUSTER} (id: ${SPOKE_ID})"
echo " 🐙 Argo CD on Spoke: ${INSTALL_ARGOCD}"
echo " 🧪 MLOps on Spoke  : ${INSTALL_MLOPS}"
echo "=============================================================================="

# 1. Kind CLI 설치 확인
if ! command -v kind &> /dev/null; then
  echo ">>> Installing Kind CLI..."
  curl -Lo "${LOCAL_BIN_DIR}/kind" "https://kind.sigs.k8s.io/dl/v0.22.0/kind-linux-amd64"
  chmod +x "${LOCAL_BIN_DIR}/kind"
fi

# 2. Helm CLI 설치 확인
if ! command -v helm &> /dev/null; then
  echo ">>> Installing Helm CLI..."
  curl -Lo "${LOCAL_BIN_DIR}/helm.tar.gz" "https://get.helm.sh/helm-v3.14.0-linux-amd64.tar.gz"
  tar -zxvf "${LOCAL_BIN_DIR}/helm.tar.gz" -C "${LOCAL_BIN_DIR}" --strip-components=1 linux-amd64/helm
  rm -f "${LOCAL_BIN_DIR}/helm.tar.gz"
  chmod +x "${LOCAL_BIN_DIR}/helm"
fi

# 3. Hub 클러스터 생성
if kind get clusters 2>/dev/null | grep -q "^${HUB_CLUSTER}$"; then
  echo ">>> Kind Hub cluster '${HUB_CLUSTER}' already exists."
else
  echo ">>> Creating Kind Hub cluster '${HUB_CLUSTER}'..."
  kind create cluster --name "${HUB_CLUSTER}" --config "${CONFIG_PATH}"
fi

# 4. Spoke 클러스터 생성
if kind get clusters 2>/dev/null | grep -q "^${SPOKE_CLUSTER}$"; then
  echo ">>> Kind Spoke cluster '${SPOKE_CLUSTER}' already exists."
else
  echo ">>> Creating Kind Spoke cluster '${SPOKE_CLUSTER}'..."
  kind create cluster --name "${SPOKE_CLUSTER}"
fi

# 5. Kyverno 배포 함수
deploy_kyverno() {
  local cluster_name="$1"
  local ctx="kind-${cluster_name}"

  echo ">>> Deploying Kyverno to ${cluster_name} (${ctx})..."
  helm repo add kyverno https://kyverno.github.io/kyverno/ --force-update >/dev/null 2>&1 || true
  helm repo update kyverno >/dev/null 2>&1

  helm upgrade --install kyverno kyverno/kyverno \
    --kube-context "${ctx}" \
    --namespace kyverno \
    --create-namespace \
    --set admissionController.replicas=1 \
    --set backgroundController.replicas=1 \
    --set cleanupController.replicas=1 \
    --set reportsController.replicas=1 \
    --set "reportsController.backgroundScan=true" \
    --set "reportsController.backgroundScanInterval=1h" \
    --set "backgroundController.backgroundScanInterval=1h" \
    --set admissionController.resources.requests.cpu=50m \
    --set admissionController.resources.requests.memory=128Mi \
    --set admissionController.resources.limits.cpu=500m \
    --set admissionController.resources.limits.memory=768Mi \
    --set backgroundController.resources.requests.cpu=50m \
    --set backgroundController.resources.requests.memory=128Mi \
    --set backgroundController.resources.limits.cpu=500m \
    --set backgroundController.resources.limits.memory=768Mi \
    --set cleanupController.resources.requests.cpu=50m \
    --set cleanupController.resources.requests.memory=64Mi \
    --set cleanupController.resources.limits.cpu=200m \
    --set cleanupController.resources.limits.memory=256Mi \
    --set reportsController.resources.requests.cpu=50m \
    --set reportsController.resources.requests.memory=128Mi \
    --set reportsController.resources.limits.cpu=500m \
    --set reportsController.resources.limits.memory=768Mi \
    --set features.policyExceptions.enabled=true \
    --set "features.policyExceptions.namespace=*" \
    --set features.validatingAdmissionPolicyReports.enabled=false \
    --set features.admissionReports.enabled=false \
    --set features.aggregateReports.enabled=true \
    --set features.policyReports.enabled=true >/dev/null 2>&1 || true

  # 거버넌스 정책 배포
  local policies_dir="${ROOT_DIR}/k8s-manifests/policies"
  if [ -d "${policies_dir}" ]; then
    ${KUBECTL} --context "${ctx}" apply -f "${policies_dir}/" --recursive 2>/dev/null || true
    ${KUBECTL} --context "${ctx}" get clusterpolicies -o name 2>/dev/null | xargs -I {} ${KUBECTL} --context "${ctx}" patch {} --type='merge' -p '{"spec":{"validationFailureAction":"Audit"}}' >/dev/null 2>&1 || true
  fi
}

deploy_kyverno "${HUB_CLUSTER}"
deploy_kyverno "${SPOKE_CLUSTER}"

# 6. Spoke 클러스터에 Argo CD 배포 (인시던트 감지 시나리오 대응)
if [ "${INSTALL_ARGOCD}" = true ]; then
  echo ">>> [Spoke] Deploying Argo CD to '${SPOKE_CLUSTER}'..."
  ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" create namespace argocd --dry-run=client -o yaml | ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" apply -f -
  ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" apply --server-side=true --force-conflicts -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml || {
    echo ">>> [WARN] Argo CD server-side apply failed, falling back to standard client apply..."
    ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml || true
  }
  echo ">>> [Spoke] Argo CD manifests applied."
fi

# 7. Spoke 클러스터에 Kubeflow Notebooks CRD & MLOps 네임스페이스 배포
if [ "${INSTALL_MLOPS}" = true ]; then
  echo ">>> [Spoke] Deploying Kubeflow Notebooks CRD & 'mlops-workspace' namespace..."
  ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" apply -f https://raw.githubusercontent.com/kubeflow/kubeflow/v1.8.0/components/notebook-controller/config/crd/bases/kubeflow.org_notebooks.yaml 2>/dev/null || true
  ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" create namespace mlops-workspace --dry-run=client -o yaml | ${KUBECTL} --context "kind-${SPOKE_CLUSTER}" apply -f -
fi

# 8. Spoke 클러스터 SA 토큰 및 엔드포인트 추출
echo ">>> Configuring Spoke ServiceAccount and Token..."
${KUBECTL} --context "kind-${SPOKE_CLUSTER}" apply -f - <<EOF >/dev/null 2>&1
apiVersion: v1
kind: Namespace
metadata:
  name: kyverno
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kyverno-dashboard-spoke-sa
  namespace: kyverno
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kyverno-dashboard-spoke-sa-binding
subjects:
- kind: ServiceAccount
  name: kyverno-dashboard-spoke-sa
  namespace: kyverno
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: Secret
metadata:
  name: kyverno-dashboard-spoke-sa-token
  namespace: kyverno
  annotations:
    kubernetes.io/service-account.name: kyverno-dashboard-spoke-sa
type: kubernetes.io/service-account-token
EOF

sleep 2
SPOKE_TOKEN=$(${KUBECTL} --context "kind-${SPOKE_CLUSTER}" get secret kyverno-dashboard-spoke-sa-token -n kyverno -o jsonpath='{.data.token}' | base64 --decode 2>/dev/null || echo "")
if [ -z "${SPOKE_TOKEN}" ]; then
  SPOKE_TOKEN=$(${KUBECTL} --context "kind-${SPOKE_CLUSTER}" create token kyverno-dashboard-spoke-sa -n kyverno --duration=87600h 2>/dev/null || echo "")
fi

SPOKE_SERVER=$(${KUBECTL} config view --minify --raw -o jsonpath="{.clusters[?(@.name=='kind-${SPOKE_CLUSTER}')].cluster.server}")
SPOKE_CA=$(${KUBECTL} config view --minify --raw -o jsonpath="{.clusters[?(@.name=='kind-${SPOKE_CLUSTER}')].cluster.certificate-authority-data}")

# Hub 클러스터 정보 추출
HUB_SERVER=$(${KUBECTL} config view --minify --raw -o jsonpath="{.clusters[?(@.name=='kind-${HUB_CLUSTER}')].cluster.server}")
HUB_CA=$(${KUBECTL} config view --minify --raw -o jsonpath="{.clusters[?(@.name=='kind-${HUB_CLUSTER}')].cluster.certificate-authority-data}")

# 9. Multi-Cluster JSON 설정 파일 생성 (NestJS ClusterProvider 규격)
MULTI_CLUSTERS_CONFIG=$(cat <<EOF
[
  {
    "id": "${HUB_CLUSTER}",
    "displayName": "Local Kind Hub Cluster",
    "exceptionNamespace": "kyverno",
    "server": "${HUB_SERVER}",
    "caData": "${HUB_CA}",
    "skipTLSVerify": true,
    "default": true
  },
  {
    "id": "${SPOKE_ID}",
    "displayName": "Local Kind Spoke Cluster (Argo CD Managed)",
    "exceptionNamespace": "kyverno",
    "server": "${SPOKE_SERVER}",
    "caData": "${SPOKE_CA}",
    "token": "${SPOKE_TOKEN}",
    "skipTLSVerify": true,
    "default": false
  }
]
EOF
)

mkdir -p "${ROOT_DIR}/config"
echo "${MULTI_CLUSTERS_CONFIG}" > "${ROOT_DIR}/config/local-multi-clusters.json"

# 10. Hub 클러스터 내 'kyverno-platform' 네임스페이스 및 backend-env-secret 동기화
${KUBECTL} --context "kind-${HUB_CLUSTER}" create namespace kyverno-platform --dry-run=client -o yaml | ${KUBECTL} --context "kind-${HUB_CLUSTER}" apply -f - 2>/dev/null || true

${KUBECTL} --context "kind-${HUB_CLUSTER}" create secret generic backend-env-secret \
  -n kyverno-platform \
  --from-literal=CLUSTER_PROVIDER="multi" \
  --from-literal=KUBERNETES_CLUSTERS="$(echo "${MULTI_CLUSTERS_CONFIG}" | tr -d '\n')" \
  --from-literal=GITOPS_ENABLED="true" \
  --dry-run=client -o yaml | ${KUBECTL} --context "kind-${HUB_CLUSTER}" apply -f - 2>/dev/null || true

echo "=============================================================================="
echo " 🎉 Local Multi-Cluster Setup with Argo CD Completed Successfully!"
echo "=============================================================================="
echo " 🌐 Hub   : kind-${HUB_CLUSTER} (id: ${HUB_CLUSTER}, server: ${HUB_SERVER})"
echo " 🌐 Spoke : kind-${SPOKE_CLUSTER} (id: ${SPOKE_ID}, server: ${SPOKE_SERVER})"
echo " 🐙 ArgoCD: $([ "${INSTALL_ARGOCD}" = true ] && echo "Installed on ${SPOKE_CLUSTER} (ns: argocd)" || echo "Skipped")"
echo " 📄 Saved Config: config/local-multi-clusters.json"
echo " 🔒 Injected Secret: backend-env-secret in namespace kyverno-platform (Hub)"
echo " 💡 Set in .env (for local backend run):"
echo "    CLUSTER_PROVIDER=multi"
echo "    KUBERNETES_CLUSTERS='$(echo "${MULTI_CLUSTERS_CONFIG}" | tr -d '\n')'"
echo "=============================================================================="
