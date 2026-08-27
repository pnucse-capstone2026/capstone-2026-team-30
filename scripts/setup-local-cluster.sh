#!/bin/bash
# 로컬 개발용 가상 Kubernetes 클러스터 경량화(Bare Minimum) 셋업 스크립트
# [도입 배경] 단일 클러스터, 최소 노드 및 필수 컨트롤러 위주 배포로 호스트 CPU/RAM 자원 부하 최소화
# [기대 효과] 경량화된 로컬 검증 환경을 신속하게 구성하여 개발 및 테스트 루프 단축

set -e

CLUSTER_NAME="k8s-lab"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/kind-config.yaml"
MINIMAL_MODE=true

# 터미널 파라미터 파싱 (--full 활성화 시 전체 컨트롤러 배포, 기본값은 경량화 모드 --minimal)
while [[ $# -gt 0 ]]; do
  case $1 in
    --full)
      MINIMAL_MODE=false
      shift
      ;;
    --minimal)
      MINIMAL_MODE=true
      shift
      ;;
    --cluster-name)
      CLUSTER_NAME="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# 1. 로컬 가상 실행 경로 바인딩 (Sudo 권한 불필요 조치)
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "================================================="
echo " Starting Local Kubernetes Minimum Test Setup"
echo " Target Cluster : ${CLUSTER_NAME}"
echo " Minimal Mode   : ${MINIMAL_MODE}"
echo "================================================="

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

# 4. Kind 단일 클러스터 (최소 단일 노드) 존재 여부 확인 및 생성
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo ">>> Single Kind cluster '${CLUSTER_NAME}' already exists. Skipping creation."
else
  echo ">>> Creating single-node Kind cluster '${CLUSTER_NAME}' (bare minimum topology)..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"
fi

# 5. kubectl context 설정 보완 (DevContainer 및 호스트 간 네트워크 연결 보정)
if getent hosts "${CLUSTER_NAME}-control-plane" > /dev/null 2>&1; then
  echo ">>> Container-network environment detected. Fixing API server host in kubeconfig..."
  kubectl config set-cluster "kind-${CLUSTER_NAME}" \
    --server="https://${CLUSTER_NAME}-control-plane:6443" \
    --insecure-skip-tls-verify=true
fi

# 6. Helm CLI 자동 로컬 설치 (없을 시)
if ! command -v helm &> /dev/null; then
  echo ">>> Helm CLI not found. Installing Helm locally into scripts/bin..."
  HELM_VERSION="v3.14.0"
  curl -Lo "${LOCAL_BIN_DIR}/helm.tar.gz" "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz"
  tar -zxvf "${LOCAL_BIN_DIR}/helm.tar.gz" -C "${LOCAL_BIN_DIR}" --strip-components=1 linux-amd64/helm
  rm -f "${LOCAL_BIN_DIR}/helm.tar.gz"
  chmod +x "${LOCAL_BIN_DIR}/helm"
  echo ">>> Helm installed locally."
else
  echo ">>> Helm CLI is already available."
fi

# 7. Kyverno Helm 레포 추가 및 경량화 설정 배포
echo ">>> Registering Kyverno Helm repository..."
helm repo add kyverno https://kyverno.github.io/kyverno/ --force-update > /dev/null 2>&1 || true
helm repo update kyverno > /dev/null 2>&1

if [ "${MINIMAL_MODE}" = true ]; then
  echo ">>> Deploying lightweight Kyverno (Admission Controller only with strict CPU/RAM limits)..."
  # [경량화 핵심 조치] 로컬 부하 방지를 위해 어드미션 컨트롤러만 1개 배치하고 불필요 컨트롤러 오프로딩
  helm upgrade --install kyverno kyverno/kyverno \
    --namespace kyverno \
    --create-namespace \
    --set admissionController.replicas=1 \
    --set backgroundController.enabled=false \
    --set cleanupController.enabled=false \
    --set reportsController.enabled=false \
    --set admissionController.resources.requests.cpu=50m \
    --set admissionController.resources.requests.memory=64Mi \
    --set admissionController.resources.limits.cpu=200m \
    --set admissionController.resources.limits.memory=256Mi \
    --set features.policyExceptions.enabled=true \
    --set "features.policyExceptions.namespace=*" \
    --set features.validatingAdmissionPolicyReports.enabled=false \
    --set features.admissionReports.enabled=false \
    --set features.aggregateReports.enabled=false \
    --set features.policyReports.enabled=false
else
  echo ">>> Deploying Kyverno full suite with single replica optimization..."
  helm upgrade --install kyverno kyverno/kyverno \
    --namespace kyverno \
    --create-namespace \
    --set admissionController.replicas=1 \
    --set backgroundController.replicas=1 \
    --set cleanupController.replicas=1 \
    --set reportsController.replicas=1 \
    --set admissionController.resources.requests.cpu=50m \
    --set admissionController.resources.requests.memory=64Mi \
    --set admissionController.resources.limits.cpu=200m \
    --set admissionController.resources.limits.memory=256Mi \
    --set features.policyExceptions.enabled=true \
    --set "features.policyExceptions.namespace=*" \
    --set features.validatingAdmissionPolicyReports.enabled=false \
    --set features.admissionReports.enabled=true \
    --set features.aggregateReports.enabled=true \
    --set features.policyReports.enabled=true
fi

# 8. Kyverno 어드미션 컨트롤러 Ready 상태 확인 및 대기
echo ">>> Waiting for Kyverno Admission Controller to be Ready..."
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=180s

# 9. 기본 테스트 정책 배포 (보안 베이스라인 규정)
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

echo "================================================="
echo " Bare Minimum Kubernetes Lab Setup Completed! 🚀"
echo " Active Nodes    : 1 Control-Plane Node"
echo " Kyverno Mode    : Admission Controller Only"
echo " Resource Load   : Optimized for Minimal CPU/RAM"
echo "================================================="
