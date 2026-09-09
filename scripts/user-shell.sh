#!/bin/bash
# user@test.com 전용 서브셸(Subshell) 환경 실행 스크립트 (방안 1)
# [도입 배경] 호스트의 AWS 관리자 로그인 상태를 전혀 건드리지 않고, 격리된 개발자 터미널 세션을 제공하기 위함
# [기대 효과] AWS 환경변수를 임시 비활성화하고 user-test.kubeconfig를 바라보는 안전한 서브셸 제공

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
KUBECONFIG_PATH="${HOME}/.kube/user-test.kubeconfig"

# 1. Kubeconfig 파일 존재 여부 확인 및 부재 시 자동 생성
if [ ! -f "${KUBECONFIG_PATH}" ]; then
  echo ">>> user-test.kubeconfig 파일이 존재하지 않아 자동으로 생성을 시도합니다..."
  bash "${SCRIPT_DIR}/setup-user-environment.sh" || {
    echo "[ERROR] user@test.com 환경 설정에 실패했습니다." >&2
    exit 1
  }
fi

# 2. 임시 쉘 설정 파일(rcfile)을 생성하여 프롬프트와 환경변수 격리 적용
TMP_RC=$(mktemp)
cat <<'EOF' > "${TMP_RC}"
# 기본 bash 설정 로드 (별칭 및 히스토리 유지)
[ -f ~/.bashrc ] && source ~/.bashrc

# 호스트의 AWS 관리자 자격 증명 환경변수를 임시 제거하여 실수로 인한 AWS API 호출 차단
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
unset AWS_PROFILE
unset AWS_DEFAULT_REGION

# KUBECONFIG를 user-test 전용으로 고정
export KUBECONFIG="${HOME}/.kube/user-test.kubeconfig"

# 노란색 강조 프롬프트 설정으로 현재 세션 식별 용이성 확보
export PS1="\[\e[1;33m\][user@test.com (governance-testbed)]\[\e[0m\] \w \$ "

# 헬퍼 별칭 등록
alias k="kubectl"
alias my-whoami="kubectl auth whoami 2>/dev/null || kubectl config view --minify"
EOF

# 3. 안내 배너 출력
echo "=============================================================================="
echo " 🧑‍💻 [방안 1] user@test.com 전용 격리 서브셸(Subshell)에 진입했습니다."
echo "=============================================================================="
echo ">>> 현재 사용자      : user@test.com (Role: Requester / Developer)"
echo ">>> 대상 네임스페이스 : governance-testbed"
echo ">>> KUBECONFIG       : ${KUBECONFIG_PATH}"
echo ">>> AWS 자격 증명    : 호스트의 AWS 관리자 키와 완전 분리됨 (Unset 처리)"
echo "------------------------------------------------------------------------------"
echo "💡 추천 테스트 명령어:"
echo "   1) 배포 권한 확인: kubectl auth can-i create pods -n governance-testbed"
echo "   2) 관리자 차단 확인: kubectl auth can-i delete nodes"
echo "   3) 위반 워크로드 배포 시도 (limits 누락):"
echo "      kubectl apply -f k8s-manifests/testbed/13-violation-missing-limits.yaml"
echo "   4) 위반 워크로드 배포 시도 (latest 태그):"
echo "      kubectl apply -f k8s-manifests/testbed/11-violation-disallow-latest-tag.yaml"
echo ""
echo "🚪 서브셸을 종료하고 호스트 관리자 셸로 돌아가려면 'exit'를 입력하세요."
echo "=============================================================================="

# 4. 격리된 bash 서브셸 실행
bash --rcfile "${TMP_RC}" -i

# 5. 종료 시 정리
rm -f "${TMP_RC}"
echo ""
echo ">>> user@test.com 서브셸이 종료되었습니다. 호스트 관리자 환경으로 복귀했습니다."
