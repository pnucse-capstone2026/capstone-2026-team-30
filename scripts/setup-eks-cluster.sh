#!/bin/bash
# AWS EKS 기반 멀티 클러스터(Hub/Spoke) 및 Kyverno 어드미션 컨트롤러 자동 셋업 스크립트
# 기본 리전: us-east-1 (북버지니아), 보조/HA 리전: us-east-2 (오하이오)
# 사용법: ./setup-eks-cluster.sh [CLUSTER_NAME] [REGION] [CLUSTER_ROLE]
#   예시 1 (기본 Hub 클러스터): ./setup-eks-cluster.sh kyverno-eks-hub us-east-1 hub
#   예시 2 (원격 Spoke 클러스터): ./setup-eks-cluster.sh kyverno-eks-spoke-01 us-east-1 spoke
#   예시 3 (DR/HA Spoke 클러스터): ./setup-eks-cluster.sh kyverno-eks-spoke-dr us-east-2 spoke
set -e

CLUSTER_NAME="${1:-kyverno-eks-lab}"
REGION="${2:-us-east-1}"
CLUSTER_ROLE="${3:-hub}" # hub 또는 spoke
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/eksctl-config.yaml"

LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "=========================================================="
echo " Starting AWS EKS Cluster Setup"
echo ">>> Target Cluster Name : ${CLUSTER_NAME}"
echo ">>> Target Region       : ${REGION}"
echo ">>> Cluster Role        : ${CLUSTER_ROLE}"
echo "=========================================================="

# AWS IAM CLI 인증 상태 사전 확인
if ! aws sts get-caller-identity &> /dev/null; then
  echo "[ERROR] AWS CLI authentication failed. Please run 'aws configure' before executing this script."
  exit 1
fi

# eksctl CLI 유무 확인 및 자동 수급
if ! command -v eksctl &> /dev/null; then
  echo ">>> Installing eksctl CLI into scripts/bin..."
  curl --silent --location "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C "${LOCAL_BIN_DIR}"
  chmod +x "${LOCAL_BIN_DIR}/eksctl"
fi

if ! command -v kubectl &> /dev/null; then
  echo ">>> Installing kubectl CLI into scripts/bin..."
  KUBECTL_VERSION="v1.35.0"
  curl -Lo "${LOCAL_BIN_DIR}/kubectl" "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
  chmod +x "${LOCAL_BIN_DIR}/kubectl"
fi

if ! command -v helm &> /dev/null; then
  echo ">>> Installing Helm CLI into scripts/bin..."
  HELM_VERSION="v3.16.0"
  curl -Lo "${LOCAL_BIN_DIR}/helm.tar.gz" "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz"
  tar -zxvf "${LOCAL_BIN_DIR}/helm.tar.gz" -C "${LOCAL_BIN_DIR}" --strip-components=1 linux-amd64/helm
  rm "${LOCAL_BIN_DIR}/helm.tar.gz"
  chmod +x "${LOCAL_BIN_DIR}/helm"
fi

# EKS 클러스터 존재 여부 확인 후 조치
if eksctl get cluster --name "${CLUSTER_NAME}" --region "${REGION}" 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  echo ">>> EKS cluster '${CLUSTER_NAME}' already exists in ${REGION}. Updating kubeconfig..."
  eksctl utils write-kubeconfig --cluster="${CLUSTER_NAME}" --region="${REGION}"
else
  echo ">>> Provisioning EKS multi-node cluster '${CLUSTER_NAME}' in ${REGION} (Role: ${CLUSTER_ROLE})..."
  if [ "${CLUSTER_NAME}" = "kyverno-eks-lab" ] && [ "${REGION}" = "us-east-1" ] && [ -f "${CONFIG_PATH}" ]; then
    eksctl create cluster -f "${CONFIG_PATH}"
  else
    # 동적 매개변수 기반 클러스터 생성 (Spot 최적화 인스턴스 풀 지정)
    eksctl create cluster \
      --name "${CLUSTER_NAME}" \
      --region "${REGION}" \
      --version "1.32" \
      --with-oidc \
      --nodegroup-name "freetier-spot-nodes" \
      --instance-types "c7i-flex.large,m7i-flex.large" \
      --spot \
      --nodes 2 \
      --nodes-min 2 \
      --nodes-max 3 \
      --node-volume-size 20 \
      --node-volume-type gp3
  fi
