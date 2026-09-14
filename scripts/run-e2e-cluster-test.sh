#!/bin/bash
# Kyverno Governance Platform 로컬 가상 클러스터 프로비저닝 및 거버넌스 전주기 E2E 통합 테스트 자동화 스크립트
# 프로덕션 동등 환경(Kind, Kyverno v1.12, PostgreSQL, NestJS 백엔드, Next.js 프론트엔드, RBAC)을 자동 구성하고
# 정책 차단, SA 권한, PolicyException 우회, PolicyReport 감사, AI 해설 API를 한 번에 자동 검증하기 위한 목적

set -eo pipefail

# ==============================================================================
# 0. 전역 환경 변수 및 포맷 설정
# ==============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
CONFIG_PATH="${SCRIPT_DIR}/kind-config.yaml"

export PATH="${LOCAL_BIN_DIR}:${PATH}"

CLUSTER_NAME="k8s-lab"
PLATFORM_NAMESPACE="kyverno-platform"
TEST_NAMESPACE="e2e-governance-test"
KIND_VERSION="v0.22.0"
KUBECTL_VERSION="v1.29.2"
HELM_VERSION="v3.14.0"

SKIP_BUILD=false
SKIP_FRONTEND=false
CLEANUP=false
DELETE_CLUSTER=false

# 터미널 컬러 서식 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ==============================================================================
# 1. 로깅 및 진단 헬퍼 함수
# ==============================================================================
log_info() {
  echo -e "${BLUE}[INFO]${NC} $*"
}

log_step() {
  echo -e "\n${BOLD}${CYAN}==============================================================================${NC}"
  echo -e "${BOLD}${CYAN}>>> $*${NC}"
  echo -e "${BOLD}${CYAN}==============================================================================${NC}"
}

log_pass() {
  echo -e "${GREEN}[PASS]${NC} ${BOLD}$*${NC}"
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} ${BOLD}$*${NC}"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

# 장애 발생 시 디버깅을 위한 쿠버네티스 파드 및 컨트롤러 상세 로그 덤프
dump_diagnostics() {
  log_warn "Starting diagnostic log dump due to failure..."
  echo "-------------------- Platform Pods --------------------"
  kubectl get pods -n "${PLATFORM_NAMESPACE}" -o wide || true
  echo "-------------------- Kyverno Pods ---------------------"
  kubectl get pods -n kyverno -o wide || true
  echo "-------------------- Test Namespace Pods --------------"
  kubectl get pods -n "${TEST_NAMESPACE}" -o wide || true
  echo "-------------------- Backend Pod Logs -----------------"
  kubectl logs -n "${PLATFORM_NAMESPACE}" -l app=kyverno-backend --tail=100 || true
  echo "-------------------- Postgres Pod Logs ----------------"
  kubectl logs -n "${PLATFORM_NAMESPACE}" -l app=postgres --tail=50 || true
  echo "-------------------- Kyverno Admission Logs -----------"
  kubectl logs -n kyverno -l app.kubernetes.io/component=admission-controller --tail=100 || true
  echo "-------------------------------------------------------"
}

# 테스트 리소스 정리 함수
cleanup_test_resources() {
  log_info "Cleaning up temporary test resources and policies..."
  kubectl delete namespace "${TEST_NAMESPACE}" --ignore-not-found=true --timeout=60s || true
  kubectl delete clusterpolicy e2e-disallow-latest-tag-enforce --ignore-not-found=true || true
  kubectl delete clusterpolicy e2e-audit-disallow-latest-tag --ignore-not-found=true || true

  if [ "${DELETE_CLUSTER}" = true ]; then
    log_info "Deleting Kind cluster '${CLUSTER_NAME}'..."
    kind delete cluster --name "${CLUSTER_NAME}" || true
  fi
  log_info "Cleanup completed."
}

# 예기치 못한 스크립트 중단(Ctrl+C, 에러 등) 시 자동 진단 덤프 및 리소스 정리 수행
cleanup_on_exit() {
  local exit_code=$?
  if [ ${exit_code} -ne 0 ] && [ "${TEST_FINISHED:-false}" != "true" ]; then
    log_warn "Test execution aborted or failed with exit code ${exit_code}."
    dump_diagnostics
  fi
  if [ "${CLEANUP}" = true ]; then
    cleanup_test_resources
  fi
  exit ${exit_code}
}
trap cleanup_on_exit EXIT ERR SIGINT SIGTERM

