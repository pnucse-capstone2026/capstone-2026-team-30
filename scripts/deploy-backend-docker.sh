#!/bin/bash
# NestJS 백엔드(AI 에이전트 및 거버넌스 API)를 Docker로 빌드하고 AWS ECR 및 EKS 클러스터에 원클릭 자동 롤아웃하는 스크립트
# 변경된 백엔드 이미지를 빌드하여 EKS 클러스터에 무중단 롤링 업데이트로 신속하게 반영하기 위한 목적
set -e

REGION="us-east-1"
REPO_NAME="kyverno-backend"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

echo "=========================================================="
echo " Docker-based Backend Build & Deploy to AWS EKS (us-east-1)"
echo "=========================================================="

# AWS CLI 자격 증명 상태 사전 확인
if ! aws sts get-caller-identity &> /dev/null; then
  echo "[ERROR] AWS CLI authentication failed. Please run 'aws configure' first."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest"

echo ">>> Target AWS Account: ${ACCOUNT_ID}"
echo ">>> Target ECR Image URI: ${ECR_URI}"

# ECR 레포지토리가 없을 경우 신규 생성
if ! aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" &> /dev/null; then
  echo ">>> Creating ECR repository '${REPO_NAME}' in ${REGION}..."
  aws ecr create-repository --repository-name "${REPO_NAME}" --region "${REGION}"
fi

# 도커 클라이언트 ECR 인증 획득
echo ">>> Logging in to Amazon ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# 모노레포 루트 컨텍스트에서 백엔드 프로덕션 이미지 빌드 (Slim glibc 베이스 + Prisma Client 포함)
echo ">>> Building NestJS backend Docker image from apps/backend/Dockerfile..."
docker build -t "${REPO_NAME}:latest" -f "${ROOT_DIR}/apps/backend/Dockerfile" "${ROOT_DIR}"

# ECR 원격 레지스트리로 푸시
echo ">>> Tagging and Pushing image to Amazon ECR..."
docker tag "${REPO_NAME}:latest" "${ECR_URI}"
docker push "${ECR_URI}"

# EKS 클러스터 Deployment 이미지 갱신 및 무중단 롤아웃 수행
echo ">>> Updating EKS deployment 'kyverno-backend' with new ECR image..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/backend.yaml"
"${KUBECTL}" set image deployment/kyverno-backend backend="${ECR_URI}" -n kyverno-platform
"${KUBECTL}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s

echo "=========================================================="
echo " Backend successfully deployed & rolled out to AWS EKS!"
echo "=========================================================="
echo ">>> To test Swagger API, run: ./scripts/bin/kubectl port-forward svc/kyverno-backend 3001:3001 -n kyverno-platform"
echo ">>> Open Swagger UI at: http://localhost:3001/api"
