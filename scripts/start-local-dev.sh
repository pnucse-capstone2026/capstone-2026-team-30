#!/bin/bash
# ==============================================================================
# Kyverno Governance Platform - 로컬 인터랙티브 UI & 풀스택 테스트 환경 기동 스크립트
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PATH="$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/lib:$LD_LIBRARY_PATH"

LOG_DIR="${ROOT_DIR}/logs"
mkdir -p "${LOG_DIR}"

echo "=============================================================================="
echo " 🚀 Kyverno Governance Platform - Local Full-Stack Environment"
echo "=============================================================================="

# 1. PostgreSQL 기동 확인
echo ">>> [1/4] Checking & starting PostgreSQL 16..."
if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
  pg_ctl -D "${HOME}/.local/pgsql/data" -l "${HOME}/.local/pgsql/logfile" start || true
  sleep 2
fi
if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
  echo "    ✓ PostgreSQL is running on port 5432 (database: kyverno_dashboard)"
else
  echo "    ⚠️ Warning: PostgreSQL failed to start. Check ~/.local/pgsql/logfile"
fi

# 2. Redis 기동 확인
echo ">>> [2/4] Checking & starting Redis..."
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes || true
  sleep 1
fi
if redis-cli ping >/dev/null 2>&1; then
  echo "    ✓ Redis is running on port 6379"
else
  echo "    ⚠️ Warning: Redis is not responding."
fi

# 3. 백엔드 API 서버 기동 (Port: 3001)
echo ">>> [3/4] Starting NestJS Backend Server (Port: 3001)..."
if lsof -ti:3001 >/dev/null 2>&1 || fuser 3001/tcp >/dev/null 2>&1; then
  echo "    ℹ️ Backend port 3001 is already in use. Skipping start."
else
  (cd "${ROOT_DIR}/apps/backend" && nohup node dist/main.js > "${LOG_DIR}/backend.log" 2>&1 & echo $! > "${LOG_DIR}/backend.pid")
  BACKEND_PID=$(cat "${LOG_DIR}/backend.pid")
  echo "    ✓ Backend launched with PID: ${BACKEND_PID} (logs: logs/backend.log)"
fi

# 백엔드 준비 대기
echo "    Waiting for Backend health check..."
for i in {1..15}; do
  if curl -s http://127.0.0.1:3001/api/health | grep -q '"status":"ok"'; then
    echo "    ✓ Backend API is healthy and ready!"
    break
  fi
  sleep 1
done

# 4. 프론트엔드 웹 대시보드 기동 (Port: 3000)
echo ">>> [4/4] Starting Next.js Frontend Web Server (Port: 3000)..."
if lsof -ti:3000 >/dev/null 2>&1 || fuser 3000/tcp >/dev/null 2>&1; then
  echo "    ℹ️ Frontend port 3000 is already in use. Skipping start."
else
  (cd "${ROOT_DIR}/apps/frontend" && nohup pnpm start > "${LOG_DIR}/frontend.log" 2>&1 & echo $! > "${LOG_DIR}/frontend.pid")
  FRONTEND_PID=$(cat "${LOG_DIR}/frontend.pid")
  echo "    ✓ Frontend launched with PID: ${FRONTEND_PID} (logs: logs/frontend.log)"
fi

# 프론트엔드 준비 대기
for i in {1..10}; do
  if curl -s -I http://127.0.0.1:3000/ | grep -q '200 OK'; then
    echo "    ✓ Frontend Dashboard is ready!"
    break
  fi
  sleep 1
done

echo "=============================================================================="
echo " 🎉 Local Interactive UI Environment is Ready!"
echo "=============================================================================="
echo " 🌐 Frontend Dashboard : http://localhost:3000"
echo " 📡 Backend API Docs   : http://localhost:3001/api/docs"
echo " 🩺 Health Check       : http://localhost:3001/api/health"
echo "------------------------------------------------------------------------------"
echo " 🔑 Default Accounts for Testing:"
echo "    - Admin User : admin@test.com  (Password: test1234!)"
echo "    - General    : user@test.com   (Password: test1234!)"
echo "------------------------------------------------------------------------------"
echo " 🛑 To stop all servers, run: bash scripts/stop-local-dev.sh"
echo "=============================================================================="
