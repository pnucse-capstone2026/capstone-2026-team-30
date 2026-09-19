import { requestWithAuth } from "@/lib/api-client";

export type ExplainKyvernoErrorRequest = {
  errorMessage?: string;
  policyYaml?: string;
  resourceManifest?: string;
  clusterContext?: string;
  clusterId?: string;
  namespace?: string;
};

export type ExplainKyvernoErrorResponse = {
  summary: string;
  governanceRationale: string;
  resolutionSteps: string[];
  suggestedFixYaml: string | null;
  policySnippet?: string | null;
  isCompliant?: boolean;
  status?: "COMPLIANT" | "BLOCKED" | "ERROR";
  passedRules?: string[];
  violations?: Array<{
    policyName: string;
    ruleName?: string;
    reason: string;
    path?: string;
  }>;
  provider?: string;
  latencyMs?: number;
};

/**
 * AI 에이전트 기반 Kyverno 정책 차단 오류 분석 및 해결 가이드를 요청합니다.
 *
 * @param payload 에러 메시지, 정책 YAML, 리소스 매니페스트, 클러스터 컨텍스트
 * @returns AI 분석 결과 (원인 요약, 거버넌스 배경, 해결 단계, 수정 매니페스트)
 */
export async function explainKyvernoError(
  payload: ExplainKyvernoErrorRequest,
): Promise<ExplainKyvernoErrorResponse> {
  return requestWithAuth<ExplainKyvernoErrorResponse>(
    "/ai-agent/explain-kyverno-error",
    {
      method: "POST",
      body: payload,
    },
  );
}