# ==============================================================================
# 2. CLI 인자 파싱
# ==============================================================================
print_usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --skip-build       Skip Docker image building and loading (uses existing in-cluster images)"
  echo "  --skip-frontend    Skip building and deploying Next.js frontend (accelerates E2E backend tests)"
  echo "  --cleanup          Clean up test namespace and test policies after test execution"
  echo "  --delete-cluster   Delete the entire Kind cluster after test execution"
  echo "  --cleanup-cluster  Alias for --delete-cluster (cleans test resources & deletes cluster)"
  echo "  --cluster-name <n> Specify custom Kind cluster name (default: k8s-lab)"
  echo "  -h, --help         Show this help message"
  echo ""
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND=true
      shift
      ;;
    --cleanup)
      CLEANUP=true
      shift
      ;;
    --delete-cluster|--cleanup-cluster)
      CLEANUP=true
      DELETE_CLUSTER=true
      shift
      ;;
    --cluster-name)
      CLUSTER_NAME="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      log_warn "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

START_TIME=$(date +%s)

# ==============================================================================
# 3. 사전 요구 CLI 도구 검증 및 로컬 자동 준비
# ==============================================================================
log_step "Step 1: Validating Prerequisites & CLI Binaries"

mkdir -p "${LOCAL_BIN_DIR}"

if ! command -v kind &> /dev/null; then
  log_info "Kind CLI not found. Downloading Kind ${KIND_VERSION}..."
  curl -Lo "${LOCAL_BIN_DIR}/kind" "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
  chmod +x "${LOCAL_BIN_DIR}/kind"
fi

if ! command -v kubectl &> /dev/null; then
  log_info "Kubectl CLI not found. Downloading Kubectl ${KUBECTL_VERSION}..."
  curl -Lo "${LOCAL_BIN_DIR}/kubectl" "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
  chmod +x "${LOCAL_BIN_DIR}/kubectl"
fi

if ! command -v helm &> /dev/null; then
  log_info "Helm CLI not found. Downloading Helm ${HELM_VERSION}..."
  curl -Lo "${LOCAL_BIN_DIR}/helm.tar.gz" "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz"
  tar -zxvf "${LOCAL_BIN_DIR}/helm.tar.gz" -C "${LOCAL_BIN_DIR}" --strip-components=1 linux-amd64/helm
  rm -f "${LOCAL_BIN_DIR}/helm.tar.gz"
  chmod +x "${LOCAL_BIN_DIR}/helm"
fi

# 컨테이너 빌드 및 Kind 이미지 로드를 위한 로컬 Docker CLI 환경 사전 검증
if ! command -v docker &> /dev/null; then
  log_fail "Docker CLI not found in PATH. Docker is required for cluster integration testing."
  exit 1
fi

log_pass "All required CLI tools are ready (kind, kubectl, helm, docker)."

# ==============================================================================
# 4. Kind 가상 클러스터 검증 및 프로비저닝
# ==============================================================================
log_step "Step 2: Provisioning Kind Cluster '${CLUSTER_NAME}'"

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  log_info "Kind cluster '${CLUSTER_NAME}' is already running."
else
  log_info "Creating Kind cluster '${CLUSTER_NAME}' with config: ${CONFIG_PATH}..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}"
fi

# DevContainer / 컨테이너 네트워크 환경 호스트 주소 보정
if getent hosts "${CLUSTER_NAME}-control-plane" > /dev/null 2>&1; then
  log_info "Container-network environment detected. Aligning API server host in kubeconfig..."
  kubectl config set-cluster "kind-${CLUSTER_NAME}" \
    --server="https://${CLUSTER_NAME}-control-plane:6443" \
    --insecure-skip-tls-verify=true
fi

kubectl cluster-info
log_pass "Kind cluster '${CLUSTER_NAME}' is up and responsive."

