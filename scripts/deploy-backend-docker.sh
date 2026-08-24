#!/bin/bash
# NestJS 백엔드(AI 에이전트 및 거버넌스 API)를 Docker로 빌드하고 AWS ECR 및 EKS 클러스터(또는 Kind 로컬)에 자동 배포하는 스크립트
# 주 리전(us-east-1) 및 보조 리전(us-east-2) 멀티 리전 배포와 로컬 클러스터 연동을 유연하게 지원하여 무중단 서비스를 보장 목적
set -e

# 기본 AWS 리전을 us-east-1로 지정하며 환경 변수 및 스크립트 인자로 us-east-2 등 타 리전 전환 지원
REGION="${1:-${AWS_REGION:-us-east-1}}"
REPO_NAME="kyverno-backend"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

echo "=========================================================="
echo " Docker-based Backend Build & Deploy to EKS/Kind (${REGION})"
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

# 모노레포 루트 컨텍스트에서 백엔드 프로덕션 이미지 빌드 (Slim glibc 베이스 + Prisma Client 포함)
echo ">>> Building NestJS backend Docker image from apps/backend/Dockerfile..."
docker build -t "${REPO_NAME}:latest" -f "${ROOT_DIR}/apps/backend/Dockerfile" "${ROOT_DIR}"

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

# 네임스페이스 및 선행 시스템 리소스(RBAC, PostgreSQL) 존재 보장
echo ">>> Ensuring 'kyverno-platform' namespace and foundational resources exist..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/namespace.yaml"
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/rbac.yaml"
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/postgres.yaml"

# PostgreSQL 롤아웃 상태 대기
"${KUBECTL}" rollout status deployment/postgres -n kyverno-platform --timeout=120s || true

# PostgreSQL 데이터베이스 스키마 및 시드 데이터 자동 동기화
echo ">>> Synchronizing PostgreSQL schema and seeding initial admin/RBAC..."
"${KUBECTL}" port-forward svc/postgres 5432:5432 -n kyverno-platform > /dev/null 2>&1 &
PF_PG_PID=$!
sleep 3
DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" pnpm --filter @kyverno-platform/backend exec prisma db push --accept-data-loss || true
DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" SEED_ADMIN_EMAIL="admin@example.com" SEED_ADMIN_PASSWORD="change-this-admin-password" pnpm --filter @kyverno-platform/backend exec prisma db seed || true
kill $PF_PG_PID 2>/dev/null || true

# Deployment 이미지 갱신 및 Zero-Downtime RollingUpdate 배포 수행
echo ">>> Updating deployment 'kyverno-backend' with target image '${IMAGE_TARGET}'..."
"${KUBECTL}" apply -f "${ROOT_DIR}/k8s-manifests/system/backend.yaml"
"${KUBECTL}" set image deployment/kyverno-backend backend="${IMAGE_TARGET}" -n kyverno-platform
"${KUBECTL}" patch deployment kyverno-backend -n kyverno-platform -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","imagePullPolicy":"Always"}]}}}}'
"${KUBECTL}" rollout restart deployment/kyverno-backend -n kyverno-platform
"${KUBECTL}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s

echo "=========================================================="
echo " Backend successfully deployed & rolled out to cluster!"
echo "=========================================================="
echo ">>> To test Swagger API, run: ./scripts/bin/kubectl port-forward svc/kyverno-backend 3001:3001 -n kyverno-platform"
echo ">>> Open Swagger UI at: http://localhost:3001/api"

