#!/usr/bin/env bash
set -euo pipefail

# 청중 시연용 3-Act 스토리보드 실행기 (Presenter Runner)
#
# [도입 배경]
# 라이브 데모 도중 오탈자나 긴 명령어 타이핑 실수를 방지하고,
# 발표자가 청중에 전달해야 할 핵심 비유와 화면 포인트를 터미널에 함께 출력하여 안정적인 시연을 지원.
#
# [기대 효과]
# 1. 단일 명령어로 Act 1 (차단), Act 2 (감사), Act 3 (정상 통과), Reset 워크플로우를 완벽 제어.
# 2. 발표 화면(/demo/presentation)의 실시간 반응과 1:1로 매칭.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTBED_DIR="${SCRIPT_DIR}/../../k8s-manifests/testbed"

usage() {
  echo "Usage: $0 [act1 | act2 | act3 | reset | status]"
  echo ""
  echo "  act1   - [Enforce 차단]: 루트/Privileged 위험 파드 배포 시도 (403 Forbidden & Grafana 스파이크)"
  echo "  act2   - [Audit 감사]:   latest 태그 파드 배포 (배포 허용 + Policy Reporter에 위반 카드 생성)"
  echo "  act3   - [정상 규격]:    모든 거버넌스 규정을 준수한 안전한 파드 배포 (All Green)"
  echo "  reset  - 시연 중 배포된 테스트 파드 일괄 정리"
  echo "  status - 현재 배포된 테스트베드 파드 상태 확인"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

COMMAND="$1"

case "${COMMAND}" in
  act1)
    echo "=================================================================="
    echo ">>> [ACT 1] Enforce Mode Demonstration: High-Risk Pod Admission"
    echo "------------------------------------------------------------------"
    echo "📢 [발표 포인트]:"
    echo "   '방화벽이 위험 패킷을 막듯, 보안 취약점(Privileged)을 가진 파드가"
    echo "    배포되는 즉시 입구(Admission Webhook)에서 원천 차단됩니다.'"
    echo "👀 [화면 관찰 포인트]:"
    echo "   • 터미널: 403 Forbidden 에러 출력"
    echo "   • Grafana 탭: 'Admission Denials' 게이지가 빨간색 숫자로 스파이크!"
    echo "=================================================================="
    echo ">>> Executing: kubectl apply -f ${TESTBED_DIR}/12-violation-privileged-container.yaml"
    echo ""
    # 차단으로 인해 종료 코드 1이 반환되므로 스크립트 중단 방지(|| true)
    kubectl apply -f "${TESTBED_DIR}/12-violation-privileged-container.yaml" || true
    echo ""
    echo ">>> [Act 1 Complete] Please direct audience attention to the Grafana tab!"
    ;;

  act2)
    echo "=================================================================="
    echo ">>> [ACT 2] Audit Mode Demonstration: Policy Violation Detection"
    echo "------------------------------------------------------------------"
    echo "📢 [발표 포인트]:"
    echo "   '서비스 중단 없이 일단 배포는 허용하되, 정적 코드 분석기처럼"
    echo "    거버넌스 위반 티켓(PolicyReport CRD)을 백그라운드로 자동 생성합니다.'"
    echo "👀 [화면 관찰 포인트]:"
    echo "   • 터미널: 파드가 성공적으로 배포됨"
    echo "   • Policy Reporter 탭: 'disallow-latest-tag' 빨간색 위반 카드 생성!"
    echo "=================================================================="
    echo ">>> Executing: kubectl apply -f ${TESTBED_DIR}/11-violation-disallow-latest-tag.yaml"
    echo ""
    kubectl apply -f "${TESTBED_DIR}/11-violation-disallow-latest-tag.yaml"
    echo ""
    echo ">>> [Act 2 Complete] Refresh Policy Reporter tab to see the new Fail card!"
    ;;

  act3)
    echo "=================================================================="
    echo ">>> [ACT 3] Compliant Deployment: Clean Production Governance"
    echo "------------------------------------------------------------------"
    echo "📢 [발표 포인트]:"
    echo "   '모든 보안 규정(비루트 유저, 리소스 제한, 명시적 태그)을 준수한"
    echo "    파드는 어떠한 위반도 유발하지 않고 안전하게 Running 상태가 됩니다.'"
    echo "👀 [화면 관찰 포인트]:"
    echo "   • Policy Reporter 탭: 모든 정책 검사를 통과하여 All Green(Pass) 유지"
    echo "=================================================================="
    echo ">>> Executing: kubectl apply -f ${TESTBED_DIR}/compliant-app.yaml"
    echo ""
    kubectl apply -f "${TESTBED_DIR}/compliant-app.yaml"
    echo ""
    echo ">>> [Act 3 Complete] The compliant workload is running cleanly."
    ;;

  reset)
    echo "=================================================================="
    echo ">>> Resetting presentation workloads..."
    echo "=================================================================="
    kubectl delete -f "${TESTBED_DIR}/11-violation-disallow-latest-tag.yaml" --ignore-not-found
    kubectl delete -f "${TESTBED_DIR}/12-violation-privileged-container.yaml" --ignore-not-found
    kubectl delete -f "${TESTBED_DIR}/compliant-app.yaml" --ignore-not-found
    echo ">>> All demo workloads cleaned up successfully."
    ;;

  status)
    echo ">>> Current pods in governance-testbed namespace:"
    kubectl get pods -n governance-testbed -o wide || true
    ;;

  *)
    usage
    ;;
esac
