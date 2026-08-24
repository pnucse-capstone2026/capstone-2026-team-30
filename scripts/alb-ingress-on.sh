#!/bin/bash
# AWS ALB Ingress On-Demand 켜기 스크립트
# 도입 배경: 개발/테스트 시에만 포트포워딩 없이 외부 접속 가능한 ALB를 동적 생성하여 비용 최소화
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INGRESS_MANIFEST="${SCRIPT_DIR}/../k8s-manifests/system/ingress.yaml"

echo "=========================================================="
echo " 🚀 Provisioning AWS ALB Ingress (On-Demand Mode)"
echo "=========================================================="

if [ ! -f "${INGRESS_MANIFEST}" ]; then
  echo "[ERROR] Ingress 매니페스트 파일이 존재하지 않습니다: ${INGRESS_MANIFEST}"
  exit 1
fi

# 1. Ingress 매니페스트 적용
echo ">>> Applying Kubernetes Ingress manifest..."
kubectl apply -f "${INGRESS_MANIFEST}"

# 2. ALB 주소 생성 폴링 대기 (최대 180초)
echo ">>> Waiting for AWS ALB Endpoint provisioning..."
ALB_DNS=""
MAX_ATTEMPTS=36
ATTEMPT=0

while [ ${ATTEMPT} -lt ${MAX_ATTEMPTS} ]; do
  ALB_DNS=$(kubectl get ingress kyverno-ingress -n kyverno-platform -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  if [ -n "${ALB_DNS}" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  echo -n "."
  sleep 5
done
echo ""

if [ -n "${ALB_DNS}" ]; then
  echo "=========================================================="
  echo " 🎉 AWS ALB Provisioned Successfully!"
  echo ">>> ALB Public Endpoint : http://${ALB_DNS}"
  echo ">>> Frontend Dashboard   : http://${ALB_DNS}/"
  echo ">>> Backend API Endpoint : http://${ALB_DNS}/api"
  echo "----------------------------------------------------------"
  echo "💡 포트포워딩(3000, 3001) 없이 위 URL로 바로 접근할 수 있습니다."
  echo "💡 작업 종료 후 './scripts/alb-ingress-off.sh'를 실행하여 비용을 0원화하세요."
  echo "=========================================================="
else
  echo "[WARNING] ALB 생성 진행 중입니다. 'kubectl get ingress kyverno-ingress -n kyverno-platform'으로 확인하세요."
fi
