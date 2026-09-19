#!/usr/bin/env bash
# ==============================================================================
# PaC Kyverno Dashboard - Interactive backend-env-secret Injection CLI
# ==============================================================================
# [도입 배경] GitHub Personal Access Token 및 원격 클러스터 자격 증명과 같은 민감 정보를
#             평문 코드나 채팅에 노출하지 않고, 운영자가 인터랙티브 쉘에서 안전하게
#             Hub 클러스터의 backend-env-secret에 직접 주입하기 위함
# [기대 효과] 대화형 프롬프트를 통해 GitHub Token, GitOps 리포지토리 설정, 
#             그리고 외부 Argo CD 클러스터 연동 정보(KUBERNETES_CLUSTERS)를 무중단 반영
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="${LOCAL_BIN_DIR}/kubectl"
if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="$(which kubectl || echo 'kubectl')"
fi

# 컬러 서식 정의
BOLD='\033[1m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

HUB_NAMESPACE="kyverno-platform"

echo -e "${BOLD}${BLUE}==============================================================================${NC}"
echo -e "${BOLD}${BLUE} 🔐 PaC Kyverno Platform - Interactive Secret Injection CLI${NC}"
echo -e "${BOLD}${BLUE}==============================================================================${NC}"

# 1. Hub 클러스터 접근 가능 여부 확인
CURRENT_CONTEXT=$("${KUBECTL}" config current-context 2>/dev/null || echo "")
if [ -z "${CURRENT_CONTEXT}" ]; then
  echo -e "${RED}[ERROR] 현재 활성화된 Kubernetes Context가 없습니다.${NC}" >&2
  echo -e "        Hub 클러스터(EKS/Kind)에 연결된 후 다시 실행해 주세요." >&2
  exit 1
fi

echo -e ">>> 현재 Hub K8s Context  : ${BOLD}${CYAN}${CURRENT_CONTEXT}${NC}"
echo -e ">>> 대상 네임스페이스      : ${BOLD}${CYAN}${HUB_NAMESPACE}${NC}"
echo -e "------------------------------------------------------------------------------"

# 2. GitHub Personal Access Token (PAT) 대화형 입력
echo -e "${BOLD}${YELLOW}[단계 1/3] GitHub Token 및 GitOps PR 연동 설정${NC}"
echo -e "GitHub PR 자동 개설/병합 파이프라인에 사용할 Personal Access Token을 입력하세요."
echo -e "(화면에 입력값이 표시되지 않습니다. 건너뛰려면 Enter를 누르세요)"
read -s -p "GitHub Personal Access Token: " INPUT_GITHUB_TOKEN
echo ""

DEFAULT_GITOPS_REPO="YeongrimGo/test-for"
read -p "GitOps 대상 리포지토리 (기본값: ${DEFAULT_GITOPS_REPO}): " INPUT_GITOPS_REPO
GITOPS_REPO="${INPUT_GITOPS_REPO:-${DEFAULT_GITOPS_REPO}}"

DEFAULT_GITOPS_BRANCH="main"
read -p "GitOps 기본 브랜치 (기본값: ${DEFAULT_GITOPS_BRANCH}): " INPUT_GITOPS_BRANCH
GITOPS_BRANCH="${INPUT_GITOPS_BRANCH:-${DEFAULT_GITOPS_BRANCH}}"

echo -e "------------------------------------------------------------------------------"

# 3. 클러스터 운영 모드 선택 (단일 클러스터 vs 외부 Argo CD 멀티 클러스터)
echo -e "${BOLD}${YELLOW}[단계 2/3] 클러스터 운영 및 Argo CD 연동 모드 선택${NC}"
echo -e "  [1] 단일 클러스터 모드 (현재 Hub 클러스터만 관리)"
echo -e "  [2] 멀티 클러스터 모드 (외부 Argo CD Spoke 클러스터 등록 및 감시)"
read -p "선택 번호 (1 또는 2, 기본값: 1): " CLUSTER_MODE_CHOICE
CLUSTER_MODE_CHOICE="${CLUSTER_MODE_CHOICE:-1}"

CLUSTER_PROVIDER="single"
CLUSTERS_JSON=""

