#!/usr/bin/env bash
# ==============================================================================
# Kyverno Governance Platform - Test Execution & Logging Runner
# ==============================================================================
# 테스트 실행 결과를 타임스탬프 기반의 로그 파일과 최신 요약 파일로 자동 기록합니다.
# 사용법:
#   bash scripts/run-tests-with-log.sh [backend|integration|all] [extra-jest-args]
# ==============================================================================

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS_DIR="${PROJECT_ROOT}/logs/test-reports"
mkdir -p "${LOGS_DIR}"

TARGET="${1:-backend}"
shift || true
EXTRA_ARGS="$*"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
LOG_FILE="${LOGS_DIR}/test-${TARGET}-${TIMESTAMP}.log"
LATEST_LOG_FILE="${LOGS_DIR}/test-latest.log"
SUMMARY_FILE="${LOGS_DIR}/test-summary.md"

GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
NODE_VERSION="$(node -v 2>/dev/null || echo "unknown")"

echo "=============================================================================="
echo " 🧪 Kyverno Governance Platform - Test Suite Runner"
echo "=============================================================================="
echo " 📅 Date        : $(date '+%Y-%m-%d %H:%M:%S')"
echo " 🌿 Git Branch  : ${GIT_BRANCH} (${GIT_COMMIT})"
echo " 📦 Target      : ${TARGET}"
echo " 📂 Log File    : ${LOG_FILE}"
echo "=============================================================================="

# 로그 헤더 작성
{
  echo "=============================================================================="
  echo " Kyverno Governance Platform Test Execution Log"
  echo " Date        : $(date '+%Y-%m-%d %H:%M:%S')"
  echo " Git Branch  : ${GIT_BRANCH} (${GIT_COMMIT})"
  echo " Node.js     : ${NODE_VERSION}"
  echo " Target      : ${TARGET}"
  echo " Extra Args  : ${EXTRA_ARGS}"
  echo "=============================================================================="
  echo ""
} > "${LOG_FILE}"

START_TIME=$(date +%s)

# 대상별 테스트 실행
case "${TARGET}" in
  backend)
    echo "▶ Running backend unit tests (Jest)..."
    (cd "${PROJECT_ROOT}/apps/backend" && pnpm jest --forceExit ${EXTRA_ARGS} 2>&1) | tee -a "${LOG_FILE}"
    TEST_EXIT_CODE=${PIPESTATUS[0]}
    ;;
  integration)
    echo "▶ Running backend integration tests (Jest)..."
    (cd "${PROJECT_ROOT}/apps/backend" && pnpm jest --config ./test/jest-integration.json --forceExit ${EXTRA_ARGS} 2>&1) | tee -a "${LOG_FILE}"
    TEST_EXIT_CODE=${PIPESTATUS[0]}
    ;;
  all)
    echo "▶ Running all monorepo test suites..."
    (cd "${PROJECT_ROOT}" && pnpm test ${EXTRA_ARGS} 2>&1) | tee -a "${LOG_FILE}"
    TEST_EXIT_CODE=${PIPESTATUS[0]}
    ;;
  *)
    echo "▶ Running custom target: ${TARGET}..."
    (cd "${PROJECT_ROOT}/apps/backend" && pnpm jest --testPathPattern="${TARGET}" --forceExit ${EXTRA_ARGS} 2>&1) | tee -a "${LOG_FILE}"
    TEST_EXIT_CODE=${PIPESTATUS[0]}
    ;;
esac

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 최신 로그 파일 링크 갱신
cp "${LOG_FILE}" "${LATEST_LOG_FILE}"

# Markdown 요약 리포트 생성
{
  echo "# 🧪 Test Execution Report"
  echo ""
  echo "- **Timestamp**: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "- **Branch**: \`${GIT_BRANCH}\` (\`${GIT_COMMIT}\`)"
  echo "- **Target**: \`${TARGET}\`"
  echo "- **Duration**: \`${DURATION}s\`"
  echo "- **Status**: $([ ${TEST_EXIT_CODE} -eq 0 ] && echo "✅ **PASSED**" || echo "❌ **FAILED**")"
  echo "- **Log Path**: \`${LOG_FILE}\`"
  echo ""
  echo "## Summary Output"
  echo "\`\`\`text"
  tail -n 25 "${LOG_FILE}" | sed -E 's/\x1B\[[0-9;]*[a-zA-Z]//g'
  echo "\`\`\`"
} > "${SUMMARY_FILE}"

echo ""
echo "=============================================================================="
if [ ${TEST_EXIT_CODE} -eq 0 ]; then
  echo " ✅ [SUCCESS] All test suites passed in ${DURATION}s."
else
  echo " ❌ [FAILURE] Test execution failed with exit code ${TEST_EXIT_CODE} in ${DURATION}s."
fi
echo " 📄 Full log saved to    : ${LOG_FILE}"
echo " 📄 Latest log link      : ${LATEST_LOG_FILE}"
echo " 📊 Markdown summary at  : ${SUMMARY_FILE}"
echo "=============================================================================="

exit ${TEST_EXIT_CODE}
