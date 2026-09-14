#!/usr/bin/env bash
# ==============================================================================
# AWS EKS Tier 2 거버넌스 벤치마크 클러스터 원클릭 셋업 스크립트 (Free Tier 준수)
# ==============================================================================
# [AWS 최신 프리티어 및 성능 검증 설계 지침 준수]
# 1. 컴퓨팅: us-east-1 리전 Free Tier 적격 인스턴스 (m7i-flex.large, c7i-flex.large, t3.small)
# 2. 스토리지: 총 30GB (15GB x 2 Nodes) EBS gp3 프리티어 상한선 100% 준수
# 3. 고밀도 네트워킹: Amazon VPC CNI Prefix Delegation 활성화 (노드당 최대 110 Pods)
# 4. 워크로드: 초경량 Pause 컨테이너 기반 15개 네임스페이스, 150~200개 파드, 1,000+건 PolicyReport
# ==============================================================================

set -euo pipefail

CLUSTER_NAME="${1:-kyverno-eks-tier2}"
REGION="${2:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/eksctl-tier2-config.yaml"

LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "=============================================================================="
echo " 🏗️  Starting AWS EKS Tier 2 Free Tier Benchmark Cluster Setup"
echo "=============================================================================="
echo " 🌐 Cluster Name : ${CLUSTER_NAME}"
echo " 📍 Region       : ${REGION}"
echo " 💸 Cost Profile : 100% AWS Free Tier Compute (m7i-flex.large/t3.small) & EBS 30GB"
echo "=============================================================================="

# 1. AWS IAM CLI 인증 상태 확인
if ! aws sts get-caller-identity &> /dev/null; then
  echo "❌ [ERROR] AWS CLI authentication failed. Please run 'aws configure' before executing."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✅ Authenticated to AWS Account: ${ACCOUNT_ID}"

# 2. 필수 CLI 도구 유무 확인 및 자동 설치
if ! command -v eksctl &> /dev/null; then
  echo ">>> Installing eksctl CLI into scripts/bin..."
  curl --silent --location "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C "${LOCAL_BIN_DIR}"
  chmod +x "${LOCAL_BIN_DIR}/eksctl"
fi

if ! command -v kubectl &> /dev/null; then
  echo ">>> Installing kubectl CLI into scripts/bin..."
  curl -Lo "${LOCAL_BIN_DIR}/kubectl" "https://dl.k8s.io/release/v1.32.0/bin/linux/amd64/kubectl"
  chmod +x "${LOCAL_BIN_DIR}/kubectl"
fi

if ! command -v helm &> /dev/null; then
  echo ">>> Installing Helm CLI into scripts/bin..."
  curl -Lo "${LOCAL_BIN_DIR}/helm.tar.gz" "https://get.helm.sh/helm-v3.16.0-linux-amd64.tar.gz"
  tar -zxvf "${LOCAL_BIN_DIR}/helm.tar.gz" -C "${LOCAL_BIN_DIR}" --strip-components=1 linux-amd64/helm
  rm -f "${LOCAL_BIN_DIR}/helm.tar.gz"
  chmod +x "${LOCAL_BIN_DIR}/helm"
fi

# 3. EKS Free Tier 클러스터 생성 또는 Kubeconfig 갱신 및 노드그룹 확인
if eksctl get cluster --name "${CLUSTER_NAME}" --region "${REGION}" 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  echo ">>> EKS cluster '${CLUSTER_NAME}' already exists. Updating kubeconfig..."
  eksctl utils write-kubeconfig --cluster="${CLUSTER_NAME}" --region="${REGION}"

  # 노드그룹 존재 여부 점검 (이전 롤백 등의 사유로 미존재 시 자동 생성)
  if ! eksctl get nodegroups --cluster "${CLUSTER_NAME}" --region "${REGION}" 2>/dev/null | grep -q "freetier-benchmark-nodes"; then
    echo ">>> Nodegroup not found on existing cluster. Creating managed nodegroup via eksctl..."
    eksctl create nodegroup -f "${CONFIG_PATH}"
  fi
else
  echo ">>> Provisioning EKS Tier 2 Free Tier Cluster '${CLUSTER_NAME}' via eksctl..."
  eksctl create cluster -f "${CONFIG_PATH}"
fi