if [ "${CLUSTER_MODE_CHOICE}" = "2" ]; then
  CLUSTER_PROVIDER="multi"
  echo -e "\n${BOLD}${CYAN}>>> 외부 Argo CD 클러스터 정보 수집${NC}"
  
  # 가용 컨텍스트 목록 출력
  echo -e "현재 Kubeconfig 컨텍스트 목록:"
  "${KUBECTL}" config get-contexts -o name | sed 's/^/  • /'
  echo ""
  
  read -p "외부(Spoke) 클러스터 Context 명칭: " SPOKE_KUBECONTEXT
  if [ -z "${SPOKE_KUBECONTEXT}" ]; then
    echo -e "${RED}[ERROR] 외부 클러스터 컨텍스트 이름이 입력되지 않았습니다.${NC}" >&2
    exit 1
  fi
  
  DEFAULT_SPOKE_ID="external-argocd-cluster"
  read -p "외부 클러스터 고유 ID (기본값: ${DEFAULT_SPOKE_ID}): " INPUT_SPOKE_ID
  SPOKE_ID="${INPUT_SPOKE_ID:-${DEFAULT_SPOKE_ID}}"
  
  DEFAULT_SPOKE_NAME="External ArgoCD Spoke"
  read -p "외부 클러스터 표시 이름 (기본값: ${DEFAULT_SPOKE_NAME}): " INPUT_SPOKE_NAME
  SPOKE_NAME="${INPUT_SPOKE_NAME:-${DEFAULT_SPOKE_NAME}}"
  
  echo -e ">>> 외부 클러스터('${SPOKE_KUBECONTEXT}')에서 API Server 및 자격 증명 추출 중..."
  
  # Spoke API Server URL 추출
  SPOKE_SERVER=$("${KUBECTL}" --context="${SPOKE_KUBECONTEXT}" cluster-info 2>/dev/null | grep -o 'https://[^ ]*' | head -n 1 | sed -r "s/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]//g" || echo "")
  if [ -z "${SPOKE_SERVER}" ]; then
    read -p "외부 클러스터 API Server URL (예: https://172.18.0.3:6443 또는 EKS endpoint): " SPOKE_SERVER
  else
    read -p "외부 클러스터 API Server URL (감지값: ${SPOKE_SERVER}): " OVERRIDE_SERVER
    SPOKE_SERVER="${OVERRIDE_SERVER:-${SPOKE_SERVER}}"
  fi
  
  # Spoke CA Data 추출
  SPOKE_CA_DATA=$("${KUBECTL}" --context="${SPOKE_KUBECONTEXT}" get cm kube-root-ca.crt -n kyverno -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -w 0 || echo "")
  if [ -z "${SPOKE_CA_DATA}" ]; then
    SPOKE_CA_DATA=$("${KUBECTL}" --context="${SPOKE_KUBECONTEXT}" config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' 2>/dev/null || echo "")
  fi
  
  # Spoke Token 추출 (kyverno-remote-agent-sa 또는 신규 발급)
  SPOKE_TOKEN=$("${KUBECTL}" --context="${SPOKE_KUBECONTEXT}" get secret kyverno-remote-agent-sa-token -n kyverno -o jsonpath='{.data.token}' 2>/dev/null | base64 -d || echo "")
  if [ -z "${SPOKE_TOKEN}" ]; then
    echo -e ">>> kyverno-remote-agent-sa 토큰 발급 시도..."
    SPOKE_TOKEN=$("${KUBECTL}" --context="${SPOKE_KUBECONTEXT}" create token kyverno-remote-agent-sa -n kyverno --duration=87600h 2>/dev/null || echo "")
  fi
  
  if [ -z "${SPOKE_TOKEN}" ]; then
    echo -e "${YELLOW}[WARN] 외부 클러스터 ServiceAccount 토큰을 자동 추출하지 못했습니다.${NC}"
    read -s -p "외부 클러스터 Bearer Token 수동 입력: " SPOKE_TOKEN
    echo ""
  fi
  
  # Hub 클러스터 자체 정보 추출 (In-cluster 기본값 활용)
  HUB_CA_DATA=$("${KUBECTL}" get cm kube-root-ca.crt -n "${HUB_NAMESPACE}" -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -w 0 || echo "")
  HUB_TOKEN=$("${KUBECTL}" create token kyverno-backend-sa -n "${HUB_NAMESPACE}" --duration=87600h 2>/dev/null || echo "")
  
  # KUBERNETES_CLUSTERS JSON 직렬화
  CLUSTERS_JSON=$(node -e "
    const clusters = [
      {
        id: 'kyverno-eks-lab',
        displayName: 'Primary Governance Hub (EKS)',
        server: 'https://kubernetes.default.svc',
        caData: '${HUB_CA_DATA}',
        token: '${HUB_TOKEN}',
        exceptionNamespace: 'kyverno',
        default: true,
        gitopsRepo: '${GITOPS_REPO}',
        gitopsBranch: '${GITOPS_BRANCH}',
        gitopsPath: 'k8s-manifests/policies'
      },
      {
        id: '${SPOKE_ID}',
        displayName: '${SPOKE_NAME}',
        server: '${SPOKE_SERVER}',
        caData: '${SPOKE_CA_DATA}',
        token: '${SPOKE_TOKEN}',
        exceptionNamespace: 'kyverno',
        default: false,
        gitopsRepo: '${GITOPS_REPO}',
        gitopsBranch: '${GITOPS_BRANCH}',
        gitopsPath: 'k8s-manifests/policies'
      }
    ];
    console.log(JSON.stringify(clusters));
  ")
  
  echo -e "${GREEN}[OK] 멀티 클러스터 JSON 메타데이터 생성 완료 (총 2개 클러스터)${NC}"
fi

echo -e "------------------------------------------------------------------------------"

# 4. Secret 빌드 및 주입
echo -e "${BOLD}${YELLOW}[단계 3/3] backend-env-secret 적용 및 백엔드 무중단 롤아웃${NC}"

# 기존 .env 파일이 있으면 기본값 로드
EXISTING_ENV_FILE="${ROOT_DIR}/apps/backend/.env"
TMP_ENV_FILE=$(mktemp)

if [ -f "${EXISTING_ENV_FILE}" ]; then
  grep -v -E "^(GITHUB_TOKEN|CLUSTER_PROVIDER|KUBERNETES_CLUSTERS|GITOPS_GITHUB_REPO|GITOPS_GITHUB_BASE_BRANCH)=" "${EXISTING_ENV_FILE}" > "${TMP_ENV_FILE}" || true
fi

# 신규 설정 추가
if [ -n "${INPUT_GITHUB_TOKEN}" ]; then
  echo "GITHUB_TOKEN=${INPUT_GITHUB_TOKEN}" >> "${TMP_ENV_FILE}"
fi
echo "GITOPS_GITHUB_REPO=${GITOPS_REPO}" >> "${TMP_ENV_FILE}"
echo "GITOPS_GITHUB_BASE_BRANCH=${GITOPS_BRANCH}" >> "${TMP_ENV_FILE}"
echo "CLUSTER_PROVIDER=${CLUSTER_PROVIDER}" >> "${TMP_ENV_FILE}"

# 선언적 Secret JSON 객체 생성 (stringData 필드를 활용하여 env 변수 및 멀티클러스터 JSON 결합 불가 문제 해결)
echo ">>> Kubernetes Secret 'backend-env-secret' 갱신 중..."

export CLUSTERS_JSON_EXPORT="${CLUSTERS_JSON:-}"
SECRET_JSON=$(node -e '
  const fs = require("fs");
  const envPath = process.argv[1];
  const namespace = process.argv[2];
  const clustersJson = process.env.CLUSTERS_JSON_EXPORT || "";
  
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const stringData = {};
  
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      stringData[key] = val;
    }
  }

  if (clustersJson) {
    stringData["KUBERNETES_CLUSTERS"] = clustersJson;
  }

  const secretObj = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "backend-env-secret",
      namespace: namespace
    },
    type: "Opaque",
    stringData: stringData
  };

  console.log(JSON.stringify(secretObj));
