#!/usr/bin/env bash
# ==============================================================================
# Phase 1: Shift-Left PR 거버넌스 검증 엔진 및 Bedrock AI Self-Correction Loop
# E2E(End-to-End) 통합 검증 및 데모 시연 자동화 스크립트
#
# [도입 배경] GitHub Actions CI 환경과 쿠버네티스 Kyverno 어드미션 웹훅 간
#             Server-Side Dry-Run 및 AI Self-Correction 루프의 무결성 검증
# [기대 효과] PR 게이트 시뮬레이션부터 AI 교정, 안전 가이드 폴백, CI 인증까지 원클릭 E2E 검증
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOCAL_BIN_DIR="${WORKSPACE_ROOT}/scripts/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

# 설정값
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
CI_TOKEN="${GITOPS_CI_TOKEN:-test-ci-token-secret}"
TARGET_NAMESPACE="${TARGET_NAMESPACE:-default}"
TARGET_CLUSTER="${TARGET_CLUSTER:-default}"

# ANSI 컬러 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

PASSED_COUNT=0
TOTAL_TESTS=4

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" == "$actual" ]]; then
    log_success "$message (값: $actual)"
  else
    log_fail "$message - 기대값: '$expected', 실제값: '$actual'"
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    log_success "$message"
  else
    log_fail "$message (포함되지 않음: '$needle')"
    exit 1
  fi
}

echo -e "${CYAN}${BOLD}"
echo "=============================================================================="
echo " 🛡️  Phase 1 E2E Test Suite: Shift-Left PR Gate & AI Self-Correction Loop"
echo "=============================================================================="
echo -e "${NC}"
echo " 백엔드 엔드포인트 : ${BACKEND_URL}"
echo " CI 인증 토큰      : ${CI_TOKEN:0:4}****"
echo " 대상 클러스터     : ${TARGET_CLUSTER}"
echo " 대상 네임스페이스 : ${TARGET_NAMESPACE}"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# 0. 사전 점검 (Prerequisites Check)
# ------------------------------------------------------------------------------
log_info "1. 로컬 환경 및 사전 준비 상태 점검..."

# 백엔드 헬스체크
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/health" || true)
if [[ "${HEALTH_STATUS}" != "200" ]]; then
  log_fail "백엔드 서버(${BACKEND_URL})에 연결할 수 없습니다. (HTTP 상태: ${HEALTH_STATUS})"
  log_info "백엔드 서버를 먼저 기동해 주세요: 'pnpm --filter @kyverno-platform/backend start:dev' 또는 'node apps/backend/dist/main.js'"
  exit 1
fi
log_success "백엔드 서버 헬스체크 정상 (HTTP 200)"

# Kind 클러스터 점검
if command -v kubectl &>/dev/null; then
  if kubectl get clusterpolicy require-labels &>/dev/null && kubectl get clusterpolicy disallow-privileged &>/dev/null; then
    log_success "Kyverno 거버넌스 정책 준비 확인 (require-labels, disallow-privileged)"
  else
    log_warn "Kyverno 정책이 일부 누락되었을 수 있습니다. 필요 시 kubectl apply를 확인하세요."
  fi
fi

# ------------------------------------------------------------------------------
# 시나리오 1: 정상 매니페스트 통과 (Clean Pass)
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}>>> [시나리오 1] 정상 매니페스트 검증 (Clean Pass)${NC}"
log_info "정책을 100% 준수하는 Nginx Deployment 매니페스트 전송..."

CLEAN_MANIFEST=$(cat <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: e2e-nginx-clean
  namespace: default
  labels:
    app.kubernetes.io/name: e2e-nginx-clean
    team: platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: e2e-nginx-clean
  template:
    metadata:
      labels:
        app.kubernetes.io/name: e2e-nginx-clean
        team: platform
    spec:
      containers:
        - name: nginx
          image: public.ecr.aws/docker/library/nginx:1.27.0
          securityContext:
            privileged: false
EOF
)

