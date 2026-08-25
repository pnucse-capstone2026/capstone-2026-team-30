#!/bin/bash
# AWS SES 기반 Cron 작업 결과 이메일 자동 발송 스크립트 (JSON 템플릿 사용으로 특수문자 및 따옴표 완전 이스케이프)
set -e

SUBJECT="${1:-[Kyverno Governance Platform] Cron Task Report}"
LOG_FILE="${2:-/var/log/kyverno-cron-morning.log}"
RECIPIENT_EMAIL="${3:-yeongrimgo1106@pusan.ac.kr}"
REGION="us-east-1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${SCRIPT_DIR}/bin:${PATH}"

if [ -f "${LOG_FILE}" ]; then
  LOG_TAIL=$(tail -n 35 "${LOG_FILE}" 2>/dev/null || echo "로그 추출 실패.")
else
  LOG_TAIL="로그 파일을 찾을 수 없습니다: ${LOG_FILE}"
fi

# kubectl Ingress 조회를 통한 ALB 퍼블릭 URL 최신 수집
ALB_DNS=$(kubectl get ingress kyverno-ingress -n kyverno-platform -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
if [ -n "${ALB_DNS}" ]; then
  ALB_URL="http://${ALB_DNS}/"
else
  # 수동 파싱 시도
  ALB_URL=$(grep "ALB Public Endpoint" "${LOG_FILE}" 2>/dev/null | tail -n 1 | awk '{print $NF}' || echo "")
  if [ -z "${ALB_URL}" ]; then
    ALB_URL="http://k8s-kyvernop-kyvernoi-1e2776ba36-2008920023.us-east-1.elb.amazonaws.com/"
  fi
fi

CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S KST')

BODY_TEXT="============================================================
🚀 [Kyverno Governance Platform] Cron 스케줄러 실행 리포트
============================================================
📌 작업 명칭 : ${SUBJECT}
⏰ 실행 시각 : ${CURRENT_TIME}

✨ [핵심 대시보드 진입점]
접속 URL : ${ALB_URL}

------------------------------------------------------------
💡 포트포워딩 없이 위 접속 URL로 대시보드 UI 및 백엔드 API에 즉시 진입할 수 있습니다.
💡 백엔드/프론트엔드 통합 라우팅: ${ALB_URL}

============================================================
📋 최근 실행 상세 로그 (최종 35줄):
------------------------------------------------------------
${LOG_TAIL}
============================================================
"

TMP_JSON=$(mktemp)
jq -n \
  --arg subj "${SUBJECT}" \
  --arg body "${BODY_TEXT}" \
  '{
    Subject: { Data: $subj, Charset: "UTF-8" },
    Body: { Text: { Data: $body, Charset: "UTF-8" } }
  }' > "${TMP_JSON}"

aws ses send-email \
  --from "${RECIPIENT_EMAIL}" \
  --destination "ToAddresses=${RECIPIENT_EMAIL}" \
  --message "file://${TMP_JSON}" \
  --region "${REGION}"

rm -f "${TMP_JSON}"
echo "[SUCCESS] Notification Email sent successfully to ${RECIPIENT_EMAIL}"
