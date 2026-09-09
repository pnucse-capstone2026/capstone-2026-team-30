#!/usr/bin/env bash
# ==============================================================================
# 멀티클러스터 종합 성능 벤치마크 원클릭 실행 스크립트
# ==============================================================================
# [도입 배경] 백엔드 가용성 점검부터 TypeScript 벤치마크 러너 기동 및 결과 리포트
#             저장까지의 전 과정을 원클릭으로 일관되게 자동화
# [기대 효과] 수동 조작 실수 방지 및 CI/CD 파이프라인과 논문 실측 데이터 추출 연계
# ==============================================================================

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/../.."

echo "=============================================================================="
echo " 🚀 Multi-Cluster Governance Platform Performance Benchmark Suite"
echo "=============================================================================="
echo " 🌐 Target Backend URL : ${BACKEND_URL}"
echo "=============================================================================="

# 1. 백엔드 상태 확인
echo ">>> Checking Backend connectivity at ${BACKEND_URL}/health..."
if ! curl --silent --fail "${BACKEND_URL}/health" >/dev/null 2>&1; then
  echo "⚠️  [WARNING] Backend does not appear to be running at ${BACKEND_URL}"
  echo "    Please ensure 'pnpm start' or Kubernetes port-forward is running."
fi

# 2. Benchmark Runner 실행 (tsx 또는 ts-node)
echo ">>> Launching TypeScript Benchmark Runner..."
pnpm --dir "${ROOT_DIR}/apps/backend" exec ts-node "${SCRIPT_DIR}/benchmark-runner.ts"

echo "=============================================================================="
echo " 🎉 All Benchmarks Finished!"
echo "=============================================================================="
