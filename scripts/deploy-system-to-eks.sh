#!/bin/bash
# Kyverno Governance Platform 전체 시스템(PostgreSQL DB, 백엔드, 프론트엔드)을 EKS 클러스터에 원클릭 자동 배포하는 스크립트
# 기본 리전 us-east-1 및 보조 리전 us-east-2 풀스택 환경 구축 및 어드미션 제어기 연동 목적
set -e

REGION="${1:-${AWS_REGION:-us-east-1}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

MANIFESTS_DIR="${SCRIPT_DIR}/../k8s-manifests/system"

echo "======================================================="
echo " Deploying Kyverno Platform System to AWS EKS (${REGION})"
echo "======================================================="

echo ">>> 1. Creating 'kyverno-platform' namespace..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/namespace.yaml"

echo ">>> 2. Applying RBAC Permissions for Backend ServiceAccount..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/rbac.yaml"

# 호스트의 .env 환경변수를 EKS Secret으로 동기화하여 GitHub Token 및 설정 주입
ENV_FILE="${SCRIPT_DIR}/../apps/backend/.env"
if [ -f "${ENV_FILE}" ]; then
  echo ">>> 2.5. Synchronizing backend environment variables to 'backend-env-secret'..."
  "${KUBECTL}" create secret generic backend-env-secret \
    --from-env-file="${ENV_FILE}" \
    -n kyverno-platform \
    --dry-run=client -o yaml | "${KUBECTL}" apply -f -
fi

echo ">>> 2.8. Synchronizing PostgreSQL schema initialization script..."
if [ -f "${MANIFESTS_DIR}/postgres-init.sql" ]; then
  "${KUBECTL}" create configmap postgres-init-sql \
    --from-file=init.sql="${MANIFESTS_DIR}/postgres-init.sql" \
    -n kyverno-platform \
    --dry-run=client -o yaml | "${KUBECTL}" apply -f -
fi

echo ">>> 3. Deploying PostgreSQL Database..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/postgres.yaml"

echo ">>> 4. Waiting for PostgreSQL rollout to complete..."
"${KUBECTL}" rollout status deployment/postgres -n kyverno-platform --timeout=180s

echo ">>> 5. Deploying Backend (NestJS + AI Agent) and Frontend (Next.js)..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/backend.yaml"
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/frontend.yaml"

echo ">>> 6. Waiting for Backend & Frontend deployments to be Ready (RollingUpdate Verification)..."
"${KUBECTL}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s
"${KUBECTL}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s

echo "======================================================="
echo " System Deployment Successful on EKS (${REGION})!"
echo "======================================================="
"${KUBECTL}" get pods,svc -n kyverno-platform

