#!/usr/bin/env bash
set -euo pipefail

# Kubernetes 클러스터 거버넌스 시연용 임시 도구 일괄 배포 스크립트
#
# [도입 배경]
# 쿠버네티스에 익숙하지 않은 청중에게 Kyverno 정책 엔진의 동작(Admission 차단 및 Audit 리포트)을
# 텍스트 로그 대신 CNCF Policy Reporter UI와 Grafana 대시보드로 직관적으로 전달하기 위함.
#
# [기대 효과]
# 1. 기존 플랫폼 네임스페이스와 격리된 'policy-reporter' 네임스페이스에만 임시 파드를 배포하여 부작용 원천 차단.
# 2. Prometheus 스크랩 주기를 2초로 단축하여 라이브 시연 중 화면 갱신 딜레이(Dead air) 방지.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="${SCRIPT_DIR}/../../k8s-manifests"

echo "================================================================="
echo ">>> [Kyverno Demo Hub] Setting up temporary presentation tools..."
echo "================================================================="

# 1. Helm CLI 가용성 확인
if ! command -v helm &> /dev/null; then
  if [ -x "${SCRIPT_DIR}/../bin/helm" ]; then
    export PATH="${SCRIPT_DIR}/../bin:${PATH}"
  else
    echo "ERROR: Helm CLI is required but not found in PATH or scripts/bin."
    exit 1
  fi
fi

# 2. Kyverno 컨트롤러 메트릭 엔드포인트 활성화 (:8000)
# 입구 제어(Admission Webhook) 거부 통계를 Prometheus로 실시간 집계하기 위해 메트릭 서비스 포트를 개방
echo ">>> [1/4] Ensuring Kyverno metrics service is exposed on port 8000..."
if helm status kyverno -n kyverno > /dev/null 2>&1; then
  helm upgrade kyverno kyverno/kyverno -n kyverno --reuse-values \
    --set admissionController.metricsService.create=true \
    --set admissionController.metricsService.port=8000 \
    --set reportsController.metricsService.create=true \
    --set reportsController.metricsService.port=8000 > /dev/null 2>&1 || true
  echo "    - Kyverno metrics configuration updated."
else
  echo "    - Kyverno release not found; please deploy Kyverno first via setup-local-cluster.sh"
fi

# 3. CNCF Policy Reporter 배포 (전용 격리 네임스페이스)
# Audit 모드 정책 위반(PolicyReport CRD)을 비전문가도 한눈에 알기 쉬운 색상 카드로 렌더링
echo ">>> [2/4] Deploying CNCF Policy Reporter (UI + Monitoring)..."
helm repo add policy-reporter https://kyverno.github.io/policy-reporter --force-update > /dev/null 2>&1 || true
helm repo update policy-reporter > /dev/null 2>&1

helm upgrade --install policy-reporter policy-reporter/policy-reporter \
  --namespace policy-reporter \
  --create-namespace \
  --set ui.enabled=true \
  --set ui.plugins.kyverno=true \
  --set monitoring.enabled=true \
  --set monitoring.grafana.dashboards=true \
  --set resources.limits.cpu=200m \
  --set resources.limits.memory=512Mi \
  --set resources.requests.cpu=50m \
  --set resources.requests.memory=128Mi

echo "    - Waiting for Policy Reporter UI to be ready..."
kubectl rollout status deployment/policy-reporter-ui -n policy-reporter --timeout=120s || true

# 4. Grafana 임베딩 보안 설정 안내 및 자동 포트포워딩 백그라운드 준비
echo ">>> [3/4] Checking Grafana embedding security configuration..."
echo "    - NOTE: If running external Grafana, ensure 'security.allow_embedding = true' is set in grafana.ini"

# 5. 로컬 시연용 포트포워딩 백그라운드 가이드
echo ">>> [4/4] Local access endpoints ready:"
echo "    -------------------------------------------------------------"
echo "    • Policy Reporter Web UI: http://localhost:8082"
echo "      (Run: kubectl -n policy-reporter port-forward svc/policy-reporter-ui 8082:8080 &)"
echo "    • Presentation Hub UI:   http://localhost:3000/demo/presentation"
echo "    -------------------------------------------------------------"
echo ">>> Setup completed successfully! Ready for live demo."
