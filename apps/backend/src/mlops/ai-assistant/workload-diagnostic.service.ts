import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  LLM_PROVIDER_TOKEN,
  LlmProvider,
} from "../../ai-agent/providers/llm-provider.interface";
import { MlopsIntentParserService } from "./mlops-intent-parser.service";
import {
  DiagnoseWorkloadRequestDto,
  DiagnoseWorkloadResponseDto,
} from "./dto/diagnose-workload.dto";

/**
 * MLOps 워크로드(Notebook/Pipeline Run/KServe) 실패 컨테이너 로그 및 이벤트를 수집/분석하는 진단 서비스입니다.
 */
@Injectable()
export class WorkloadDiagnosticService {
  private readonly logger = new Logger(WorkloadDiagnosticService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly llmProvider: LlmProvider,
    private readonly intentParserService: MlopsIntentParserService,
  ) {}

  /**
   * 워크로드 실패 원인을 분석하고 근본 원인(Root Cause) 및 권장 해결 대책을 생성합니다.
   *
   * @param dto 실패한 워크로드 식별자, Pod 로그 및 K8s 이벤트
   * @returns 진단 보고서 DTO
   */
  async diagnoseWorkload(
    dto: DiagnoseWorkloadRequestDto,
  ): Promise<DiagnoseWorkloadResponseDto> {
    const logs = dto.podLogs || "";
    const events = (dto.k8sEvents || []).join("\n");

    // 에러 패턴 사전 분석
    const isCudaOom =
      logs.includes("CUDA out of memory") ||
      logs.includes("torch.OutOfMemoryError") ||
      logs.includes("OOMKilled");
    const isExit137 = logs.includes("137") || events.includes("OOMKilled");
    const isDriverMismatch =
      logs.includes("CUDA driver version is insufficient") ||
      logs.includes("driver/library version mismatch");

    const systemPrompt = `You are a Senior Kubernetes MLOps Debugging Expert.
Analyze the container logs and Kubernetes events for the failed ${dto.resourceType} workload named '${dto.resourceName}'.

Identify CUDA OOM (Out Of Memory), Pod OOMKilled (Exit code 137), Driver mismatches, image pull errors, or code exceptions.

Respond strictly with a JSON object in Korean:
{
  "rootCause": "Short title of root cause in Korean (e.g. CUDA Out-Of-Memory VRAM 초과)",
  "summary": "1-2 sentence summary of what went wrong",
  "detailedDiagnosis": "Detailed technical analysis explaining why it failed",
  "detectedErrorCode": "CUDA_OOM | OOM_KILLED | DRIVER_MISMATCH | POD_CRASH_LOOP | UNKNOWN",
  "recommendedFixes": [
    {
      "title": "Short title of fix",
      "description": "How to resolve this issue",
      "actionType": "UPGRADE_GPU_TIER | REDUCE_BATCH_SIZE | INCREASE_MEMORY_LIMIT",
      "payload": { "gpu": 2, "recommendedBatchSize": 16 }
    }
  ]
}`;

    const userPrompt = `Workload Type: ${dto.resourceType}
Resource Name: ${dto.resourceName}
Namespace: ${dto.namespace}

=== Container Logs ===
${logs.slice(-3000)}

=== K8s Events ===
${events}`;

    try {
      // 대안 1-A 적용: 진단 시 긴 로그 대응을 위해 maxTokens: 3072, temperature: 0.1 설정
      const rawResponse = await this.llmProvider.chatCompletion(
        systemPrompt,
        userPrompt,
        {
          maxTokens: 3072,
          temperature: 0.1,
        },
      );

      const parsed =
        this.intentParserService.parseJsonFromLlmOutput<DiagnoseWorkloadResponseDto>(
          rawResponse,
        );

      if (parsed && parsed.rootCause && parsed.summary) {
        return {
          ...parsed,
          provider: this.llmProvider.providerId,
        };
      }
    } catch (error) {
      // LLM 연동 실패 시 로깅 후 규칙 기반 진단 엔진으로 전환
      this.logger.warn(
        `WorkloadDiagnosticService LLM provider (${this.llmProvider.providerId}) invocation failed, switching to rule engine: ${(error as Error).message}`,
      );
    }

    // Fallback 규칙 진단 엔진
    return this.buildFallbackDiagnosis(
      dto,
      isCudaOom,
      isExit137,
      isDriverMismatch,
    );
  }