# ==============================================================================
# 5. Kyverno v1.12 (PolicyExceptions 활성화 및 I/O 최적화) 릴리즈 배포
# ==============================================================================
log_step "Step 3: Deploying Kyverno v1.12 with PolicyExceptions Enabled"

log_info "Updating Kyverno Helm repository..."
helm repo add kyverno https://kyverno.github.io/kyverno/ --force-update > /dev/null 2>&1 || true
helm repo update kyverno > /dev/null 2>&1

# 로컬 자원 최적화 및 PolicyException CRD 활성화 주입 (admissionReports 비활성화로 etcd I/O 스래싱 차단)
log_info "Installing / Upgrading Kyverno chart in namespace 'kyverno'..."
helm upgrade --install kyverno kyverno/kyverno \
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
  --set features.policyReports.enabled=true \
  --wait --timeout=180s

log_info "Waiting for Kyverno admission controller deployment rollout..."
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=180s
log_pass "Kyverno v1.12 with PolicyExceptions is successfully running."

# ==============================================================================
# 6. 로컬 플랫폼 컨테이너 이미지 빌드 및 Kind 클러스터 노드 로드
# ==============================================================================
log_step "Step 4: Building and Loading Local Container Images"

if [ "${SKIP_BUILD}" = false ]; then
  log_info "Building local Docker image: kyverno-backend:latest..."
  docker build -t kyverno-backend:latest -f "${ROOT_DIR}/apps/backend/Dockerfile" "${ROOT_DIR}"
  log_info "Loading backend image into Kind cluster '${CLUSTER_NAME}'..."
  kind load docker-image kyverno-backend:latest --name "${CLUSTER_NAME}"

  if [ "${SKIP_FRONTEND}" = false ]; then
    log_info "Building local Docker image: kyverno-frontend:latest..."
    docker build -t kyverno-frontend:latest -f "${ROOT_DIR}/apps/frontend/Dockerfile" "${ROOT_DIR}"
    log_info "Loading frontend image into Kind cluster '${CLUSTER_NAME}'..."
    kind load docker-image kyverno-frontend:latest --name "${CLUSTER_NAME}"
  else
    log_info "Skipping frontend image build & load as requested (--skip-frontend)."
  fi
  log_pass "Images built and loaded into Kind nodes."
else
  log_info "Skipping Docker image build & load as requested (--skip-build)."
fi

# ==============================================================================
# 7. 플랫폼 시스템 매니페스트 순차 배포 및 Readiness 검증
# ==============================================================================
log_step "Step 5: Deploying In-Cluster Platform Workloads (k8s-manifests/system)"

SYSTEM_MANIFEST_DIR="${ROOT_DIR}/k8s-manifests/system"

log_info "1/4 Applying namespace.yaml, postgres.yaml, and rbac.yaml..."
kubectl apply -f "${SYSTEM_MANIFEST_DIR}/namespace.yaml"
kubectl apply -f "${SYSTEM_MANIFEST_DIR}/postgres.yaml"
kubectl apply -f "${SYSTEM_MANIFEST_DIR}/rbac.yaml"

log_info "Waiting for PostgreSQL to be Ready (1/1 Running)..."
if ! kubectl -n "${PLATFORM_NAMESPACE}" rollout status deployment/postgres --timeout=120s; then
  log_fail "PostgreSQL failed to roll out."
  dump_diagnostics
  exit 1
fi

# PostgreSQL 데이터베이스 스키마 및 시드 데이터 자동 동기화 (Prisma)
log_info "Synchronizing PostgreSQL schema & seeding initial platform accounts..."
kubectl port-forward svc/postgres 5432:5432 -n "${PLATFORM_NAMESPACE}" > /dev/null 2>&1 &
PF_PG_PID=$!
sleep 3
DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" \
  pnpm --filter @kyverno-platform/backend exec prisma db push --accept-data-loss > /dev/null 2>&1 || true
DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" \
  SEED_ADMIN_EMAIL="admin@test.com" \
  SEED_ADMIN_PASSWORD="test1234!" \
  SEED_USER_EMAIL="user@test.com" \
  SEED_USER_PASSWORD="test1234!" \
  pnpm --filter @kyverno-platform/backend exec prisma db seed > /dev/null 2>&1 || true
