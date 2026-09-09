#!/bin/bash
# user@test.com 전용 Docker 샌드박스 격리 환경 실행 스크립트 (방안 2)
# [도입 배경] 호스트의 AWS 관리자 자격 증명(~/.aws) 및 환경변수를 원천 차단하여 완전한 샌드박스 제공
# [기대 효과] 도커 컨테이너 내부에서 오직 user-test.kubeconfig와 매니페스트 파일만 마운트된 무결점 테스트 환경 구동

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

# 2. Docker 데몬 접근성 검증
if ! docker info > /dev/null 2>&1; then
  echo "[ERROR] Docker 데몬이 실행 중이지 않거나 접근 권한이 없습니다." >&2
  exit 1
fi

DOCKER_IMAGE="bitnami/kubectl:latest"

echo "=============================================================================="
echo " 🐳 [방안 2] user@test.com Docker 샌드박스 컨테이너를 기동합니다."
echo "=============================================================================="
echo ">>> 컨테이너 이미지  : ${DOCKER_IMAGE}"
echo ">>> 격리 보장        : 호스트의 ~/.aws 및 환경변수 100% 차단됨"
echo ">>> 마운트 설정      : Kubeconfig (읽기 전용) + /workspace (프로젝트 매니페스트)"
echo ">>> 네임스페이스     : governance-testbed"
echo "------------------------------------------------------------------------------"
echo "💡 컨테이너 내부 사용 안내:"
echo "   - 작업 디렉토리: /workspace"
echo "   - 매니페스트 위치: /workspace/k8s-manifests"
echo "   - 테스트 명령어: kubectl apply -f k8s-manifests/testbed/13-violation-missing-limits.yaml"
echo ""
echo "🚪 컨테이너를 종료하고 호스트로 복귀하려면 'exit'를 입력하세요."
echo "=============================================================================="

# 3. 도커 샌드박스 컨테이너 실행
docker run -it --rm \
  --name "kyverno-user-test-sandbox" \
  --network host \
  -v "${KUBECONFIG_PATH}:/root/.kube/config:ro" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace \
  -e PS1="\[\e[1;36m\][user@test.com-docker (governance-testbed)]\[\e[0m\] \w # " \
  "${DOCKER_IMAGE}" bash || {
    # bash가 없는 이미지 fallback 대응
    docker run -it --rm \
      --name "kyverno-user-test-sandbox" \
      --network host \
      -v "${KUBECONFIG_PATH}:/root/.kube/config:ro" \
      -v "${ROOT_DIR}:/workspace" \
      -w /workspace \
      "${DOCKER_IMAGE}" sh
  }

echo ""
echo ">>> Docker 샌드박스 컨테이너가 정상 종료 및 정리되었습니다."
