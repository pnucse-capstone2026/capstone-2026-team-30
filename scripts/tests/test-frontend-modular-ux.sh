#!/usr/bin/env bash
# ==============================================================================
# PaC Kyverno Governance Platform - Frontend Modular UX Integrity Test
# ==============================================================================
# 도입 배경: 프론트엔드 컴포넌트의 동적 모듈 제어 및 라우트 보호 무결성을 자동 검증
# 기대 효과: 비활성화 모듈의 사이드바 은닉 및 직접 URL 진입 차단 가드 안정성 보장
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

PASSED_COUNT=0
FAILED_COUNT=0

log_header() { echo -e "\n${BOLD}${BLUE}=== $* ===${NC}"; }

assert_true() {
  local desc="$1"
  local condition="$2"
  if eval "${condition}"; then
    echo -e "  ${GREEN}✔ [PASS]${NC} ${desc}"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo -e "  ${RED}✖ [FAIL]${NC} ${desc}" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

echo -e "${BOLD}Starting Frontend Modular UX Integrity Test Suite...${NC}"

# ------------------------------------------------------------------------------
# Test 1: System Modules Client Store Specification
# ------------------------------------------------------------------------------
log_header "Test 1: System Modules Store Specification"

STORE_FILE="${ROOT_DIR}/apps/frontend/src/lib/system-modules.ts"
assert_true "system-modules.ts exists" "[ -f \"${STORE_FILE}\" ]"
assert_true "Exports PlatformModuleId type" "grep -q 'export type PlatformModuleId' \"${STORE_FILE}\""
assert_true "Defines DEFAULT_MODULES fallback" "grep -q 'DEFAULT_MODULES' \"${STORE_FILE}\""
assert_true "Implements isModuleEnabled helper" "grep -q 'isModuleEnabled:' \"${STORE_FILE}\""
assert_true "Exports useSystemModules hook" "grep -q 'export function useSystemModules' \"${STORE_FILE}\""

# ------------------------------------------------------------------------------
# Test 2: Sidebar Navigation Dynamic Filtering
# ------------------------------------------------------------------------------
log_header "Test 2: Sidebar Navigation Dynamic Filtering"

SIDEBAR_FILE="${ROOT_DIR}/apps/frontend/src/components/dashboard/dashboard-sidebar.tsx"
assert_true "dashboard-sidebar.tsx exists" "[ -f \"${SIDEBAR_FILE}\" ]"
assert_true "Imports useSystemModules hook" "grep -q 'useSystemModules' \"${SIDEBAR_FILE}\""
assert_true "MLOps navigation items tagged with moduleId" "grep -q 'moduleId: \"mlops\"' \"${SIDEBAR_FILE}\""
assert_true "Simulation navigation items tagged with moduleId" "grep -q 'moduleId: \"simulation\"' \"${SIDEBAR_FILE}\""
assert_true "AI Agent navigation items tagged with moduleId" "grep -q 'moduleId: \"aiAgent\"' \"${SIDEBAR_FILE}\""
assert_true "Filters out disabled modules dynamically" "grep -q '!isModuleEnabled(item.moduleId)' \"${SIDEBAR_FILE}\""

# ------------------------------------------------------------------------------
# Test 3: Module Disabled Notice Component
# ------------------------------------------------------------------------------
log_header "Test 3: Module Disabled Notice Component"

NOTICE_FILE="${ROOT_DIR}/apps/frontend/src/components/ui/module-disabled-notice.tsx"
assert_true "module-disabled-notice.tsx exists" "[ -f \"${NOTICE_FILE}\" ]"
assert_true "Provides environment variable guidance" "grep -q 'MODULE_ENV_VARS' \"${NOTICE_FILE}\""
assert_true "Contains return to dashboard navigation" "grep -q '대시보드로 돌아가기' \"${NOTICE_FILE}\""

# ------------------------------------------------------------------------------
# Test 4: MLOps Route Guard Layout
# ------------------------------------------------------------------------------
log_header "Test 4: MLOps Route Guard Layout"

MLOPS_LAYOUT="${ROOT_DIR}/apps/frontend/src/app/mlops/layout.tsx"
assert_true "mlops/layout.tsx exists" "[ -f \"${MLOPS_LAYOUT}\" ]"
assert_true "Verifies MLOps module enablement" "grep -q 'isModuleEnabled(\"mlops\")' \"${MLOPS_LAYOUT}\""
assert_true "Renders ModuleDisabledNotice when disabled" "grep -q '<ModuleDisabledNotice' \"${MLOPS_LAYOUT}\""

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo -e "\n=========================================="
echo -e "Test Summary: ${GREEN}${PASSED_COUNT} Passed${NC}, ${RED}${FAILED_COUNT} Failed${NC}"
echo -e "=========================================="

if [ "${FAILED_COUNT}" -gt 0 ]; then
  exit 1
fi
exit 0
