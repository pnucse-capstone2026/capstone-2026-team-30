#!/usr/bin/env bash
# ==============================================================================
# PaC Kyverno Governance Platform - Master Modular Components Test Runner
# ==============================================================================
# 도입 배경: 모듈형 컴포넌트 아키텍처(K8s, 백엔드, 프론트엔드, 배포 스크립트)의 전체 무결성을 원클릭으로 종합 검증
# 기대 효과: CI/CD 및 배포 전 회귀 버그 원천 차단 및 플랫폼 모듈화 품질 보증
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
NC="\033[0m"

log_step() { echo -e "\n${BOLD}${CYAN}======================================================================${NC}"; echo -e "${BOLD}${BLUE}  $*${NC}"; echo -e "${BOLD}${CYAN}======================================================================${NC}"; }

TOTAL_PHASES=4
PASSED_PHASES=0

# Step 1: K8s Manifest Modular Integrity Test
log_step "[Phase 1] K8s Manifest Modular Integrity Test"
if "${ROOT_DIR}/scripts/tests/test-k8s-modular-manifests.sh"; then
  PASSED_PHASES=$((PASSED_PHASES + 1))
else
  echo -e "${RED}✖ Phase 1 Failed${NC}" >&2
  exit 1
fi

# Step 2: Backend System Module & Dynamic Loading Jest Tests
log_step "[Phase 2] Backend SystemModule & Dynamic Module Loading Tests"
if (cd "${ROOT_DIR}/apps/backend" && pnpm test system); then
  PASSED_PHASES=$((PASSED_PHASES + 1))
else
  echo -e "${RED}✖ Phase 2 Failed${NC}" >&2
  exit 1
fi

# Step 3: Frontend Modular UX & Route Guard Tests
log_step "[Phase 3] Frontend Modular UX & Route Guard Tests"
if "${ROOT_DIR}/scripts/tests/test-frontend-modular-ux.sh"; then
  PASSED_PHASES=$((PASSED_PHASES + 1))
else
  echo -e "${RED}✖ Phase 3 Failed${NC}" >&2
  exit 1
fi

# Step 4: Deploy Script Modular Flags & Secret Injection Tests
log_step "[Phase 4] Deploy Script Modular Flags & Secret Injection Tests"
if "${ROOT_DIR}/scripts/tests/test-deploy-modular-flags.sh"; then
  PASSED_PHASES=$((PASSED_PHASES + 1))
else
  echo -e "${RED}✖ Phase 4 Failed${NC}" >&2
  exit 1
fi

# Final Summary
echo -e "\n${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}${GREEN}  🎉 All Modular Platform Component Tests Passed! (${PASSED_PHASES}/${TOTAL_PHASES} Phases)${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
exit 0
