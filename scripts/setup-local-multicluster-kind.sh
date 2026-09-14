#!/usr/bin/env bash
# ==============================================================================
# 로컬 가상 멀티클러스터(Kind Hub & Spoke) 원클릭 자동 구축 스크립트
# ==============================================================================
# [도입 배경] AWS 클라우드 비용 없이 로컬에서 분산 멀티클러스터 거버넌스 및 
#             대규모 Tier-2 성능 벤치마크를 정밀 재현하기 위함
# [기대 효과] 2개의 독립된 Kind 클러스터(k8s-hub, k8s-spoke)에 Kyverno 및 RBAC를
#             자동 배포하고 백엔드용 KUBERNETES_CLUSTERS 설정을 즉시 바인딩
# ==============================================================================

set -euo pipefail

HUB_CLUSTER="k8s-hub"
SPOKE_CLUSTER="k8s-spoke"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
CONFIG_PATH="${SCRIPT_DIR}/kind-config.yaml"

mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="kubectl"
if [ -f "${LOCAL_BIN_DIR}/kubectl" ]; then
  KUBECTL="${LOCAL_BIN_DIR}/kubectl"
fi

echo "=============================================================================="
echo " 🏗️  Setting up Local Multi-Cluster (Kind Hub & Spoke)"
echo "=============================================================================="
echo " 🌐 Hub Cluster   : ${HUB_CLUSTER}"
echo " 🌐 Spoke Cluster : ${SPOKE_CLUSTER}"
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
  helm repo update >/dev/null 2>&1

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
  local policies_dir="${SCRIPT_DIR}/../k8s-manifests/policies"
  if [ -d "${policies_dir}" ]; then
    ${KUBECTL} --context "${ctx}" apply -f "${policies_dir}/" --recursive 2>/dev/null || true
    ${KUBECTL} --context "${ctx}" get clusterpolicies -o name 2>/dev/null | xargs -I {} ${KUBECTL} --context "${ctx}" patch {} --type='merge' -p '{"spec":{"validationFailureAction":"Audit"}}' >/dev/null 2>&1 || true
  fi
}

deploy_kyverno "${HUB_CLUSTER}"
deploy_kyverno "${SPOKE_CLUSTER}"

# 6. Spoke 클러스터 SA 토큰 및 엔드포인트 추출
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

# 7. Multi-Cluster JSON 설정 파일 생성 (.env 및 scratch용)
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
    "id": "${SPOKE_CLUSTER}",
    "displayName": "Local Kind Remote Spoke Cluster",
    "exceptionNamespace": "kyverno",
    "server": "${SPOKE_SERVER}",
    "caData": "${SPOKE_CA}",
    "token": "${SPOKE_TOKEN}",
    "skipTLSVerify": true
  }
]
EOF
)

mkdir -p "${ROOT_DIR}/config"
echo "${MULTI_CLUSTERS_CONFIG}" > "${ROOT_DIR}/config/local-multi-clusters.json"

echo "=============================================================================="
echo " 🎉 Local Multi-Cluster Setup Completed Successfully!"
echo "=============================================================================="
echo " 🌐 Hub   : kind-${HUB_CLUSTER} (${HUB_SERVER})"
echo " 🌐 Spoke : kind-${SPOKE_CLUSTER} (${SPOKE_SERVER})"
echo " 📄 Saved Config: config/local-multi-clusters.json"
echo " 💡 Set in .env:"
echo "    CLUSTER_PROVIDER=multi"
echo "    KUBERNETES_CLUSTERS='$(echo "${MULTI_CLUSTERS_CONFIG}" | tr -d '\n')'"
echo "=============================================================================="
