#!/bin/bash
# 로컬 개발 환경용 Kyverno 단발성 수동 전수 정책 스캔(On-Demand Scan) 실행 스크립트
# [도입 배경] 주기 스캔이 비활성화된 로컬 환경에서 신규 정책이나 워크로드 배포 후 즉시 1회 전체 감사를 실행하기 위함
# [기대 효과] Reports Controller 재시작(방법 1)을 통해 클러스터 전체 리소스에 대해 PolicyReport를 최신 상태로 1회 갱신

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"

export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="${LOCAL_BIN_DIR}/kubectl"
[ ! -f "${KUBECTL}" ] && KUBECTL="kubectl"

echo "=========================================================="
echo " 🔍 Kyverno Manual Full Policy Scan Trigger (Method 1)"
echo "=========================================================="

# 1. Kyverno Reports Controller 배포 여부 확인
if ! "${KUBECTL}" get deployment kyverno-reports-controller -n kyverno > /dev/null 2>&1; then
  echo "[ERROR] 'kyverno-reports-controller' deployment not found in namespace 'kyverno'."
  echo "        Please ensure the local cluster and Kyverno are running."
  exit 1
fi

# 2. Reports Controller 롤아웃 재시작으로 초기 1회 전수 스캔 트리거
echo ">>> Triggering initial full cluster scan via Reports Controller rollout restart..."
"${KUBECTL}" -n kyverno rollout restart deployment/kyverno-reports-controller

echo ">>> Waiting for Reports Controller rollout to complete..."
"${KUBECTL}" -n kyverno rollout status deployment/kyverno-reports-controller --timeout=120s

# 3. 생성된 PolicyReport 상태 요약 출력
echo ""
echo "=========================================================="
echo " ✅ Manual Policy Scan Triggered Successfully!"
echo "=========================================================="
echo ">>> Current Cluster Policy Reports Summary:"
"${KUBECTL}" get clusterpolicyreports -A 2>/dev/null || echo "No ClusterPolicyReports found yet."
echo ""
echo ">>> Current Namespace Policy Reports Summary:"
"${KUBECTL}" get policyreports -A 2>/dev/null || echo "No PolicyReports found yet."
echo "=========================================================="
