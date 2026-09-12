#!/usr/bin/env bash
# ==============================================================================
# Master Runner: Granular Bare-Minimum Kind Modular Test Suites
# ==============================================================================
# 도입 배경: 무거운 일체형 클러스터 대신, 각 모듈(Core, MLOps, Installer)별로
#           초경량 Kind 클러스터를 순차 생성/검증/회수하여 시스템 리소스 점유를 극소화
# 기대 효과: 최소 하드웨어 리소스로 모듈형 아키텍처의 완전한 K8s 실증 달성
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

TARGET_SUITE="all"

usage() {
  cat <<HELP
Usage: $(basename "$0") [OPTIONS]

Granular bare-minimum Kind test runner for modular platform components.
Executes lightweight isolated clusters sequentially to prevent resource contention.

Options:
  --core          Run only the Core Governance isolation test (bare-mod-core)
  --mlops         Run only the MLOps standalone module test (bare-mod-mlops)
  --installer     Run only the Live Deployer Secret/Toggle test (bare-mod-inst)
  --all           Run all modular Kind test suites sequentially [default]
  -h, --help      Show this help message
HELP
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core)      TARGET_SUITE="core"; shift ;;
    --mlops)     TARGET_SUITE="mlops"; shift ;;
    --installer) TARGET_SUITE="installer"; shift ;;
    --all)       TARGET_SUITE="all"; shift ;;
    -h|--help)   usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

run_core() {
  echo -e "\n${BOLD}${CYAN}>>> [Suite 1/3] Executing Bare-Minimum Core Isolation Test...${NC}"
  "${SCRIPT_DIR}/test-kind-modular-core.sh"
}

run_mlops() {
  echo -e "\n${BOLD}${CYAN}>>> [Suite 2/3] Executing Bare-Minimum MLOps Standalone Test...${NC}"
  "${SCRIPT_DIR}/test-kind-modular-mlops.sh"
}

run_installer() {
  echo -e "\n${BOLD}${CYAN}>>> [Suite 3/3] Executing Bare-Minimum Live Installer Test...${NC}"
  "${SCRIPT_DIR}/test-kind-modular-installer.sh"
}

case "${TARGET_SUITE}" in
  core)
    run_core
    ;;
  mlops)
    run_mlops
    ;;
  installer)
    run_installer
    ;;
  all)
    run_core
    run_mlops
    run_installer
    echo -e "\n${BOLD}${GREEN}======================================================================${NC}"
    echo -e "${BOLD}${GREEN}  🎉 All Granular Bare-Minimum Kind Suites Completed Successfully!${NC}"
    echo -e "${BOLD}${GREEN}======================================================================${NC}"
    ;;
esac