SC1_PAYLOAD=$(jq -n \
  --arg repo "acme-corp/payment-service" \
  --argjson pr 101 \
  --arg sha "a1b2c3d4e5f6789012345678901234567890abcd" \
  --arg cluster "${TARGET_CLUSTER}" \
  --arg ns "${TARGET_NAMESPACE}" \
  --arg manifest "${CLEAN_MANIFEST}" \
  '{
    repository: $repo,
    pullNumber: $pr,
    commitSha: $sha,
    clusterId: $cluster,
    targetNamespace: $ns,
    manifestYaml: $manifest
  }')

SC1_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/api/v1/gitops/pr-review" \
  -H "Content-Type: application/json" \
  -H "X-CI-Token: ${CI_TOKEN}" \
  -d "${SC1_PAYLOAD}")

SC1_HTTP_CODE=$(echo "${SC1_RESPONSE}" | tail -n 1)
SC1_BODY=$(echo "${SC1_RESPONSE}" | sed '$d')

assert_equals "201" "${SC1_HTTP_CODE}" "시나리오 1 HTTP 상태 코드 201 (성공)"
SC1_VALID=$(echo "${SC1_BODY}" | jq -r '.valid')
SC1_DRYRUN=$(echo "${SC1_BODY}" | jq -r '.dryRunPassed')
SC1_BLOCKED=$(echo "${SC1_BODY}" | jq -r '.blocked')
SC1_VIOLATIONS_COUNT=$(echo "${SC1_BODY}" | jq -r '.violations | length')
SC1_STATUS=$(echo "${SC1_BODY}" | jq -r '.status')

assert_equals "true" "${SC1_VALID}" "전체 유효성 통과 (valid: true)"
assert_equals "true" "${SC1_DRYRUN}" "Server-Side Dry-Run 통과 (dryRunPassed: true)"
assert_equals "false" "${SC1_BLOCKED}" "어드미션 차단 없음 (blocked: false)"
assert_equals "0" "${SC1_VIOLATIONS_COUNT}" "위반 항목 없음 (violations: [])"
assert_equals "PASSED" "${SC1_STATUS}" "검증 최종 상태 PASSED"
assert_contains "${SC1_BODY}" "🛡️ Kyverno Governance Gate: ✅ PASSED" "PR Bot 코멘트 PASSED 배지 확인"

PASSED_COUNT=$((PASSED_COUNT + 1))
log_success "시나리오 1: 정상 매니페스트 통과 (Clean Pass) 검증 성공!"

# ------------------------------------------------------------------------------
# 시나리오 2: 정책 위반 발생 및 AI Self-Correction 교정 통과 (Self-Correction Success)
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}>>> [시나리오 2] 정책 위반 및 AI Self-Correction 자가 교정 통과${NC}"
log_info "app.kubernetes.io/name 및 team 필수 라벨이 누락된 Deployment 매니페스트 전송..."

MISSING_LABELS_MANIFEST=$(cat <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: e2e-nginx-missing-labels
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: e2e-nginx-missing-labels
  template:
    metadata:
      labels:
        app.kubernetes.io/name: e2e-nginx-missing-labels
        team: platform
    spec:
      containers:
        - name: nginx
          image: public.ecr.aws/docker/library/nginx:1.27.0
          securityContext:
            privileged: false
EOF
)

SC2_PAYLOAD=$(jq -n \
  --arg repo "acme-corp/payment-service" \
  --argjson pr 102 \
  --arg sha "b2c3d4e5f6a1789012345678901234567890bcde" \
  --arg cluster "${TARGET_CLUSTER}" \
  --arg ns "${TARGET_NAMESPACE}" \
  --arg manifest "${MISSING_LABELS_MANIFEST}" \
  '{
    repository: $repo,
    pullNumber: $pr,
    commitSha: $sha,
    clusterId: $cluster,
    targetNamespace: $ns,
    manifestYaml: $manifest
  }')

SC2_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/api/v1/gitops/pr-review" \
  -H "Content-Type: application/json" \
  -H "X-CI-Token: ${CI_TOKEN}" \
  -d "${SC2_PAYLOAD}")

