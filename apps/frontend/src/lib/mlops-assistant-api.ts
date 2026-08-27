import { requestWithAuth } from "@/lib/api-client";

export type CopilotActionType =
  | "CREATE_NOTEBOOK"
  | "DEPLOY_SERVED_MODEL"
  | "RUN_PIPELINE"
  | "FINOPS_OPTIMIZE"
  | "GENERAL_CHAT";

export type CopilotProposedAction = {
  actionType: CopilotActionType;
  title: string;
  description: string;
  payload: Record<string, any>;
};

export type CopilotChatRequest = {
  message: string;
  context?: {
    page?: string;
    activeResource?: Record<string, any>;
  };
};

export type CopilotChatResponse = {
  replyText: string;
  intent: string;
  proposedAction?: CopilotProposedAction;
  recommendations?: string[];
  provider?: "BEDROCK" | "RULE_ENGINE_FALLBACK";
};

export type WorkloadResourceType =
  | "NOTEBOOK"
  | "PIPELINE_RUN"
  | "KSERVE_SERVICE";

export type DiagnoseWorkloadRequest = {
  resourceType: WorkloadResourceType;
  resourceName: string;
  namespace: string;
  podLogs?: string;
  k8sEvents?: string[];
};

export type RecommendedFix = {
  title: string;
  description: string;
  actionType?: string;
  payload?: Record<string, any>;
};

export type DiagnoseWorkloadResponse = {
  rootCause: string;
  summary: string;
  detailedDiagnosis: string;
  recommendedFixes: RecommendedFix[];
  detectedErrorCode?: string;
  provider?: "BEDROCK" | "RULE_ENGINE_FALLBACK";
};

/**
 * MLOps Copilot 대화 및 자연어 액션 생성을 백엔드에 요청합니다.
 *
 * @param payload 사용자 채팅 입력 및 페이지 컨텍스트
 * @returns Copilot 텍스트 응답 및 하이브리드 액션 제안 카드 데이터
 */
export async function sendCopilotMessage(
  payload: CopilotChatRequest,
): Promise<CopilotChatResponse> {
  return requestWithAuth<CopilotChatResponse>("/mlops/assistant/chat", {
    method: "POST",
    body: payload,
  });
}

/**
 * 실패한 MLOps 워크로드(노트북, 파이프라인 런, KServe)의 컨테이너 로그 및 K8s 이벤트를 분석 진단합니다.
 *
 * @param payload 워크로드 식별자 및 로그 데이터
 * @returns 원인 진단 보고서 및 원클릭 해결책
 */
export async function diagnoseWorkload(
  payload: DiagnoseWorkloadRequest,
): Promise<DiagnoseWorkloadResponse> {
  return requestWithAuth<DiagnoseWorkloadResponse>(
    "/mlops/assistant/diagnose",
    {
      method: "POST",
      body: payload,
    },
  );
}
