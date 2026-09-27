#!/bin/bash
# AWS Load Balancer Controller 자동 설치 및 IRSA 구성 스크립트
# 도입 배경: EKS 인프라에서 Ingress 객체 정의만으로 AWS ALB를 자동 생성/삭제(On-Demand)하기 위함
# 기본 리전: us-east-1
set -e

CLUSTER_NAME="${1:-kyverno-eks-lab}"
REGION="${2:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "=========================================================="
echo " Setting up AWS Load Balancer Controller"
echo ">>> Target Cluster : ${CLUSTER_NAME}"
echo ">>> Target Region  : ${REGION}"
echo "=========================================================="

# 1. AWS CLI 및 kubectl 인증 상태 검증
if ! aws sts get-caller-identity &> /dev/null; then
  echo "[ERROR] AWS CLI 인증 실패. aws configure 상태를 확인하세요."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)

# 2. eksctl 및 helm 유무 확인
if ! command -v eksctl &> /dev/null; then
  echo "[ERROR] eksctl이 필요합니다. setup-eks-cluster.sh를 먼저 실행하세요."
  exit 1
fi

if ! command -v helm &> /dev/null; then
  echo "[ERROR] helm이 필요합니다. setup-eks-cluster.sh를 먼저 실행하세요."
  exit 1
fi

# 3. AWS IAM OIDC Provider 활성화 연동
echo ">>> EKS IAM OIDC Provider 상태 확인 및 생성..."
eksctl utils associate-iam-oidc-provider --cluster="${CLUSTER_NAME}" --region="${REGION}" --approve

# 4. AWS Load Balancer Controller IAM Policy 다운로드 및 생성
POLICY_NAME="AWSLoadBalancerControllerIAMPolicy-${CLUSTER_NAME}"
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

if ! aws iam get-policy --policy-arn "${POLICY_ARN}" &> /dev/null; then
  echo ">>> AWS Load Balancer Controller IAM Policy 생성 중..."
  POLICY_JSON_PATH="/tmp/iam_policy.json"
  curl -sSL -o "${POLICY_JSON_PATH}" https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json
  aws iam create-policy --policy-name "${POLICY_NAME}" --policy-document "file://${POLICY_JSON_PATH}"
  rm -f "${POLICY_JSON_PATH}"
else
  echo ">>> IAM Policy '${POLICY_NAME}' 이미 존재함."
fi

# 5. Service Account (IRSA) 생성
echo ">>> AWS Load Balancer Controller ServiceAccount (IRSA) 생성 중..."
eksctl create iamserviceaccount \
  --cluster="${CLUSTER_NAME}" \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --role-name="AmazonEKSLoadBalancerControllerRole-${CLUSTER_NAME}" \
  --attach-policy-arn="${POLICY_ARN}" \
  --override-existing-serviceaccounts \
  --region="${REGION}" \
  --approve

# 6. VPC ID 확인
VPC_ID=$(aws eks describe-cluster --name "${CLUSTER_NAME}" --region "${REGION}" --query "cluster.resourcesVpcConfig.vpcId" --output text)

# 7. EKS Subnet Tagging (ALB 자동 탐지를 위한 Public Subnet 전용 태그 부여)
echo ">>> Public Subnet 식별 및 kubernetes.io/role/elb=1 태그 부여..."
ROUTE_TABLES=$(aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=route.gateway-id,Values=igw-*" \
  --query "RouteTables[*].RouteTableId" --output text --region "${REGION}")

for RT in ${ROUTE_TABLES}; do
  PUB_SUBNETS=$(aws ec2 describe-route-tables \
    --route-table-ids "${RT}" \
    --query "RouteTables[0].Associations[?SubnetId!=null].SubnetId" \
    --output text --region "${REGION}")
  for SUBNET in ${PUB_SUBNETS}; do
    echo "    - Public Subnet 태깅: ${SUBNET}"
    aws ec2 create-tags --resources "${SUBNET}" --tags Key=kubernetes.io/role/elb,Value=1 --region "${REGION}" 2>/dev/null || true
  done
done

# 8. Helm 차트 추가 및 설치
echo ">>> Helm 차트를 통한 AWS Load Balancer Controller 설치..."
helm repo add eks https://aws.github.io/eks-charts
helm repo update eks

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName="${CLUSTER_NAME}" \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set region="${REGION}" \
  --set vpcId="${VPC_ID}"

echo ">>> AWS Load Balancer Controller 롤아웃 상태 대기 중..."
kubectl rollout status deployment/aws-load-balancer-controller -n kube-system --timeout=180s

echo "=========================================================="
echo " AWS Load Balancer Controller Setup Completed!"
echo "=========================================================="
