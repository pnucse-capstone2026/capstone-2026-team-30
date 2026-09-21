#!/bin/bash
# ==============================================================================
# Kyverno Governance Platform - 로컬 테스트 환경 종료 스크립트
# ==============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PATH="$HOME/.local/bin:$PATH"
LOG_DIR="${ROOT_DIR}/logs"

echo ">>> Stopping Backend and Frontend servers..."

# PID 파일 기준 종료
if [ -f "${LOG_DIR}/backend.pid" ]; then
  BACKEND_PID=$(cat "${LOG_DIR}/backend.pid")
  kill "${BACKEND_PID}" 2>/dev/null || true
  rm -f "${LOG_DIR}/backend.pid"
fi

if [ -f "${LOG_DIR}/frontend.pid" ]; then
  FRONTEND_PID=$(cat "${LOG_DIR}/frontend.pid")
  kill "${FRONTEND_PID}" 2>/dev/null || true
  rm -f "${LOG_DIR}/frontend.pid"
fi

# 포트 기준 안전 종료
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true

echo ">>> Stopping Redis..."
redis-cli shutdown 2>/dev/null || true

echo ">>> Stopping PostgreSQL..."
pg_ctl -D "${HOME}/.local/pgsql/data" stop -m fast 2>/dev/null || true

echo "✓ All local test servers and databases have been stopped."
