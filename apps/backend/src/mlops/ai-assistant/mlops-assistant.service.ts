import { Injectable, Logger } from "@nestjs/common";
import { BedrockService } from "../../ai-agent/bedrock.service";
import { MlopsIntentParserService } from "./mlops-intent-parser.service";
import {
  CopilotChatRequestDto,
  CopilotChatResponseDto,
} from "./dto/copilot-chat.dto";

/**
 * AWS Bedrock Claude 3.5 Sonnet 연동 MLOps 전용 AI Copilot 어시스턴트 서비스입니다.
 */
@Injectable()
export class MlopsAssistantService {
  private readonly logger = new Logger(MlopsAssistantService.name);

  constructor(
    private readonly bedrockService: BedrockService,
    private readonly intentParserService: MlopsIntentParserService,
  ) {}

  /**
   * 사용자의 자연어 프롬프트를 처리하고 MLOps Intent 및 Action Card를 생성합니다.
   *
   * @param dto 사용자 메시지 및 컨텍스트 정보
   * @returns AI 대화 응답 및 제안 액션
   */
  async processChat(
    dto: CopilotChatRequestDto,
  ): Promise<CopilotChatResponseDto> {
    const systemPrompt = `You are the MLOps AI Copilot for the Kyverno Governance Platform.
Your role is to assist Data Scientists and MLOps Engineers with:
1. Provisioning Kubeflow Notebooks (e.g. PyTorch, TensorFlow, RStudio, GPU tiers)
2. Deploying KServe inference endpoints
3. Running Kubeflow Pipelines
4. Diagnosing workload failures and optimizing FinOps GPU resources.

You MUST respond with a JSON object in the following format:
{
  "replyText": "Korean explanation string (Markdown allowed)",
  "intent": "CREATE_NOTEBOOK | DEPLOY_SERVED_MODEL | RUN_PIPELINE | FINOPS_OPTIMIZE | GENERAL_CHAT",
  "extractedParams": {
    "name": "resource-name",
    "hardwareTier": "GPU_T4_STANDARD or CPU_MEDIUM",
    "frameworkImage": "JUPYTER_PYTORCH or JUPYTER_TENSORFLOW",
    "gpu": true/false,
    "framework": "PYTORCH",
    "batchSize": 32
  },
  "recommendations": ["recommendation item 1", "recommendation item 2"]
}

Important Instructions:
- Always answer "replyText" in Korean.
- Be concise and clear.
- Output ONLY valid JSON.`;

    const userPrompt = `User Query: "${dto.message}"
Current UI Context: ${JSON.stringify(dto.context || {})}`;

    try {
      // 대안 1-A 적용: 선택적 options (maxTokens: 2048, temperature: 0.1)
      const rawResponse = await this.bedrockService.invokeClaude(
        systemPrompt,
        userPrompt,
        {
          maxTokens: 2048,
          temperature: 0.1,
        },
      );

      const parsed =
        this.intentParserService.parseJsonFromLlmOutput(rawResponse);

      if (parsed && parsed.replyText) {
        const proposedAction =
          parsed.intent && parsed.extractedParams
            ? this.intentParserService.buildProposedAction(
                parsed.intent,
                parsed.extractedParams,
              )
            : undefined;

        return {
          replyText: parsed.replyText,
          intent: parsed.intent || "GENERAL_CHAT",
          proposedAction,
          recommendations: parsed.recommendations || [],
          provider: "BEDROCK",
        };
      }

      // JSON 파싱은 안 되었으나 텍스트 응답이 있는 경우
      return {
        replyText: rawResponse,
        intent: "GENERAL_CHAT",
        provider: "BEDROCK",
      };
    } catch (error) {
      // Bedrock 연동 실패 시 규칙 기반 Fallback 응답 제공
      this.logger.warn(
        `MlopsAssistantService Bedrock fallback triggered: ${(error as Error).message}`,
      );
      return this.buildFallbackChatResponse(dto.message);
    }
  }

  /**
   * Bedrock 호출 불가 시 동작하는 규칙 기반 폴백 처리 로직입니다.
   *
   * @param message 사용자의 원본 입력 메시지
   * @returns 규칙 기반 폴백 응답
   */
  private buildFallbackChatResponse(message: string): CopilotChatResponseDto {
    const lower = message.toLowerCase();

    if (
      lower.includes("notebook") ||
      lower.includes("노트북") ||
      lower.includes("pytorch")
    ) {
      const isGpu = lower.includes("gpu") || lower.includes("t4");
      const proposedAction = this.intentParserService.buildProposedAction(
        "CREATE_NOTEBOOK",
        {
          name: `pytorch-nb-${Date.now().toString(36).slice(-4)}`,
          hardwareTier: isGpu ? "GPU_T4_STANDARD" : "CPU_MEDIUM",
          frameworkImage: "JUPYTER_PYTORCH",
          gpu: isGpu,
        },
      );

      return {
        replyText: `요청하신 내용을 기반으로 ${isGpu ? "1개 T4 GPU" : "CPU"} 사양의 PyTorch Jupyter Notebook 생성 액션 카드를 준비했습니다. (규칙 엔진 Fallback)`,
        intent: "CREATE_NOTEBOOK",
        proposedAction,
        recommendations: [
          "GPU 할당 규칙: 팀별 GPU Quota 정책 범위 내에서 프로비저닝됩니다.",
          "유휴 모니터링: 24시간 동안 사용량이 없을 경우 자동 일시중지됩니다.",
        ],
        provider: "RULE_ENGINE_FALLBACK",
      };
    }

    if (
      lower.includes("serving") ||
      lower.includes("서빙") ||
      lower.includes("kserve") ||
      lower.includes("배포")
    ) {
      const proposedAction = this.intentParserService.buildProposedAction(
        "DEPLOY_SERVED_MODEL",
        {
          name: `kserve-model-${Date.now().toString(36).slice(-4)}`,
          framework: "PYTORCH",
        },
      );

      return {
        replyText:
          "요청하신 모델 배포 사양에 맞춘 KServe 서빙 생성 미리보기 카드입니다. (규칙 엔진 Fallback)",
        intent: "DEPLOY_SERVED_MODEL",
        proposedAction,
        recommendations: [
          "카나리(Canary) 배포 설정을 통해 트래픽을 단계적으로 전환할 수 있습니다.",
        ],
        provider: "RULE_ENGINE_FALLBACK",
      };
    }

    return {
      replyText: `MLOps Copilot 서비스에 오신 것을 환영합니다. "${message}"에 대하여 도움을 드릴 수 있습니다. 노트북 생성, 모델 서빙 배포, 파이프라인 실행 또는 에러 진단을 질문해 주세요.`,
      intent: "GENERAL_CHAT",
      recommendations: [
        "예시: 'PyTorch 2.3 노트북 1개 생성해줘'",
        "예시: 'KServe에 ResNet50 모델 배포해줘'",
      ],
      provider: "RULE_ENGINE_FALLBACK",
    };
  }
}