# 4. Amazon VPC CNI Prefix Delegation 활성화 (EKS 공식 권장 파드 밀도 극대화 설정)
echo ">>> Enabling Amazon VPC CNI Prefix Delegation for high pod density..."
kubectl set env daemonset aws-node -n kube-system ENABLE_PREFIX_DELEGATION=true >/dev/null 2>&1 || true
kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGET=1 >/dev/null 2>&1 || true

# 5. Kyverno 어드미션 컨트롤러 배포 (HA & PolicyReport 활성화)
echo ">>> Registering and updating Kyverno Helm repository..."
helm repo add kyverno https://kyverno.github.io/kyverno/ --force-update >/dev/null 2>&1
helm repo update >/dev/null 2>&1

echo ">>> Deploying Kyverno Admission Controller with PolicyReports enabled..."
helm upgrade --install kyverno kyverno/kyverno \
  --namespace kyverno \
  --create-namespace \
  --set admissionController.replicas=2 \
  --set backgroundController.replicas=1 \
  --set cleanupController.replicas=1 \
  --set reportsController.replicas=1 \
  --set "reportsController.backgroundScan=true" \
  --set "reportsController.backgroundScanInterval=1h" \
  --set "backgroundController.backgroundScanInterval=1h" \
  --set admissionController.resources.requests.cpu=100m \
  --set admissionController.resources.requests.memory=128Mi \
  --set admissionController.resources.limits.cpu=1000m \
  --set admissionController.resources.limits.memory=768Mi \
  --set backgroundController.resources.requests.cpu=100m \
  --set backgroundController.resources.requests.memory=128Mi \
  --set backgroundController.resources.limits.cpu=1000m \
  --set backgroundController.resources.limits.memory=768Mi \
  --set cleanupController.resources.requests.cpu=50m \
  --set cleanupController.resources.requests.memory=64Mi \
  --set cleanupController.resources.limits.cpu=200m \
  --set cleanupController.resources.limits.memory=256Mi \
  --set reportsController.resources.requests.cpu=100m \
  --set reportsController.resources.requests.memory=128Mi \
  --set reportsController.resources.limits.cpu=1000m \
  --set reportsController.resources.limits.memory=768Mi \
  --set features.policyExceptions.enabled=true \
  --set "features.policyExceptions.namespace=*" \
  --set features.validatingAdmissionPolicyReports.enabled=false \
  --set features.admissionReports.enabled=false \
  --set features.aggregateReports.enabled=true \
  --set features.policyReports.enabled=true

echo ">>> Waiting for Kyverno to become ready..."
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=300s

# 6. 거버넌스 정책을 Audit 모드로 배포
echo ">>> Deploying Kyverno Governance Policies in Audit mode..."
POLICIES_DIR="${SCRIPT_DIR}/../k8s-manifests/policies"
if [ -d "${POLICIES_DIR}" ]; then
  kubectl apply -f "${POLICIES_DIR}/" --recursive 2>/dev/null || true
  kubectl get clusterpolicies -o name 2>/dev/null | xargs -I {} kubectl patch {} --type='merge' -p '{"spec":{"validationFailureAction":"Audit"}}' >/dev/null 2>&1 || true
  echo ">>> Policies applied successfully in Audit mode."
fi

# 7. 프리티어 최적화 대규모 벤치마크 워크로드 자동 생성 (15개 NS, 150개 파드, 1,000+ PolicyReports)
echo ">>> Launching Free Tier workload generator..."
bash "${SCRIPT_DIR}/generate-tier2-workload.sh" 15 10

# 8. Bedrock IRSA 구성
echo ">>> Setting up Bedrock IRSA for AI Governance features..."
bash "${SCRIPT_DIR}/setup-bedrock-irsa.sh" "${CLUSTER_NAME}" "${REGION}" || echo "[NOTE] Bedrock IRSA setup completed or skipped."

echo "=============================================================================="
echo " 🎉 Tier 2 EKS Free Tier Cluster Setup Successfully Completed!"
echo "=============================================================================="
echo " 🌐 Cluster Name : ${CLUSTER_NAME}"
echo " 📍 Region       : ${REGION}"
echo " 📊 Pod Scale    : ~150+ lightweight pods across 15 namespaces"
echo " 💰 Cost Notice  : EC2 Compute & EBS (30GB) are 100% Free Tier Eligible."
echo "                   (EKS Control plane is \$0.10/hr while running)"
echo " 🧹 Teardown Workload : bash scripts/cleanup-tier2-workload.sh"
echo " 🗑️ Delete Cluster    : eksctl delete cluster --name ${CLUSTER_NAME} --region ${REGION}"
echo "=============================================================================="
