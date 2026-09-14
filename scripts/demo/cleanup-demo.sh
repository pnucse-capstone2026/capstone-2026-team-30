#!/usr/bin/env bash
set -euo pipefail

# 시연 종료 후 임시 인프라 및 데모 파드 완전 원상복구(Clean-up) 스크립트
#
# [도입 배경]
# 시연 목적으로 일시 배포된 Policy Reporter, 임시 네임스페이스 및 테스트 파드를
# 단 한 번의 스크립트 실행으로 100% 제거하여 본래 플랫폼 상태로 깨끗하게 복구.
#
# [기대 효과]
# 1. K8s 클러스터 리소스 누수(메모리/CPU) 완전 방지.
# 2. 임시 설치된 네임스페이스와 Helm 릴리스를 완벽히 제거하여 운영 환경 오염 방지.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTBED_DIR="${SCRIPT_DIR}/../../k8s-manifests/testbed"

echo "================================================================="
echo ">>> [Kyverno Demo Hub] Cleaning up all presentation assets..."
echo "================================================================="

# 1. 시연용 테스트베드 파드 삭제
echo ">>> [1/3] Deleting testbed workloads..."
kubectl delete -f "${TESTBED_DIR}/11-violation-disallow-latest-tag.yaml" --ignore-not-found > /dev/null 2>&1 || true
kubectl delete -f "${TESTBED_DIR}/12-violation-privileged-container.yaml" --ignore-not-found > /dev/null 2>&1 || true
kubectl delete -f "${TESTBED_DIR}/compliant-app.yaml" --ignore-not-found > /dev/null 2>&1 || true
echo "    - Demo workloads deleted."

# 2. Policy Reporter Helm 릴리스 및 네임스페이스 제거
echo ">>> [2/3] Uninstalling Policy Reporter Helm release..."
if helm status policy-reporter -n policy-reporter > /dev/null 2>&1; then
  helm uninstall policy-reporter -n policy-reporter > /dev/null 2>&1 || true
  echo "    - Helm release 'policy-reporter' uninstalled."
fi

echo "    - Deleting 'policy-reporter' namespace..."
kubectl delete namespace policy-reporter --ignore-not-found > /dev/null 2>&1 || true

# 3. 임시 모니터링 네임스페이스가 존재할 경우 정리
echo ">>> [3/3] Checking demo monitoring namespaces..."
kubectl delete namespace demo-monitoring --ignore-not-found > /dev/null 2>&1 || true

echo "================================================================="
echo ">>> [Cleanup Complete] Kubernetes cluster is restored to clean state!"
echo ""
echo "💡 프론트엔드 코드 정리 안내:"
echo "   시연용 신규 파일들을 로컬 파일시스템에서도 완전히 지우려면 아래 명령을 실행하세요:"
echo "   $ rm -rf apps/frontend/src/app/demo/presentation"
echo "   $ rm -rf scripts/demo"
echo "================================================================="