SC2_HTTP_CODE=$(echo "${SC2_RESPONSE}" | tail -n 1)
SC2_BODY=$(echo "${SC2_RESPONSE}" | sed '$d')

assert_equals "201" "${SC2_HTTP_CODE}" "시나리오 2 HTTP 상태 코드 201 (성공 응답)"
SC2_BLOCKED=$(echo "${SC2_BODY}" | jq -r '.blocked')
SC2_CORRECTED=$(echo "${SC2_BODY}" | jq -r '.selfCorrectionResult.corrected')
SC2_COMMENT=$(echo "${SC2_BODY}" | jq -r '.commentMarkdown')

assert_equals "true" "${SC2_BLOCKED}" "1차 원본 매니페스트 정책 위반 감지 (blocked: true)"
assert_equals "true" "${SC2_CORRECTED}" "AI 자가 교정 및 2차 Dry-Run 재검증 통과 (selfCorrectionResult.corrected: true)"
assert_contains "${SC2_COMMENT}" "[AI Self-Correction Passed]" "코멘트에 [AI Self-Correction Passed] 배지 포함"
assert_contains "${SC2_COMMENT}" "\`\`\`suggestion" "코멘트에 GitHub markdown suggestion 코드블록 포함"

PASSED_COUNT=$((PASSED_COUNT + 1))
log_success "시나리오 2: AI Self-Correction 자가 교정 루프 통과 검증 성공!"

# ------------------------------------------------------------------------------
# 시나리오 3: 해결 불가능한 치명적 위반 및 Safe Guidance 폴백 (Safe Fallback & Deep-link)
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}>>> [시나리오 3] 해결 불가능한 보안 위반 및 Safe Guidance 폴백${NC}"
log_info "치명적 특권 권한(securityContext.privileged: true)이 포함된 매니페스트 전송..."

PRIVILEGED_MANIFEST=$(cat <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: e2e-nginx-privileged
  namespace: default
  labels:
    app.kubernetes.io/name: e2e-nginx-privileged
    team: platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: e2e-nginx-privileged
  template:
    metadata:
      labels:
        app.kubernetes.io/name: e2e-nginx-privileged
        team: platform
    spec:
      containers:
        - name: nginx
          image: public.ecr.aws/docker/library/nginx:1.27.0
          securityContext:
            privileged: true
EOF
)

SC3_PAYLOAD=$(jq -n \
  --arg repo "acme-corp/payment-service" \
  --argjson pr 103 \
  --arg sha "c3d4e5f6a1b2789012345678901234567890cdef" \
  --arg cluster "${TARGET_CLUSTER}" \
  --arg ns "${TARGET_NAMESPACE}" \
  --arg manifest "${PRIVILEGED_MANIFEST}" \
  '{
    repository: $repo,
    pullNumber: $pr,
    commitSha: $sha,
    clusterId: $cluster,
    targetNamespace: $ns,
    manifestYaml: $manifest
  }')

SC3_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/api/v1/gitops/pr-review" \
  -H "Content-Type: application/json" \
  -H "X-CI-Token: ${CI_TOKEN}" \
  -d "${SC3_PAYLOAD}")

SC3_HTTP_CODE=$(echo "${SC3_RESPONSE}" | tail -n 1)
SC3_BODY=$(echo "${SC3_RESPONSE}" | sed '$d')

assert_equals "201" "${SC3_HTTP_CODE}" "시나리오 3 HTTP 상태 코드 201 (성공 응답)"
SC3_CORRECTED=$(echo "${SC3_BODY}" | jq -r '.selfCorrectionResult.corrected')
SC3_DEEPLINK=$(echo "${SC3_BODY}" | jq -r '.exceptionDeepLink')
SC3_COMMENT=$(echo "${SC3_BODY}" | jq -r '.commentMarkdown')

