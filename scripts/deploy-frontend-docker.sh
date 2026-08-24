#!/bin/bash
# Next.js 프론트엔드 대시보드를 Docker로 빌드하고 AWS ECR 및 EKS 클러스터(또는 Kind 로컬)에 자동 배포하는 스크립트
# 주 리전(us-east-1) 및 보조 리전(us-east-2) 멀티 리전 배포와 로컬 클러스터 연동을 유연하게 지원하여 무중단 UI 서비스를 제공 목적
set -e

# 기본 AWS 리전을 us-east-1로 지정하며 환경 변수 및 스크립트 인자로 us-east-2 등 타 리전 전환 지원
REGION="${1:-${AWS_REGION:-us-east-1}}"
REPO_NAME="kyverno-frontend"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

echo "=========================================================="
echo " Docker-based Frontend Build & Deploy to EKS/Kind (${REGION})"
echo "=========================================================="

# EKS 원격 배포 및 ECR 푸시 전용 레지스트리 URI 결정
if aws sts get-caller-identity &> /dev/null; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
  ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest"
  echo ">>> Authenticated AWS Account: ${ACCOUNT_ID}"
  echo ">>> Target ECR Image URI: ${ECR_URI}"
  IS_EKS=true
else
  echo ">>> AWS CLI authentication not found. Falling back to local Kind deployment mode."
  IS_EKS=false
fi

# Next.js standalone 프로덕션 Docker 이미지 빌드
echo ">>> Building Next.js frontend Docker image from apps/frontend/Dockerfile..."
docker build -t "${REPO_NAME}:latest" -f "${ROOT_DIR}/apps/frontend/Dockerfile" "${ROOT_DIR}"

if [ "${IS_EKS}" = true ]; then
  # ECR 레포지토리가 없을 경우 신규 생성 (동적 리전 호환)
  if ! aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" &> /dev/null; then
    echo ">>> Creating ECR repository '${REPO_NAME}' in ${REGION}..."
    aws ecr create-repository --repository-name "${REPO_NAME}" --region "${REGION}"
  fi

  # 도커 클라이언트 ECR 인증 획득 및 이미지 푸시
  echo ">>> Logging in to Amazon ECR (${REGION})..."
  aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

  # 고유 이미지 태그 발급으로 EKS 노드의 로컬 이미지 캐시 바이패스 보장
  TAG="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
  ECR_URI_TAGGED="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:${TAG}"

  echo ">>> Tagging and Pushing image to Amazon ECR (${TAG} & latest)..."
  docker tag "${REPO_NAME}:latest" "${ECR_URI}"
  docker tag "${REPO_NAME}:latest" "${ECR_URI_TAGGED}"
  docker push "${ECR_URI}"
  docker push "${ECR_URI_TAGGED}"
  IMAGE_TARGET="${ECR_URI_TAGGED}"
else
  # 로컬 Kind 클러스터 존재 시 도커 이미지를 Kind 노드 내부로 자동 로드
  if command -v kind &> /dev/null && kind get clusters 2>/dev/null | grep -q "k8s-lab"; then
    echo ">>> Loading Docker image '${REPO_NAME}:latest' into local Kind cluster 'k8s-lab'..."
    kind load docker-image "${REPO_NAME}:latest" --name "k8s-lab"
  fi
  IMAGE_TARGET="${REPO_NAME}:latest"
fi

# 네임스페이스 존재 보장
echo ">>> Ensuring 'kyverno-platform' namespace exists..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/namespace.yaml"

# Deployment 이미지 갱신 및 Zero-Downtime RollingUpdate 배포 수행
echo ">>> Updating deployment 'kyverno-frontend' with target image '${IMAGE_TARGET}'..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/frontend.yaml"
"${KUBECTL}" set image deployment/kyverno-frontend frontend="${IMAGE_TARGET}" -n kyverno-platform
"${KUBECTL}" patch deployment kyverno-frontend -n kyverno-platform -p '{"spec":{"template":{"spec":{"containers":[{"name":"frontend","imagePullPolicy":"Always"}]}}}}'
"${KUBECTL}" rollout restart deployment/kyverno-frontend -n kyverno-platform
"${KUBECTL}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s

echo "=========================================================="
echo " Frontend successfully deployed to cluster!"
echo "=========================================================="
echo ">>> To access UI, run: ./scripts/bin/kubectl port-forward svc/kyverno-frontend 3000:3000 -n kyverno-platform"
echo ">>> Open browser at: http://localhost:3000"