fi

echo ">>> Registering Kyverno Helm repository..."
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update

echo ">>> Deploying Kyverno to namespace 'kyverno' with multi-node HA configuration..."
# [도입 배경] 멀티노드 HA(Admission 2개) 유지 및 전체 네임스페이스 PolicyException CRD 자동 연동 보장
# [기대 효과] admissionReports 비활성화 및 1시간 주기 스캔으로 EKS etcd I/O 부하를 차단하고 전역 정책 예외 우회 지원
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

echo ">>> Waiting for Kyverno Admission Controller to be Ready..."
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=300s

POLICIES_PATH="${SCRIPT_DIR}/../k8s-manifests/policies/disallow-latest-tag.yaml"
if [ -f "${POLICIES_PATH}" ]; then
  echo ">>> Applying initial baseline policies..."
  kubectl apply -f "${POLICIES_PATH}"
  echo ">>> Baseline policies successfully applied."
fi

echo ">>> Setting gp2 as default StorageClass..."
kubectl patch storageclass gp2 -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}' 2>/dev/null || true

if ! aws eks describe-addon --cluster-name "${CLUSTER_NAME}" --addon-name aws-ebs-csi-driver --region "${REGION}" &>/dev/null; then
  echo ">>> Installing AWS EBS CSI driver addon..."
  eksctl create iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster "${CLUSTER_NAME}" \
    --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
    --approve \
    --region "${REGION}" 2>/dev/null || true

  SA_ROLE_ARN=$(kubectl get sa ebs-csi-controller-sa -n kube-system -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}' 2>/dev/null || true)
  if [ -n "${SA_ROLE_ARN}" ]; then
    eksctl create addon \
      --name aws-ebs-csi-driver \
      --cluster "${CLUSTER_NAME}" \
      --service-account-role-arn "${SA_ROLE_ARN}" \
      --force \
      --region "${REGION}" 2>/dev/null || true
  fi
fi

echo ">>> Installing MLOps Kubeflow Notebooks CRDs and Controller..."
kubectl apply -f https://raw.githubusercontent.com/kubeflow/kubeflow/v1.8.0/components/notebook-controller/config/crd/bases/kubeflow.org_notebooks.yaml 2>/dev/null || echo "[WARNING] Kubeflow CRD installation skipped."
kubectl apply -f "${SCRIPT_DIR}/../k8s-manifests/system/notebook-controller.yaml"

# Hub 클러스터인 경우 AI Agent(Bedrock Claude) 연동을 위한 IRSA 자동 구성 실행
if [ "${CLUSTER_ROLE}" = "hub" ]; then
  echo ">>> Setting up AWS Bedrock IRSA for Hub Cluster..."
  bash "${SCRIPT_DIR}/setup-bedrock-irsa.sh" "${CLUSTER_NAME}" "${REGION}" || echo "[WARNING] IRSA setup skipped or failed. Run ./scripts/setup-bedrock-irsa.sh manually if needed."
fi

echo ">>> Setting up AWS Load Balancer Controller for Ingress..."
bash "${SCRIPT_DIR}/setup-alb-controller.sh" "${CLUSTER_NAME}" "${REGION}" || echo "[WARNING] ALB Controller setup skipped or failed. Run ./scripts/setup-alb-controller.sh manually if needed."

echo "=========================================================="
echo " EKS Setup for '${CLUSTER_NAME}' (${REGION}) Completed!"
echo " Role: ${CLUSTER_ROLE}"
echo "=========================================================="
