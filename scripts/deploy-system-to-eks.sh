#!/bin/bash
# Kyverno Governance Platform 전체 시스템(PostgreSQL DB, 백엔드, 프론트엔드)을 EKS 클러스터에 원클릭 자동 배포하는 스크립트
# 클러스터 내 풀스택 환경 구축 및 EKS 어드미션 연동 목적
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

MANIFESTS_DIR="${SCRIPT_DIR}/../k8s-manifests/system"

echo "======================================================="
echo " Deploying Kyverno Platform System to AWS EKS Cluster"
echo "======================================================="

echo ">>> 1. Creating 'kyverno-platform' namespace..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/namespace.yaml"

echo ">>> 2. Applying RBAC Permissions for Backend ServiceAccount..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/rbac.yaml"

echo ">>> 3. Deploying PostgreSQL Database..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/postgres.yaml"

echo ">>> 4. Waiting for PostgreSQL rollout to complete..."
"${KUBECTL}" rollout status deployment/postgres -n kyverno-platform --timeout=180s

echo ">>> 5. Deploying Backend (NestJS + AI Agent) and Frontend (Next.js)..."
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/backend.yaml"
"${KUBECTL}" apply -f "${MANIFESTS_DIR}/frontend.yaml"

echo ">>> 6. Waiting for Backend & Frontend deployments to be Ready..."
"${KUBECTL}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s
"${KUBECTL}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s

echo "======================================================="
echo " System Deployment Successful!"
echo "======================================================="
"${KUBECTL}" get pods,svc -n kyverno-platform
