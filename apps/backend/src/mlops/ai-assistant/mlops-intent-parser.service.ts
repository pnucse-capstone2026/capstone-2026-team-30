import { Injectable, Logger } from "@nestjs/common";
import { ProposedAction } from "./dto/copilot-chat.dto";

/**
 * LLM 응답 및 자연어 질의로부터 구조화된 MLOps 동작(Intent & DTO)을 파싱하는 서비스
 */
@Injectable()
export class MlopsIntentParserService {
  private readonly logger = new Logger(MlopsIntentParserService.name);

  /**
   * LLM이 출력한 JSON 문자열 또는 텍스트 블록에서 JSON 데이터를 안전하게 정제/파싱합니다.
   *
   * @param rawText LLM 모델이 반환한 원본 텍스트
   * @returns 파싱된 객체 또는 null
   */
  parseJsonFromLlmOutput<T = unknown>(rawText: string): T | null {
    try {
      // ```json ... ``` 코드 블록 처리
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const textToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      return JSON.parse(textToParse) as T;
    } catch (error) {
      // JSON 파싱 실패 시 예외 로깅 후 null 반환
      this.logger.warn(
        `Failed to parse JSON from LLM output: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 추출된 의도(Intent)와 파라미터를 기반으로 백엔드 API 호환 ProposedAction 객체를 빌드합니다.
   *
   * @param intent 파싱된 Intent 키워드
   * @param params 추출된 매개변수 맵
   * @returns ProposedAction 구조체 또는 undefined
   */
  buildProposedAction(
    intent: string,
    params: Record<string, unknown>,
  ): ProposedAction | undefined {
    switch (intent) {
      case "CREATE_NOTEBOOK": {
        const name =
          params.name || `notebook-${Date.now().toString(36).slice(-4)}`;
        const hardwareTier =
          params.hardwareTier ||
          (params.gpu ? "GPU_T4_STANDARD" : "CPU_MEDIUM");
        const frameworkImage = params.frameworkImage || "JUPYTER_PYTORCH";
        const clusterId = params.clusterId || "cluster-us-east-1a";

        return {
          actionType: "CREATE_NOTEBOOK",
          title: "🚀 Notebook 인스턴스 생성",
          description: `노트북 [${name}] (${hardwareTier}, ${frameworkImage}) 생성 카드`,
          payload: {
            name,
            namespace: params.namespace || "default",
            clusterId,
            hardwareTier,
            frameworkImage,
            storageGb: params.storageGb || 20,
          },
        };
      }

      case "DEPLOY_SERVED_MODEL": {
        const name =
          params.name || `model-serving-${Date.now().toString(36).slice(-4)}`;
        return {
          actionType: "DEPLOY_SERVED_MODEL",
          title: "📦 KServe 모델 서빙 배포",
          description: `모델 [${name}] 배포 프리셋 (프레임워크: ${params.framework || "PYTORCH"})`,
          payload: {
            name,
            namespace: params.namespace || "default",
            clusterId: params.clusterId || "cluster-us-east-1a",
            framework: params.framework || "PYTORCH",
            storageUri: params.storageUri || "s3://mlops-models/v1",
            minReplicas: params.minReplicas || 1,
            maxReplicas: params.maxReplicas || 3,
            cpuRequest: params.cpuRequest || "2",
            memoryRequest: params.memoryRequest || "4Gi",
            gpuCount: params.gpuCount || (params.gpu ? 1 : 0),
          },
        };
      }

      case "RUN_PIPELINE": {
        return {
          actionType: "RUN_PIPELINE",
          title: "🔄 KFP 파이프라인 전계 실행",
          description: `파이프라인 [${params.pipelineId || "training-pipeline"}] 실행 설정`,
          payload: {
            pipelineId: params.pipelineId || "pipeline-default-01",
            runName:
              params.runName || `run-${Date.now().toString(36).slice(-4)}`,
            namespace: params.namespace || "default",
            parameters: params.parameters || { batch_size: 32, epochs: 10 },
          },
        };
      }

      case "FINOPS_OPTIMIZE": {
        return {
          actionType: "FINOPS_OPTIMIZE",
          title: "💰 FinOps 리소스 최적화",
          description: `GPU/Memory 다운그레이드 조치 적용`,
          payload: {
            resourceName: params.resourceName,
            namespace: params.namespace || "default",
            recommendedTier: params.recommendedTier || "CPU_MEDIUM",
          },
        };
      }

      default:
        return undefined;
    }
  }
}
