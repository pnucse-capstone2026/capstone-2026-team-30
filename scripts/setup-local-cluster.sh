#!/bin/bash
# 로컬 개발용 가상 Kubernetes 클러스터 및 Kyverno 랩 환경 원클릭 자동 셋업 스크립트 (Non-Sudo 안전 모드)
set -e

CLUSTER_NAME="k8s-lab"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/kind-config.yaml"

# 1. 로컬 가상 실행 경로 바인딩 (Sudo 권한 불필요 조치)
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "================================================"
echo " Starting Local Kubernetes Lab Environment Setup"
echo "================================================"

# 2. Kind CLI 자동 로컬 설치 (없을 시)
if ! command -v kind &> /dev/null; then
  echo ">>> Kind CLI not found. Installing Kind locally into scripts/bin..."
  KIND_VERSION="v0.22.0"
  curl -Lo "${LOCAL_BIN_DIR}/kind" "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
  chmod +x "${LOCAL_BIN_DIR}/kind"
  echo ">>> Kind CLI installed locally."
else
  echo ">>> Kind CLI is already available."
fi

# 3. Kubectl CLI 자동 로컬 설치 (없을 시)
if ! command -v kubectl &> /dev/null; then
  echo ">>> Kubectl CLI not found. Installing Kubectl locally into scripts/bin..."
  KUBECTL_VERSION="v1.29.2"
  curl -Lo "${LOCAL_BIN_DIR}/kubectl" "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
  chmod +x "${LOCAL_BIN_DIR}/kubectl"
  echo ">>> Kubectl CLI installed locally."
else
  echo ">>> Kubectl CLI is already available."
fi

# 4. Kind 클러스터 존재 여부 확인 및 생성
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo ">>> Cluster '${CLUSTER_NAME}' already exists. Skipping creation."
else
  echo ">>> Creating Kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"
fi

# 5. kubectl context 설정 보완 (WSL2 / DevContainer 포인팅 보정)
if getent hosts k8s-lab-control-plane > /dev/null; then
  echo ">>> Container-network environment detected. Fixing API server host in kubeconfig..."
  kubectl config set-cluster "kind-${CLUSTER_NAME}" \
    --server=https://k8s-lab-control-plane:6443 \
    --insecure-skip-tls-verify=true
fi

# 6. Helm CLI 자동 로컬 설치 (없을 시)
if ! command -v helm &> /dev/null; then
  echo ">>> Helm CLI not found. Installing Helm locally into scripts/bin..."
  HELM_VERSION="v3.14.0"
  curl -Lo "${LOCAL_BIN_DIR}/helm.tar.gz" "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz"
  tar -zxvf "${LOCAL_BIN_DIR}/helm.tar.gz" -C "${LOCAL_BIN_DIR}" --strip-components=1 linux-amd64/helm
  rm "${LOCAL_BIN_DIR}/helm.tar.gz"
  chmod +x "${LOCAL_BIN_DIR}/helm"
  echo ">>> Helm installed locally."
else
  echo ">>> Helm CLI is already available."
fi

# 7. Kyverno Helm 레포 추가 및 설치
echo ">>> Registering Kyverno Helm repository..."
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update

echo ">>> Deploying Kyverno to namespace 'kyverno'..."
# * 로컬 자원 보호: replica 수를 1개씩으로 제한
# * 예외 활성화: --set features.policyExceptions.enabled=true 설정 주입
helm upgrade --install kyverno kyverno/kyverno \
  --namespace kyverno \
  --create-namespace \
  --set admissionController.replicas=1 \
  --set backgroundController.replicas=1 \
  --set cleanupController.replicas=1 \
  --set reportsController.replicas=1 \
  --set features.policyExceptions.enabled=true \
  --set "features.policyExceptions.namespace=*" \
  --set features.validatingAdmissionPolicyReports.enabled=false \
  --set features.admissionReports.enabled=true \
  --set features.aggregateReports.enabled=true \
  --set features.policyReports.enabled=true

# 8. Kyverno 컨트롤러 Ready 상태 확인 및 대기
echo ">>> Waiting for Kyverno Admission Controller to be Ready..."
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=300s

# 9. 기본 테스트 정책 배포 (Disallow latest tag 등 보안 베이스라인 규정)
POLICIES_PATH="${SCRIPT_DIR}/../k8s-manifests/policies/disallow-latest-tag.yaml"
if [ -f "${POLICIES_PATH}" ]; then
  echo ">>> Applying initial baseline policies..."
  kubectl apply -f "${POLICIES_PATH}"
  echo ">>> Baseline policies successfully applied."
else
  echo ">>> Baseline policy path not found at: ${POLICIES_PATH}"
fi

# 10. 로컬 플랫폼 네임스페이스 생성 사전 보장
echo ">>> Ensuring 'kyverno-platform' namespace exists for local development..."
kubectl create namespace kyverno-platform --dry-run=client -o yaml | kubectl apply -f -

echo "================================================"
echo " Kubernetes Lab Setup Completed Successfully!"
echo "================================================"