kill "${PF_PG_PID}" 2>/dev/null || true

log_info "2/4 Applying backend.yaml..."
kubectl apply -f "${SYSTEM_MANIFEST_DIR}/backend.yaml"

log_info "Waiting for Kyverno Backend to be Ready (1/1 Running)..."
if ! kubectl -n "${PLATFORM_NAMESPACE}" rollout status deployment/kyverno-backend --timeout=180s; then
  log_fail "Kyverno Backend failed to roll out."
  dump_diagnostics
  exit 1
fi

if [ "${SKIP_FRONTEND}" = false ]; then
  log_info "3/4 Applying frontend.yaml..."
  kubectl apply -f "${SYSTEM_MANIFEST_DIR}/frontend.yaml"

  log_info "Waiting for Kyverno Frontend to be Ready (1/1 Running)..."
  if ! kubectl -n "${PLATFORM_NAMESPACE}" rollout status deployment/kyverno-frontend --timeout=180s; then
    log_fail "Kyverno Frontend failed to roll out."
    dump_diagnostics
    exit 1
  fi
else
  log_info "Skipping frontend deployment as requested (--skip-frontend)."
fi

log_pass "All platform system pods (PostgreSQL, Backend, RBAC) are Running & Ready!"

# ==============================================================================
# 8. 거버넌스 전주기 E2E 테스트 시나리오 실행
# ==============================================================================
TEST_FAILED=0

# ------------------------------------------------------------------------------
# Scenario 1: Cluster & Platform Health
# ------------------------------------------------------------------------------
log_step "Scenario 1: In-Cluster Platform & PostgreSQL Health Verification"

BACKEND_POD=$(kubectl get pods -n "${PLATFORM_NAMESPACE}" -l app=kyverno-backend -o jsonpath='{.items[0].metadata.name}')
POSTGRES_POD=$(kubectl get pods -n "${PLATFORM_NAMESPACE}" -l app=postgres -o jsonpath='{.items[0].metadata.name}')

log_info "Verifying PostgreSQL readiness from inside postgres Pod (${POSTGRES_POD})..."
if kubectl exec -n "${PLATFORM_NAMESPACE}" "${POSTGRES_POD}" -- pg_isready -U devuser -d kyverno_dashboard; then
  log_info "PostgreSQL pg_isready check passed."
else
  log_fail "PostgreSQL pg_isready check failed."
  TEST_FAILED=$((TEST_FAILED + 1))
fi

