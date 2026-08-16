#!/bin/bash
# AWS EKS Pod 내 애플리케이션이 장기 AWS IAM 자격증명(AccessKey/SecretKey) 없이 안전하게 AWS Bedrock(Claude 3.5 Sonnet)을 호출할 수 있도록 IRSA(IAM Roles for Service Accounts)를 자동 구성하는 스크립트
# 최소 권한(Least Privilege) 원칙에 따라 Bedrock 모델 호출 권한만 격리 부여하여 보안 컴플라이언스를 준수하고 자격증명 유출 위험을 원천 차단하기 위한 목적
set -e

CLUSTER_NAME="${1:-${CLUSTER_NAME:-kyverno-eks-lab}}"
REGION="${2:-${REGION:-us-east-1}}"
NAMESPACE="kyverno-platform"
SERVICE_ACCOUNT="kyverno-backend-sa"
POLICY_NAME="KyvernoBedrockClaudeInvocationPolicy"
# 멀티 클러스터 환경에서 IAM Role 이름 충돌을 방지하기 위해 클러스터명을 접두사로 결합
ROLE_NAME="${CLUSTER_NAME}-backend-bedrock-irsa-role"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "=========================================================="
echo " AWS EKS Bedrock IRSA Automated Setup"
echo ">>> Target Cluster Name : ${CLUSTER_NAME}"
echo ">>> Target AWS Region   : ${REGION}"
echo ">>> Target Namespace    : ${NAMESPACE}"
echo ">>> ServiceAccount Name : ${SERVICE_ACCOUNT}"
echo ">>> IAM Policy Name     : ${POLICY_NAME}"
echo ">>> IAM Role Name       : ${ROLE_NAME}"
echo "=========================================================="

# AWS IAM CLI 인증 및 기본 실행 환경 무결성 사전 검증
if ! command -v aws &> /dev/null; then
  echo "[ERROR] AWS CLI is not installed. Please install AWS CLI before continuing."
  exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
  echo "[ERROR] AWS CLI authentication failed. Please run 'aws configure' or export valid AWS credentials."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
CALLER_ARN=$(aws sts get-caller-identity --query "Arn" --output text)
echo ">>> Authenticated AWS Account : ${ACCOUNT_ID}"
echo ">>> Caller Identity ARN       : ${CALLER_ARN}"

# EKS 클러스터 관리 및 IRSA 바인딩 자동화를 위한 CLI 도구 준비
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

# 대상 EKS 클러스터 존재 여부 확인
if ! eksctl get cluster --name "${CLUSTER_NAME}" --region "${REGION}" 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  echo "[ERROR] EKS Cluster '${CLUSTER_NAME}' not found in region '${REGION}'."
  echo ">>> Please create the cluster first by running:"
  echo "    ./scripts/setup-eks-cluster.sh ${CLUSTER_NAME} ${REGION} hub"
  exit 1
fi

echo ">>> Updating kubeconfig context for cluster '${CLUSTER_NAME}' in '${REGION}'..."
eksctl utils write-kubeconfig --cluster="${CLUSTER_NAME}" --region="${REGION}"

echo ">>> 1. Ensuring IAM OIDC Provider is associated with EKS Cluster..."
# Pod WebIdentityToken 교환을 위해 EKS 클러스터에 IAM OIDC Identity Provider를 활성화
eksctl utils associate-iam-oidc-provider \
  --cluster="${CLUSTER_NAME}" \
  --region="${REGION}" \
  --approve

echo ">>> 2. Preparing Least-Privilege IAM Policy for AWS Bedrock Claude 3.5 Sonnet..."
# us-east-1(기본) 및 us-east-2(HA DR 리전)의 Claude 3.5 Sonnet 모델로 한정된 최소 권한 JSON 정책 정의
POLICY_DOCUMENT=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockClaudeSonnetInvocation",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0"
      ]
    }
  ]
}
EOF
)

POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

# 멱등성 보장을 위해 정책 기등록 여부 확인 후 생성 또는 최신 버전 갱신
if aws iam get-policy --policy-arn "${POLICY_ARN}" &> /dev/null; then
  echo ">>> IAM Policy '${POLICY_NAME}' already exists: ${POLICY_ARN}"
else
  echo ">>> Creating IAM Policy '${POLICY_NAME}'..."
  aws iam create-policy \
    --policy-name "${POLICY_NAME}" \
    --policy-document "${POLICY_DOCUMENT}" \
    --description "Least-privilege IAM policy for Bedrock Claude 3.5 Sonnet invocation in Kyverno Platform"
  echo ">>> Successfully created IAM Policy: ${POLICY_ARN}"
fi

echo ">>> 3. Ensuring namespace '${NAMESPACE}' exists in cluster..."
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo ">>> 4. Creating/Updating IAM Role for ServiceAccount (IRSA)..."
# eksctl을 통해 IAM Role 생성 및 Kubernetes ServiceAccount와 OIDC Trust Relationship 상호 바인딩
eksctl create iamserviceaccount \
  --cluster="${CLUSTER_NAME}" \
  --region="${REGION}" \
  --namespace="${NAMESPACE}" \
  --name="${SERVICE_ACCOUNT}" \
  --role-name="${ROLE_NAME}" \
  --attach-policy-arn="${POLICY_ARN}" \
  --override-existing-serviceaccounts \
  --approve

echo ">>> 5. Verifying ServiceAccount IRSA Configuration in Kubernetes..."
SA_ROLE_ARN=$(kubectl get sa "${SERVICE_ACCOUNT}" -n "${NAMESPACE}" -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}' 2>/dev/null || echo "")

if [ -n "${SA_ROLE_ARN}" ]; then
  echo ">>> [SUCCESS] ServiceAccount '${SERVICE_ACCOUNT}' is bound to IAM Role: ${SA_ROLE_ARN}"
else
  echo ">>> [WARNING] ServiceAccount was created, but role ARN annotation was not immediately resolved by jsonpath."
  kubectl describe sa "${SERVICE_ACCOUNT}" -n "${NAMESPACE}" || true
fi

# 기 배포된 백엔드 Pod가 존재할 경우 신규 STS WebIdentity 토큰을 자동 반영하기 위해 재시작 트리거
if kubectl get deployment kyverno-backend -n "${NAMESPACE}" &> /dev/null; then
  echo ">>> Restarting kyverno-backend deployment to inject fresh IRSA WebIdentity credentials..."
  kubectl rollout restart deployment/kyverno-backend -n "${NAMESPACE}"
  echo ">>> Waiting for kyverno-backend rollout to complete..."
  kubectl rollout status deployment/kyverno-backend -n "${NAMESPACE}" --timeout=120s || true
fi

echo "=========================================================="
echo " Bedrock IRSA Setup Completed Successfully!"
echo " Cluster        : ${CLUSTER_NAME} (${REGION})"
echo " ServiceAccount : ${NAMESPACE}/${SERVICE_ACCOUNT}"
echo " IAM Policy ARN : ${POLICY_ARN}"
echo " IAM Role ARN   : arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo "=========================================================="
