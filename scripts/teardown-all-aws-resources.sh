#!/usr/bin/env bash
# ==============================================================================
# AWS 모든 자원(Hub 및 Spoke EKS 클러스터) 완전 회수 스크립트
# [도입 배경] 작업 종료 시 불필요한 클라우드 요금 청구를 방지하고 리소스를 완전 정리
# [기대 효과] kyverno-eks-lab 및 kyverno-eks-spoke-01 클러스터와 연결된 모든 스택 삭제
# ==============================================================================
set -eo pipefail

REGION="${1:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

EKSCTL="${LOCAL_BIN_DIR}/eksctl"
if [ ! -f "${EKSCTL}" ]; then
  EKSCTL="eksctl"
fi

echo "=========================================================="
echo " 🧹 AWS All EKS Resources Teardown (${REGION})"
echo "=========================================================="

echo ">>> 1. Spoke 클러스터 ('kyverno-eks-spoke-01') 삭제 시작..."
"${EKSCTL}" delete cluster --name kyverno-eks-spoke-01 --region "${REGION}" --wait &
SPOKE_PID=$!

echo ">>> 2. Hub 클러스터 ('kyverno-eks-lab') 삭제 시작..."
"${EKSCTL}" delete cluster --name kyverno-eks-lab --region "${REGION}" --wait &
HUB_PID=$!

echo ">>> 두 클러스터의 CloudFormation 스택 및 리소스 삭제를 병렬로 대기합니다..."
wait $SPOKE_PID
echo ">>> ✅ Spoke 클러스터 ('kyverno-eks-spoke-01') 삭제 완료"

wait $HUB_PID
echo ">>> ✅ Hub 클러스터 ('kyverno-eks-lab') 삭제 완료"

echo ">>> 3. ECR 리포지토리 삭제 시작..."
ECR_REPOS=("kyverno-backend" "kyverno-frontend" "pac/dashboard-backend" "pac/dashboard-frontend")
for repo in "${ECR_REPOS[@]}"; do
  echo ">>> ECR 리포지토리 '${repo}' 삭제 시도..."
  aws ecr delete-repository --repository-name "${repo}" --region "${REGION}" --force 2>/dev/null || true
done
echo ">>> ✅ ECR 리포지토리 정리 완료"

echo "=========================================================="
echo " 🎉 모든 AWS EKS 및 ECR 리소스 회수가 성공적으로 완료되었습니다."
echo "=========================================================="