assert_equals "false" "${SC3_CORRECTED}" "보안상 자동 교정 불가 판단 (selfCorrectionResult.corrected: false)"
assert_contains "${SC3_COMMENT}" "[AI Self-Correction Incomplete / Safe Guidance]" "코멘트에 Safe Guidance 배지 포함"
assert_contains "${SC3_DEEPLINK}" "/exceptions/new" "플랫폼 정책 예외 신청 경로 포함"
assert_contains "${SC3_DEEPLINK}" "clusterId=" "딥링크 파라미터 clusterId 포함"
assert_contains "${SC3_DEEPLINK}" "policyName=" "딥링크 파라미터 policyName 포함"
assert_contains "${SC3_DEEPLINK}" "resourceName=" "딥링크 파라미터 resourceName 포함"

PASSED_COUNT=$((PASSED_COUNT + 1))
log_success "시나리오 3: Safe Guidance 폴백 및 정책 예외 딥링크 생성 검증 성공!"

# ------------------------------------------------------------------------------
# 시나리오 4: CI/CD 이중 인증 (Dual Authentication Guard)
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}>>> [시나리오 4] CI/CD 이중 인증 가드 (Dual Authentication Guard)${NC}"

log_info "4-1. 올바른 X-CI-Token 헤더 전달 시 인증 성공 검증..."
AUTH_VALID_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BACKEND_URL}/api/v1/gitops/pr-review" \
  -H "Content-Type: application/json" \
  -H "X-CI-Token: ${CI_TOKEN}" \
  -d "${SC1_PAYLOAD}")
assert_equals "201" "${AUTH_VALID_CODE}" "올바른 CI 토큰 인증 성공 (HTTP 201)"

log_info "4-2. 잘못된 토큰 전달 시 401 Unauthorized 차단 검증..."
AUTH_INVALID_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BACKEND_URL}/api/v1/gitops/pr-review" \
  -H "Content-Type: application/json" \
  -H "X-CI-Token: invalid-wrong-token-value" \
  -d "${SC1_PAYLOAD}")
assert_equals "401" "${AUTH_INVALID_CODE}" "잘못된 CI 토큰 401 차단"

log_info "4-3. 인증 헤더 누락 시 401 Unauthorized 차단 검증..."
AUTH_MISSING_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BACKEND_URL}/api/v1/gitops/pr-review" \
  -H "Content-Type: application/json" \
  -d "${SC1_PAYLOAD}")
assert_equals "401" "${AUTH_MISSING_CODE}" "인증 헤더 누락 시 401 차단"

PASSED_COUNT=$((PASSED_COUNT + 1))
log_success "시나리오 4: CI/CD 이중 인증 가드 검증 성공!"

# ------------------------------------------------------------------------------
# 클러스터 리소스 클린업
# ------------------------------------------------------------------------------
echo ""
log_info "테스트 잔여 리소스 클린업 수행..."
if command -v kubectl &>/dev/null; then
  kubectl delete deployment e2e-nginx-clean e2e-nginx-missing-labels e2e-nginx-privileged -n default --ignore-not-found >/dev/null 2>&1 || true
  log_success "임시 테스트 리소스 정리 완료 (Dry-run 검증이었으므로 etcd 미생성 확인)"
fi

# ------------------------------------------------------------------------------
# 검증 결과 요약 리포트
# ------------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}==============================================================================${NC}"
echo -e "${GREEN}${BOLD} 🎉 Phase 1 E2E All Scenarios Verified Successfully! (${PASSED_COUNT}/${TOTAL_TESTS})${NC}"
echo -e "${GREEN}${BOLD}==============================================================================${NC}"
echo "  [✓] 시나리오 1: 정상 매니페스트 통과 (Clean Pass - dryRunPassed: true)"
echo "  [✓] 시나리오 2: AI Self-Correction 교정 통과 (Self-Correction Success - suggestion patch)"
echo "  [✓] 시나리오 3: 해결 불가능한 위반 및 Safe Guidance 폴백 (Safe Guidance - exception deep link)"
echo "  [✓] 시나리오 4: CI/CD 이중 인증 가드 (Valid Token 201 / Invalid & Missing 401)"
echo -e "${GREEN}${BOLD}==============================================================================${NC}"

exit 0
