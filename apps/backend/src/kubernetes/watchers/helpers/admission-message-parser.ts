/**
 * 주어진 메시지와 Event Reason이 Kyverno Admission Webhook 차단인지 판별합니다.
 */
export function isKyvernoAdmissionDenial(
  message: string,
  reason?: string,
): boolean {
  const lowerMsg = message.toLowerCase();

  if (reason === "AdmissionWebhookDenied") {
    return true;
  }

  const hasWebhookDenial =
    lowerMsg.includes("denied the request") ||
    lowerMsg.includes("admission webhook") ||
    lowerMsg.includes("webhook denied");

  const hasKyvernoIndication =
    lowerMsg.includes("kyverno") ||
    lowerMsg.includes("validate.kyverno.svc") ||
    lowerMsg.includes("blocked due to the following policies");

  return hasWebhookDenial && hasKyvernoIndication;
}

/**
 * Kyverno Admission Webhook 오류 원문에서 정책명, 규칙명 및 정제된 사유를 파싱합니다.
 */
export function parseAdmissionBlockMessage(rawMessage: string): {
  policyName: string;
  ruleName?: string;
  cleanReason: string;
} {
  let policyName = "unknown-policy";
  let ruleName: string | undefined;

  // 패턴 1: [policy-name] 또는 [policy-name/rule-name] 형태 (예: [disallow-privileged-containers/check-privileged])
  const bracketMatch = rawMessage.match(
    /\[([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?\]/,
  );
  if (bracketMatch) {
    policyName = bracketMatch[1];
    if (bracketMatch[2]) {
      ruleName = bracketMatch[2];
    }
  } else {
    // 패턴 2: blocked due to the following policies\n\npolicy-name:\n  rule-name:
    const blockedPoliciesMatch = rawMessage.match(
      /(?:policies|policy):?\s*\n+([a-zA-Z0-9_-]+):(?:\s*\n+\s*([a-zA-Z0-9_-]+):)?/,
    );
    if (blockedPoliciesMatch) {
      policyName = blockedPoliciesMatch[1];
      if (blockedPoliciesMatch[2]) {
        ruleName = blockedPoliciesMatch[2];
      }
    }
  }

  // 정제된 사유 추출 (프리픽스 분리)
  let cleanReason = rawMessage;
  const prefixIndex = rawMessage.indexOf("denied the request:");
  if (prefixIndex !== -1) {
    cleanReason = rawMessage
      .substring(prefixIndex + "denied the request:".length)
      .trim();
  }

  return {
    policyName,
    ruleName,
    cleanReason,
  };
}
