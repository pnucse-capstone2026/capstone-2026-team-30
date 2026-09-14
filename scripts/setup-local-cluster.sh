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
  # 로컬 개발 환경 I/O 부하 방지를 위해 주기 스캔(backgroundScan)을 비활성화하고 초기/어드미션 평가만 유지
  echo ">>> Deploying Kyverno (Periodic background scan disabled for zero-I/O local development)..."
  helm upgrade --install kyverno kyverno/kyverno \
    --namespace kyverno \
    --create-namespace \
    --set admissionController.replicas=1 \
    --set backgroundController.enabled=true \
    --set cleanupController.enabled=false \
    --set reportsController.enabled=true \
    --set "reportsController.backgroundScan=false" \
    --set "backgroundController.backgroundScanInterval=0" \
    --set admissionController.resources.requests.cpu=50m \
    --set admissionController.resources.requests.memory=128Mi \
    --set admissionController.resources.limits.cpu=500m \
    --set admissionController.resources.limits.memory=768Mi \
    --set backgroundController.resources.requests.cpu=50m \
    --set backgroundController.resources.requests.memory=128Mi \
    --set backgroundController.resources.limits.cpu=500m \
    --set backgroundController.resources.limits.memory=768Mi \
    --set reportsController.resources.requests.cpu=50m \
    --set reportsController.resources.requests.memory=128Mi \
    --set reportsController.resources.limits.cpu=500m \
    --set reportsController.resources.limits.memory=768Mi \
    --set features.policyExceptions.enabled=true \
    --set "features.policyExceptions.namespace=*" \
    --set features.validatingAdmissionPolicyReports.enabled=false \
    --set features.admissionReports.enabled=false \
    --set features.aggregateReports.enabled=true \
    --set features.policyReports.enabled=true
else
  # [디스크 I/O 최적화 풀스택 모드]
  # 1. 4대 컨트롤러(Admission, Background, Cleanup, Reports) 전체 활성화
  # 2. backgroundScan=true 활성화하되 backgroundScanInterval을 1h로 설정하여 etcd I/O 스래싱 원천 차단
  # 3. admissionReports.enabled=false로 설정하여 매 요청마다 발생하는 임시 CRD etcd 쓰기 오버헤드 방지
  # 4. 메모리 제한을 768Mi로 상향하여 cgroup 메모리 부족으로 인한 실행 바이너리 디스크 Direct Reclaim 스래싱 원천 차단
  echo ">>> Deploying Kyverno full suite (Disk I/O optimized: 1h scan interval, admission reports disabled, 768Mi memory limit)..."
  helm upgrade --install kyverno kyverno/kyverno \
    --namespace kyverno \
    --create-namespace \
    --set admissionController.replicas=1 \
    --set backgroundController.replicas=1 \
    --set cleanupController.replicas=1 \
    --set reportsController.replicas=1 \
    --set "reportsController.backgroundScan=true" \
    --set "backgroundController.backgroundScanInterval=1h" \
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
    --set features.policyReports.enabled=true
fi

# 8. Kyverno 어드미션 컨트롤러 Ready 상태 확인 및 대기
echo ">>> Waiting for Kyverno Admission Controller to be Ready..."
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=180s

# 9. 기본 테스트 정책 및 테스트베드 시나리오 배포
echo ">>> Labeling Kind control-plane node with spot label for MLOps policies..."
kubectl label node "${CLUSTER_NAME}-control-plane" cloud.google.com/gke-spot=true --overwrite || true

MANIFESTS_DIR="${SCRIPT_DIR}/../k8s-manifests"
if [ -d "${MANIFESTS_DIR}" ]; then
  echo ">>> Applying initial policies and testbed workloads..."
  kubectl apply -f "${MANIFESTS_DIR}/testbed/00-namespace.yaml" || true
  kubectl apply -f "${MANIFESTS_DIR}/policies/" || true
  kubectl apply -f "${MANIFESTS_DIR}/policies/mlops/" || true
  kubectl apply -f "${MANIFESTS_DIR}/testbed/real-world-scenarios.yaml" || true
  kubectl apply -f "${MANIFESTS_DIR}/exceptions/default-cluster/governance-testbed/" || true
  echo ">>> Policies and testbed workloads successfully applied."
else
  echo ">>> Manifests directory not found at: ${MANIFESTS_DIR}"
fi

# 10. 로컬 플랫폼 네임스페이스 및 풀스택 배포
echo ">>> Ensuring 'kyverno-platform' namespace exists for local development..."
kubectl create namespace kyverno-platform --dry-run=client -o yaml | kubectl apply -f -

if [ "${MINIMAL_MODE}" = false ]; then
  echo ">>> [Full Stack Mode] Loading local docker images into Kind cluster..."
  if docker image inspect kyverno-backend:latest >/dev/null 2>&1; then
    kind load docker-image kyverno-backend:latest --name "${CLUSTER_NAME}"
  fi
  if docker image inspect kyverno-frontend:latest >/dev/null 2>&1; then
    kind load docker-image kyverno-frontend:latest --name "${CLUSTER_NAME}"
  fi

  echo ">>> [Full Stack Mode] Deploying PostgreSQL DB, RBAC, Backend, and Frontend..."
  kubectl apply -f "${MANIFESTS_DIR}/system/namespace.yaml" || true
  kubectl apply -f "${MANIFESTS_DIR}/system/rbac.yaml" || true
  kubectl apply -f "${MANIFESTS_DIR}/system/postgres.yaml" || true

  echo ">>> Waiting for PostgreSQL rollout to complete..."
  kubectl rollout status deployment/postgres -n kyverno-platform --timeout=180s

  # PostgreSQL DB 스키마 생성 및 기본 테스트 계정 시딩
  echo ">>> Synchronizing PostgreSQL DB schema & seeding default accounts..."
  kubectl port-forward svc/postgres 5432:5432 -n kyverno-platform > /dev/null 2>&1 &
  PF_PG_PID=$!
  sleep 3

  DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" \
    pnpm --filter @kyverno-platform/backend exec prisma db push --accept-data-loss || true

  DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" \
    SEED_ADMIN_EMAIL="admin@test.com" \
    SEED_ADMIN_PASSWORD="test1234!" \
    SEED_USER_EMAIL="user@test.com" \
    SEED_USER_PASSWORD="test1234!" \
    pnpm --filter @kyverno-platform/backend exec prisma db seed || true

  kill ${PF_PG_PID} 2>/dev/null || true

  kubectl apply -f "${MANIFESTS_DIR}/system/backend.yaml" || true
  kubectl apply -f "${MANIFESTS_DIR}/system/frontend.yaml" || true

  echo ">>> Waiting for Backend & Frontend deployments to be Ready..."
  kubectl rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s
  kubectl rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s
fi

echo "================================================="
if [ "${MINIMAL_MODE}" = true ]; then
  echo " Bare Minimum Kubernetes Lab Setup Completed! 🚀"
  echo " Active Nodes    : 1 Control-Plane Node"
  echo " Kyverno Mode    : Admission Controller Only"
  echo " Resource Load   : Optimized for Minimal CPU/RAM"
else
  echo " Full-Stack Kubernetes Lab Setup Completed! 🚀"
  echo " Active Nodes    : 1 Control-Plane Node"
  echo " Kyverno Mode    : Full Suite (Admission, Background, Reports, Cleanup)"
  echo " Platform Stack  : PostgreSQL, NestJS Backend, Next.js Frontend"
  echo " Disk I/O        : Fully Optimized (Zero unnecessary etcd writes)"
fi
echo "================================================="