  /**
   * 규칙 기반 워크로드 실패 진단 폴백 엔진입니다.
   *
   * @param dto 워크로드 정보
   * @param isCudaOom CUDA OOM 여부
   * @param isExit137 Exit 137 OOMKilled 여부
   * @param isDriverMismatch 드라이버 불일치 여부
   * @returns 규칙 기반 진단 보고서
   */
  private buildFallbackDiagnosis(
    dto: DiagnoseWorkloadRequestDto,
    isCudaOom: boolean,
    isExit137: boolean,
    isDriverMismatch: boolean,
  ): DiagnoseWorkloadResponseDto {
    if (isCudaOom || isExit137) {
      return {
        rootCause: "CUDA Out-Of-Memory 및 RAM 메모리 초과 (Exit Code 137)",
        summary: `${dto.resourceType} [${dto.resourceName}] 워크로드가 그래픽 메모리(VRAM) 또는 시스템 메모리 한계를 초과하여 K8s OOMKiller에 의해 종료되었습니다.`,
        detailedDiagnosis:
          "PyTorch / TensorFlow 텐서 할당 중 이용 가능한 GPU VRAM 수용량을 넘어서는 텐서 연산이 발생했습니다. 데이터 로더의 배치 크기(batch_size)가 지나치게 크거나 모델 가중치에 필요한 VRAM 규격이 부족합니다.",
        detectedErrorCode: "CUDA_OOM",
        recommendedFixes: [
          {
            title: "PyTorch 학습 배치 크기 다운그레이드",
            description:
              "데이터 로더의 batch_size를 절반(예: 64 -> 32)으로 축소하여 VRAM 요구량을 줄입니다.",
            actionType: "REDUCE_BATCH_SIZE",
            payload: { recommendedBatchSize: 16 },
          },
          {
            title: "GPU 인스턴스 사양 증설 (T4 -> A10G / 멀티 GPU)",
            description:
              "하드웨어 티어를 GPU_T4_STANDARD에서 상위 GPU 티어로 증설하여 24GB 이상의 VRAM을 확보합니다.",
            actionType: "UPGRADE_GPU_TIER",
            payload: { recommendedTier: "GPU_A10G_HIGH" },
          },
        ],
        provider: "RULE_ENGINE_FALLBACK",
      };
    }

    if (isDriverMismatch) {
      return {
        rootCause: "NVIDIA CUDA Driver 및 Runtime 버전 불일치",
        summary: `노드에 설치된 NVIDIA GPU 드라이버 버전이 용기 런타임에서 요구하는 CUDA SDK 버전보다 낮습니다.`,
        detailedDiagnosis:
          "컨테이너 이미지의 CUDA 런타임(e.g. CUDA 12.2)이 호스트 노드의 GPU 드라이버(e.g. CUDA 11.8 이하)와 상호 호환되지 않아 이니셜라이즈 과정에서 실패했습니다.",
        detectedErrorCode: "DRIVER_MISMATCH",
        recommendedFixes: [
          {
            title: "CUDA 11.8 호환 프레임워크 이미지 선택",
            description:
              "노드 드라이버와 호환되는 이미지 프리셋(JUPYTER_PYTORCH v1.8.0)으로 변경합니다.",
            actionType: "CHANGE_IMAGE",
            payload: { recommendedImage: "JUPYTER_PYTORCH" },
          },
        ],
        provider: "RULE_ENGINE_FALLBACK",
      };
    }

    return {
      rootCause: "컨테이너 초기화 또는 코드 예외 발생 (CrashLoopBackOff)",
      summary: `${dto.resourceType} [${dto.resourceName}] 워크로드 스크립트 실행 중 파이썬 예외 또는 종속성 에러가 발생했습니다.`,
      detailedDiagnosis:
        "모듈 Import 실패, 환경 변수 누락 또는 파일 경로 참조 오류로 인해 컨테이너 메인 프로세스가 정상 종료되지 못했습니다.",
      detectedErrorCode: "POD_CRASH_LOOP",
      recommendedFixes: [
        {
          title: "컨테이너 실행 로그 및 스크립트 확인",
          description:
            "스크립트 내 파일 마운트 경로 및 의존성 모듈 설치 여부를 점검하세요.",
        },
      ],
      provider: "RULE_ENGINE_FALLBACK",
    };
  }
}
