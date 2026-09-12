import { requestWithAuth } from "@/lib/api-client";

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
