#!/bin/bash
# 모노레포 전체 스택(NestJS 백엔드, Next.js 프론트엔드, PostgreSQL DB)을 빌드하고
# 로컬 Kind 클러스터(k8s-lab)에 로드 및 롤아웃하여 개발/테스트 환경을 최신 상태로 재배포하기 위한 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}"
KUBECTL="${ROOT_DIR}/scripts/bin/kubectl"
KIND="${ROOT_DIR}/scripts/bin/kind"

[ ! -f "${KUBECTL}" ] && KUBECTL="kubectl"
[ ! -f "${KIND}" ] && KIND="kind"

BUILD_ARGS=""
if [[ "$*" == *"--no-cache"* ]]; then
  BUILD_ARGS="--no-cache"
  echo ">>> [--no-cache] Docker build cache invalidation enabled."
fi

echo "=========================================================="
echo " 🚀 Kyverno Dashboard Full-Stack Redeployment Script"
echo "=========================================================="

# 1. NestJS 백엔드 Docker 이미지 빌드 및 Kind 클러스터 로드
echo ">>> [1/5] Building NestJS backend Docker image..."
docker build ${BUILD_ARGS} -t kyverno-backend:latest -f "${ROOT_DIR}/apps/backend/Dockerfile" "${ROOT_DIR}"

echo ">>> Loading backend image into Kind cluster 'k8s-lab'..."
"${KIND}" load docker-image kyverno-backend:latest --name k8s-lab

# 2. Next.js 프론트엔드 Docker 이미지 빌드 및 Kind 클러스터 로드
echo ">>> [2/5] Building Next.js frontend Docker image..."
docker build ${BUILD_ARGS} -t kyverno-frontend:latest -f "${ROOT_DIR}/apps/frontend/Dockerfile" "${ROOT_DIR}"

echo ">>> Loading frontend image into Kind cluster 'k8s-lab'..."
"${KIND}" load docker-image kyverno-frontend:latest --name k8s-lab

# 3. system 매니페스트 배포 및 DB 준비 대기
MANIFESTS_DIR="${ROOT_DIR}/k8s-manifests"
if [ -d "${MANIFESTS_DIR}" ]; then
  echo ">>> [3/5] Applying foundational system manifests (Namespace, RBAC, Postgres, Backend, Frontend)..."
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/system/namespace.yaml" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/system/rbac.yaml" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/system/postgres.yaml" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/system/backend.yaml" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/system/frontend.yaml" || true
  
  echo ">>> Waiting for PostgreSQL to be ready..."
  "${KUBECTL}" rollout status deployment/postgres -n kyverno-platform --timeout=120s || true
fi

# PostgreSQL 데이터베이스 스키마 동기화 및 테스트 계정 시딩
echo ">>> Synchronizing PostgreSQL DB schema & fixed test accounts..."
"${KUBECTL}" port-forward svc/postgres 5432:5432 -n kyverno-platform > /dev/null 2>&1 &
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

# 4. Kubernetes Deployment 롤아웃 재시작 및 테스트베드 매니페스트/정책 보장
echo ">>> [4/5] Applying testbed manifests and restarting deployments..."
if [ -d "${MANIFESTS_DIR}" ]; then
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/testbed/00-namespace.yaml" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/policies/" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/policies/mlops/" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/testbed/real-world-scenarios.yaml" || true
  "${KUBECTL}" apply -f "${MANIFESTS_DIR}/exceptions/default-cluster/governance-testbed/" || true
fi

"${KUBECTL}" patch deployment kyverno-backend -n kyverno-platform -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","imagePullPolicy":"IfNotPresent"}]}}}}'
"${KUBECTL}" patch deployment kyverno-frontend -n kyverno-platform -p '{"spec":{"template":{"spec":{"containers":[{"name":"frontend","imagePullPolicy":"IfNotPresent"}]}}}}'

"${KUBECTL}" rollout restart deployment/kyverno-backend -n kyverno-platform
"${KUBECTL}" rollout restart deployment/kyverno-frontend -n kyverno-platform

"${KUBECTL}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=120s
"${KUBECTL}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=120s

# 5. 기존 포트 포워딩 정리 및 포트 포워딩 백그라운드 재생성 (UI: 3000, API: 3001)
echo ">>> [5/5] Refreshing background port-forwards (UI: 3000, API: 3001)..."
pkill -f "kubectl port-forward" || true
sleep 1

nohup "${KUBECTL}" port-forward --address 0.0.0.0 svc/kyverno-backend 3001:3001 -n kyverno-platform > /dev/null 2>&1 &
nohup "${KUBECTL}" port-forward --address 0.0.0.0 svc/kyverno-frontend 3000:3000 -n kyverno-platform > /dev/null 2>&1 &
disown -a 2>/dev/null || true
sleep 2

echo "=========================================================="
echo " ✅ Full-Stack Redeployment Complete!"
echo "=========================================================="
echo " - Frontend Dashboard : http://localhost:3000"
echo " - Backend API / Swagger: http://localhost:3001/api"
echo " - Admin Account     : admin@test.com / test1234!"
echo " - User Account      : user@test.com / test1234!"
echo "=========================================================="