' "${TMP_ENV_FILE}" "${HUB_NAMESPACE}")

echo "${SECRET_JSON}" | "${KUBECTL}" apply -f -

rm -f "${TMP_ENV_FILE}"

echo -e "${GREEN}✅ backend-env-secret 주입 완료!${NC}"

# 5. Backend Deployment 재시작 및 롤아웃 대기
echo ">>> 백엔드 Deployment 롤아웃 재기동 트리거..."
"${KUBECTL}" rollout restart deployment/kyverno-backend -n "${HUB_NAMESPACE}"
echo ">>> 롤아웃 완료 대기 중..."
"${KUBECTL}" rollout status deployment/kyverno-backend -n "${HUB_NAMESPACE}" --timeout=120s

echo -e "${BOLD}${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN} 🎉 환경변수 주입 및 백엔드 롤아웃이 성공적으로 완료되었습니다!${NC}"
echo -e "${BOLD}${GREEN}==============================================================================${NC}"
echo -e ">>> 클러스터 제공자 모드 : ${BOLD}${CYAN}${CLUSTER_PROVIDER}${NC}"
if [ -n "${INPUT_GITHUB_TOKEN}" ]; then
  echo -e ">>> GitHub Token 상태   : ${BOLD}${GREEN}주입 완료 (${INPUT_GITHUB_TOKEN:0:4}...****)${NC}"
else
  echo -e ">>> GitHub Token 상태   : ${YELLOW}미설정 (이전 설정 유지 또는 생략)${NC}"
fi
echo -e ">>> GitOps 리포지토리    : ${BOLD}${CYAN}${GITOPS_REPO} (${GITOPS_BRANCH})${NC}"
echo -e "==============================================================================\n"
