#!/bin/bash
# Next.js shadcn 프론트엔드를 Docker로 빌드하고 AWS ECR 및 EKS 클러스터에 원클릭 자동 배포하는 스크립트
# 실제 프로덕션 대시보드 UI를 EKS 클러스터 내부에 초고속으로 탑재하기 위한 목적
set -e

REGION="us-east-1"
REPO_NAME="kyverno-frontend"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

echo "=========================================================="
echo " Docker-based Frontend Build & Deploy to AWS EKS (us-east-1)"
echo "=========================================================="

# 1. AWS 자격 증명 확인 및 Account ID 조회
if ! aws sts get-caller-identity &> /dev/null; then
  echo "[ERROR] AWS CLI authentication failed. Please run 'aws configure' first."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest"

echo ">>> Target AWS Account: ${ACCOUNT_ID}"
echo ">>> Target ECR Image URI: ${ECR_URI}"

# 2. ECR Repository 존재 여부 확인 및 자동 생성
if ! aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" &> /dev/null; then
  echo ">>> Creating ECR repository '${REPO_NAME}' in ${REGION}..."
  aws ecr create-repository --repository-name "${REPO_NAME}" --region "${REGION}"
fi

# 3. ECR Docker 로그인
echo ">>> Logging in to Amazon ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# 4. Next.js shadcn 프론트엔드 Docker 이미지 빌드
echo ">>> Building Next.js shadcn frontend Docker image from apps/frontend/Dockerfile..."
docker build -t "${REPO_NAME}:latest" -f "${ROOT_DIR}/apps/frontend/Dockerfile" "${ROOT_DIR}"

# 5. 태깅 및 ECR 푸시
echo ">>> Tagging and Pushing image to Amazon ECR..."
docker tag "${REPO_NAME}:latest" "${ECR_URI}"
docker push "${ECR_URI}"

# 네임스페이스 존재 보장
echo ">>> Ensuring 'kyverno-platform' namespace exists..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/namespace.yaml"

# 6. EKS 클러스터 내 프론트엔드 Deployment 업데이트 및 롤아웃
echo ">>> Updating EKS deployment 'kyverno-frontend' with new ECR image..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/frontend.yaml"
"${KUBECTL}" set image deployment/kyverno-frontend frontend="${ECR_URI}" -n kyverno-platform
"${KUBECTL}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s

echo "=========================================================="
echo " Frontend successfully deployed to AWS EKS!"
echo "=========================================================="
echo ">>> To access UI, run: ./scripts/bin/kubectl port-forward svc/kyverno-frontend 3000:3000 -n kyverno-platform"
echo ">>> Open browser at: http://localhost:3000"
