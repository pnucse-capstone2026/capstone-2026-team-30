#!/bin/bash
# user@test.com 개발자 전용 ServiceAccount 생성 및 독립 Kubeconfig 발급 스크립트
# [도입 배경] 호스트의 AWS 관리자 로그인 상태를 침범하지 않고 user@test.com 자격 증명만 분리하기 위함
# [기대 효과] 호스트 AWS 계정과 완전히 독립된 K8s 토큰 기반 user-test.kubeconfig 자동 생성

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="$(which kubectl || echo "")"
if [ -z "${KUBECTL}" ] && [ -f "${LOCAL_BIN_DIR}/kubectl" ]; then
  KUBECTL="${LOCAL_BIN_DIR}/kubectl"
fi

if [ -z "${KUBECTL}" ]; then
  echo "[ERROR] kubectl 명령어를 찾을 수 없습니다." >&2
  exit 1
fi

USER_EMAIL="${1:-user@test.com}"
TARGET_NAMESPACE="${2:-governance-testbed}"
SA_NAME="user-test-sa"
OUTPUT_KUBECONFIG="${HOME}/.kube/user-test.kubeconfig"

# 터미널 컬러 서식
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}==============================================================================${NC}"
echo -e "${BOLD}${BLUE} 🔑 user@test.com 전용 Kubeconfig 발급 및 RBAC 셋업${NC}"
echo -e "${BOLD}${BLUE}==============================================================================${NC}"
echo -e ">>> 대상 사용자       : ${BOLD}${USER_EMAIL}${NC}"
echo -e ">>> 대상 네임스페이스 : ${BOLD}${TARGET_NAMESPACE}${NC}"
echo -e ">>> 생성 대상 파일   : ${BOLD}${OUTPUT_KUBECONFIG}${NC}"
echo -e "------------------------------------------------------------------------------"

# 1. 활성 클러스터 연결 상태 확인
CURRENT_CONTEXT=$("${KUBECTL}" config current-context 2>/dev/null || echo "")
if [ -z "${CURRENT_CONTEXT}" ]; then
  echo -e "${RED}[ERROR] 현재 활성화된 Kubernetes Context가 없습니다.${NC}" >&2
  echo -e "        관리자 권한으로 클러스터에 연결되어 있는지 확인해 주세요." >&2
  echo -e "        예: aws eks update-kubeconfig --name <cluster-name> --region us-east-1" >&2
  exit 1
fi

echo -e ">>> 현재 K8s Context  : ${BOLD}${CURRENT_CONTEXT}${NC}"

# 2. 대상 네임스페이스, ServiceAccount, RoleBinding 프로비저닝
echo -e ">>> [1/4] ServiceAccount 및 RoleBinding 적용 중..."
"${KUBECTL}" apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${TARGET_NAMESPACE}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SA_NAME}
  namespace: ${TARGET_NAMESPACE}
  annotations:
    pac.governance/email: "${USER_EMAIL}"
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA_NAME}-binding
  namespace: ${TARGET_NAMESPACE}
subjects:
- kind: ServiceAccount
  name: ${SA_NAME}
  namespace: ${TARGET_NAMESPACE}
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
EOF

# 3. ServiceAccount 인증 토큰 생성 (장기 유효: 87600h = 10년)
echo -e ">>> [2/4] ${USER_EMAIL} 전용 장기 인증 토큰 발급 중..."
USER_TOKEN=$("${KUBECTL}" create token "${SA_NAME}" -n "${TARGET_NAMESPACE}" --duration=87600h 2>/dev/null || echo "")

if [ -z "${USER_TOKEN}" ]; then
  echo -e "${YELLOW}[WARN] create token이 지원되지 않아 Secret 방식 토큰 조회를 시도합니다...${NC}"
  "${KUBECTL}" apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${SA_NAME}-token
  namespace: ${TARGET_NAMESPACE}
  annotations:
    kubernetes.io/service-account.name: ${SA_NAME}
type: kubernetes.io/service-account-token
EOF
  sleep 2
  USER_TOKEN=$("${KUBECTL}" get secret "${SA_NAME}-token" -n "${TARGET_NAMESPACE}" -o jsonpath='{.data.token}' | base64 --decode 2>/dev/null || echo "")
fi

if [ -z "${USER_TOKEN}" ]; then
  echo -e "${RED}[ERROR] ServiceAccount 토큰 생성에 실패했습니다.${NC}" >&2
  exit 1
fi

# 4. API 서버 엔드포인트 및 CA 데이터 추출
echo -e ">>> [3/4] 클러스터 연결 엔드포인트 및 CA 데이터 추출 중..."
CLUSTER_NAME=$("${KUBECTL}" config view --minify -o jsonpath='{.contexts[0].context.cluster}')
CLUSTER_SERVER=$("${KUBECTL}" config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CLUSTER_CA=$("${KUBECTL}" config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

if [ -z "${CLUSTER_SERVER}" ]; then
  echo -e "${RED}[ERROR] 클러스터 API Server 엔드포인트를 추출하지 못했습니다.${NC}" >&2
  exit 1
fi

# 5. 독립 Kubeconfig 파일 생성
echo -e ">>> [4/4] 독립 Kubeconfig 파일 작성: ${OUTPUT_KUBECONFIG}"
mkdir -p "$(dirname "${OUTPUT_KUBECONFIG}")"

cat <<EOF > "${OUTPUT_KUBECONFIG}"
apiVersion: v1
kind: Config
preferences: {}
clusters:
- cluster:
    certificate-authority-data: ${CLUSTER_CA}
    server: ${CLUSTER_SERVER}
  name: ${CLUSTER_NAME}
contexts:
- context:
    cluster: ${CLUSTER_NAME}
    namespace: ${TARGET_NAMESPACE}
    user: ${USER_EMAIL}
  name: user-test-context
current-context: user-test-context
users:
- name: ${USER_EMAIL}
  user:
    token: ${USER_TOKEN}
EOF

chmod 600 "${OUTPUT_KUBECONFIG}"

# 6. 권한 검증 테스트
CAN_CREATE=$("${KUBECTL}" --kubeconfig="${OUTPUT_KUBECONFIG}" auth can-i create pods -n "${TARGET_NAMESPACE}" 2>/dev/null || echo "no")
CAN_ADMIN=$("${KUBECTL}" --kubeconfig="${OUTPUT_KUBECONFIG}" auth can-i delete nodes 2>/dev/null || echo "no")

echo -e "\n${BOLD}${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN} 🎉 user@test.com 전용 독립 Kubeconfig 발급 완료!${NC}"
echo -e "${BOLD}${GREEN}==============================================================================${NC}"
echo -e ">>> 설정 파일 경로    : ${BOLD}${OUTPUT_KUBECONFIG}${NC}"
echo -e ">>> 네임스페이스 권한 : Pod 생성 권한 [${GREEN}${CAN_CREATE}${NC}]"
echo -e ">>> 관리자 권한 제한 : Node 삭제 권한 차단 확인 [${YELLOW}${CAN_ADMIN}${NC}]"
echo -e "------------------------------------------------------------------------------"
echo -e "💡 사용 방법 (방안 1 - 서브셸 실행):"
echo -e "   ${BOLD}./scripts/user-shell.sh${NC}   (또는 pnpm user:shell)"
echo -e ""
echo -e "💡 사용 방법 (방안 2 - Docker 샌드박스 실행):"
echo -e "   ${BOLD}./scripts/user-docker-sandbox.sh${NC}   (또는 pnpm user:docker)"
echo -e "${BOLD}${GREEN}==============================================================================${NC}"