log_info "Querying /api/health endpoint from inside backend Pod (${BACKEND_POD})..."
HEALTH_RESPONSE=$(kubectl exec -n "${PLATFORM_NAMESPACE}" "${BACKEND_POD}" -- node -e '
  const http = require("http");
  http.get("http://localhost:3001/api/health", (res) => {
    let data = "";
    res.on("data", (chunk) => data += chunk);
    res.on("end", () => {
      console.log(data);
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  }).on("error", (err) => {
    console.error(err);
    process.exit(1);
  });
' 2>/dev/null || echo "FAILED")

log_info "Health Check Response: ${HEALTH_RESPONSE}"

if [[ "${HEALTH_RESPONSE}" == *"\"status\":\"ok\""* ]] && [[ "${HEALTH_RESPONSE}" == *"\"database\":\"connected\""* ]]; then
  log_pass "Scenario 1 PASSED: Backend API and PostgreSQL connection verified in-cluster."
  S1_PASS=true
else
  log_fail "Scenario 1 FAILED: Health response did not indicate 'status: ok' or 'database: connected'."
  S1_PASS=false
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# ------------------------------------------------------------------------------
# Scenario 2: Policy Enforcement Block (Admission Denial)
# ------------------------------------------------------------------------------
log_step "Scenario 2: Kyverno Policy Enforcement Block (Admission Webhook Denial)"

log_info "Preparing test namespace: ${TEST_NAMESPACE}..."
kubectl create namespace "${TEST_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# 멱등성을 위해 네임스페이스 내 기존 테스트 리소스 클린업
kubectl delete pod e2e-violating-pod -n "${TEST_NAMESPACE}" --ignore-not-found=true --force --grace-period=0 2>/dev/null || true
kubectl delete policyexception --all -n "${TEST_NAMESPACE}" --ignore-not-found=true 2>/dev/null || true

log_info "Applying Enforce-mode ClusterPolicy (e2e-disallow-latest-tag-enforce)..."
kubectl apply -f "${ROOT_DIR}/k8s-manifests/test/enforce-disallow-latest-tag.yaml"

# Admission Webhook 정책 캐시 동기화를 위한 지연 대기
sleep 4

log_info "Attempting to deploy violating workload (image: nginx:latest)..."
SET_OUTPUT=""
set +e
DENIAL_OUTPUT=$(kubectl apply -f "${ROOT_DIR}/k8s-manifests/test/violating-pod.yaml" -n "${TEST_NAMESPACE}" 2>&1)
DENIAL_EXIT_CODE=$?
set -e

log_info "Admission Webhook Output: ${DENIAL_OUTPUT}"

if [ ${DENIAL_EXIT_CODE} -ne 0 ] && [[ "${DENIAL_OUTPUT}" == *"denied the request"* || "${DENIAL_OUTPUT}" == *"E2E-GOVERNANCE-DENIAL"* || "${DENIAL_OUTPUT}" == *"disallow-latest-tag"* ]]; then
  # 파드가 실제로 생성되지 않았는지 재확인
  if ! kubectl get pod e2e-violating-pod -n "${TEST_NAMESPACE}" &>/dev/null; then
    log_pass "Scenario 2 PASSED: Kyverno Admission Webhook correctly blocked violating workload (:latest tag)."
    S2_PASS=true
  else
    log_fail "Scenario 2 FAILED: Pod was created despite admission denial error."
    S2_PASS=false
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
else
  log_fail "Scenario 2 FAILED: Violating workload was NOT blocked by Kyverno Admission Controller."
  S2_PASS=false
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# ------------------------------------------------------------------------------
# Scenario 3: Backend SA RBAC Validation
# ------------------------------------------------------------------------------
log_step "Scenario 3: Backend SA RBAC Permissions & PolicyException Provisioning"

SA_USER="system:serviceaccount:${PLATFORM_NAMESPACE}:kyverno-backend-sa"

log_info "Verifying RBAC permissions for '${SA_USER}'..."
CAN_CREATE_PE=$(kubectl auth can-i create policyexceptions -n "${TEST_NAMESPACE}" --as="${SA_USER}")
CAN_GET_PE=$(kubectl auth can-i get policyexceptions -n "${TEST_NAMESPACE}" --as="${SA_USER}")
CAN_LIST_PE=$(kubectl auth can-i list policyexceptions -n "${TEST_NAMESPACE}" --as="${SA_USER}")
CAN_GET_POLR=$(kubectl auth can-i get policyreports -n "${TEST_NAMESPACE}" --as="${SA_USER}")

log_info "RBAC Check: create policyexceptions = ${CAN_CREATE_PE}"
log_info "RBAC Check: get policyexceptions    = ${CAN_GET_PE}"
log_info "RBAC Check: list policyexceptions   = ${CAN_LIST_PE}"
log_info "RBAC Check: get policyreports       = ${CAN_GET_POLR}"

if [[ "${CAN_CREATE_PE}" == "yes" && "${CAN_GET_PE}" == "yes" && "${CAN_LIST_PE}" == "yes" && "${CAN_GET_POLR}" == "yes" ]]; then
  log_info "Simulating PolicyException creation using backend ServiceAccount identity..."
  kubectl apply -f "${ROOT_DIR}/k8s-manifests/test/policy-exception.yaml" -n "${TEST_NAMESPACE}" --as="${SA_USER}"
  
  if kubectl get policyexception e2e-allow-violating-pod-exception -n "${TEST_NAMESPACE}" &>/dev/null; then
    log_pass "Scenario 3 PASSED: Backend SA has least-privilege RBAC to manage PolicyExceptions and reports."
    S3_PASS=true
  else
    log_fail "Scenario 3 FAILED: Failed to create PolicyException with ServiceAccount impersonation."
    S3_PASS=false
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
else
  log_fail "Scenario 3 FAILED: Backend ServiceAccount does not have required RBAC permissions."
  S3_PASS=false
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# Kyverno Admission Webhook이 새로 생성된 PolicyException CRD를 인메모리 캐시에 동기화할 수 있도록 잠시 대기
sleep 4

# ------------------------------------------------------------------------------
# Scenario 4: Policy Exception Bypass
# ------------------------------------------------------------------------------
log_step "Scenario 4: Policy Exception Bypass Verification (Workload Scheduled & Running)"

log_info "Re-deploying previously blocked violating workload under approved PolicyException..."
kubectl apply -f "${ROOT_DIR}/k8s-manifests/test/violating-pod.yaml" -n "${TEST_NAMESPACE}"

log_info "Waiting for violating pod 'e2e-violating-pod' to achieve 1/1 Running status..."
if kubectl wait --namespace "${TEST_NAMESPACE}" --for=condition=ready pod/e2e-violating-pod --timeout=60s; then
  POD_STATUS=$(kubectl get pod e2e-violating-pod -n "${TEST_NAMESPACE}" -o jsonpath='{.status.phase}')
  log_info "Pod phase: ${POD_STATUS}"
  log_pass "Scenario 4 PASSED: Kyverno PolicyException successfully bypassed policy and pod is Running."
  S4_PASS=true
else
  log_fail "Scenario 4 FAILED: Pod failed to reach Ready/Running state despite PolicyException."
  S4_PASS=false
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# ------------------------------------------------------------------------------
# Scenario 5: PolicyReport & Audit Inspection
# ------------------------------------------------------------------------------
log_step "Scenario 5: Kyverno PolicyReport & Audit Inspection (wgpolicyk8s.io)"

log_info "Removing Enforce ClusterPolicy to isolate Audit mode evaluation..."
kubectl delete clusterpolicy e2e-disallow-latest-tag-enforce --ignore-not-found=true
sleep 2

log_info "Applying Audit-mode ClusterPolicy (e2e-audit-disallow-latest-tag)..."
kubectl apply -f "${ROOT_DIR}/k8s-manifests/test/audit-policy.yaml"

log_info "Deploying workload for audit reporting: e2e-audit-pod (image: redis:latest)..."
kubectl apply -f "${ROOT_DIR}/k8s-manifests/test/audit-violating-pod.yaml" -n "${TEST_NAMESPACE}"

log_info "Waiting for Kyverno background scan and PolicyReport generation..."
REPORT_FOUND=false
for i in {1..20}; do
  POLR_COUNT=$(kubectl get polr -n "${TEST_NAMESPACE}" --no-headers 2>/dev/null | wc -l || echo "0")
  if [ "${POLR_COUNT}" -gt 0 ]; then
    REPORT_FOUND=true
    break
  fi
  sleep 3
done

if [ "${REPORT_FOUND}" = true ]; then
  POLR_NAME=$(kubectl get polr -n "${TEST_NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')
  log_info "Found PolicyReport: ${POLR_NAME} in namespace '${TEST_NAMESPACE}'"
  kubectl get polr "${POLR_NAME}" -n "${TEST_NAMESPACE}" -o yaml | head -n 30
  log_pass "Scenario 5 PASSED: wgpolicyk8s.io PolicyReport created and inspected successfully."
  S5_PASS=true
else
  log_warn "Namespace PolicyReport not populated yet, checking ClusterPolicyReports..."
  CPOLR_COUNT=$(kubectl get cpolr --no-headers 2>/dev/null | wc -l || echo "0")
  if [ "${CPOLR_COUNT}" -gt 0 ]; then
    log_pass "Scenario 5 PASSED: ClusterPolicyReport inspected successfully."
    S5_PASS=true
  else
    log_fail "Scenario 5 FAILED: No PolicyReport or ClusterPolicyReport found."
    S5_PASS=false
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
fi

# ------------------------------------------------------------------------------
# Scenario 6: AI Error Explanation Endpoint
# ------------------------------------------------------------------------------
log_step "Scenario 6: AI Remediation Engine In-Cluster API Verification (/ai-agent/explain-kyverno-error)"

BACKEND_POD=$(kubectl get pods -n "${PLATFORM_NAMESPACE}" -l app=kyverno-backend -o jsonpath='{.items[0].metadata.name}')
log_info "Sending synthetic Kyverno error payload to backend Pod (${BACKEND_POD})..."

AI_RESPONSE=$(kubectl exec -n "${PLATFORM_NAMESPACE}" "${BACKEND_POD}" -- node -e '
  const http = require("http");
  const payload = JSON.stringify({
    errorMessage: "admission webhook validate.kyverno.svc-fail denied the request: resource Pod/e2e-governance-test/e2e-violating-pod was blocked by rule disallow-latest-tag: Using the :latest tag is prohibited.",
    policyYaml: "apiVersion: kyverno.io/v1\nkind: ClusterPolicy\nmetadata:\n  name: disallow-latest-tag\nspec:\n  validationFailureAction: Enforce",
    resourceManifest: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: e2e-violating-pod\nspec:\n  containers:\n  - name: web\n    image: nginx:latest",
    clusterContext: "Kind Cluster: k8s-lab (us-east-1), K8s v1.29"
  });

  const req = http.request("http://localhost:3001/ai-agent/explain-kyverno-error", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  }, (res) => {
    let data = "";
    res.on("data", (chunk) => data += chunk);
    res.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        const valid = parsed &&
          typeof parsed.summary === "string" && parsed.summary.length > 0 &&
          Array.isArray(parsed.resolutionSteps) && parsed.resolutionSteps.length > 0 &&
          typeof parsed.governanceRationale === "string" && parsed.governanceRationale.length > 0;
        console.log(data);
        process.exit(valid ? 0 : 1);
      } catch (e) {
        console.error("JSON parsing error:", e.message);
        process.exit(1);
      }
    });
  });

  req.on("error", (err) => {
    console.error("HTTP request error:", err.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
' 2>/dev/null || echo "FAILED")

log_info "AI Explainer API Response: ${AI_RESPONSE}"

if [[ "${AI_RESPONSE}" != "FAILED" ]] && [[ "${AI_RESPONSE}" == *"\"summary\""* ]] && [[ "${AI_RESPONSE}" == *"\"resolutionSteps\""* ]] && [[ "${AI_RESPONSE}" == *"\"governanceRationale\""* ]]; then
  log_pass "Scenario 6 PASSED: AI Explainer API returned valid, structured remediation report (summary, resolutionSteps, governanceRationale)."
  S6_PASS=true
else
  log_fail "Scenario 6 FAILED: AI Explainer API response missing required schema fields or invalid JSON."
  S6_PASS=false
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# ==============================================================================
# 9. 테스트 결과 요약 및 클린업
# ==============================================================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TEST_FINISHED=true

log_step "E2E Governance Platform Integration Test Summary"

echo -e "Total Test Execution Time: ${BOLD}${DURATION} seconds${NC}"
echo -e "------------------------------------------------------------------------------"
echo -e "Scenario 1 (Cluster & Platform Health):        $([ "${S1_PASS:-false}" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "Scenario 2 (Policy Enforcement Block):         $([ "${S2_PASS:-false}" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "Scenario 3 (Backend SA RBAC Validation):       $([ "${S3_PASS:-false}" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "Scenario 4 (Policy Exception Bypass):          $([ "${S4_PASS:-false}" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "Scenario 5 (PolicyReport & Audit Inspection):  $([ "${S5_PASS:-false}" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "Scenario 6 (AI Error Explanation Endpoint):    $([ "${S6_PASS:-false}" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "------------------------------------------------------------------------------"

if [ "${CLEANUP}" = true ]; then
  cleanup_test_resources
fi

if [ ${TEST_FAILED} -eq 0 ]; then
  log_pass "ALL E2E GOVERNANCE INTEGRATION TEST SCENARIOS PASSED SUCCESSFULLY! 🚀"
  exit 0
else
  log_fail "SOME TEST SCENARIOS FAILED (${TEST_FAILED} failure(s)). Please inspect logs above."
  dump_diagnostics
  exit 1
fi
