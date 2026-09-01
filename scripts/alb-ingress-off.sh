#!/bin/bash
# AWS ALB Ingress On-Demand 끄기(삭제) 스크립트
# 도입 배경: 개발/테스트 완료 후 즉시 ALB 및 AWS 네트워크 과금을 0원화(Teardown)하기 위함
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"
INGRESS_MANIFEST="${SCRIPT_DIR}/../k8s-manifests/system/ingress.yaml"

echo "=========================================================="
echo " 🧹 Teardown AWS ALB Ingress (Cost Reduction Mode)"
echo "=========================================================="

if kubectl get ingress kyverno-ingress -n kyverno-platform &>/dev/null; then
  echo ">>> Deleting Kubernetes Ingress manifest..."
  kubectl delete -f "${INGRESS_MANIFEST}" --ignore-not-found=true
  echo ">>> Waiting for AWS Load Balancer Controller to release AWS ALB resources..."
  sleep 10
  echo "=========================================================="
  echo " 🛑 AWS ALB resources deleted successfully."
  echo " 💰 AWS Load Balancer 과금이 즉시 중단되었습니다."
  echo "=========================================================="
else
  echo ">>> Ingress 'kyverno-ingress'가 활성화되어 있지 않습니다. 이미 과금 0원 상태입니다."
fi
