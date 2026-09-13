import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BedrockService } from "./bedrock.service";
import {
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";
import { KyvernoRuleTemplateEngine } from "./rule-template.engine";
import { WorkloadEvaluatorService } from "./services/workload-evaluator.service";

/**
 * 플랫폼 비전문 사용자를 위한 Kyverno 오류 해설 및 수정 가이드 생성 AI 에이전트 서비스
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly bedrockService: BedrockService,
    private readonly ruleTemplateEngine: KyvernoRuleTemplateEngine,
    private readonly workloadEvaluator: WorkloadEvaluatorService,
    config: ConfigService,
  ) {
    // Bedrock API 응답 대기 상한 타임아웃 (기본값: 15000ms)
    const configuredTimeout = Number(
      config.get<string>("AI_ANALYSIS_TIMEOUT_MS", "15000"),
    );
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 15000;
  }

  /**
   * Kyverno 정책 위반 오류 메시지 및 K8s 매니페스트 context를 분석하여 쉬운 해설 리포트를 생성합니다.
   * AWS Bedrock 통신에 타임아웃이 발생하거나 실패할 경우 룰 기반 Graceful Fallback 엔진으로 즉각 전환합니다.
   *
   * @param dto Kyverno 오류 메시지, 정책 YAML, 쿠버네티스 매니페스트, 클러스터 상태 정보
   * @returns 쉬운 해설, 단계별 조치 방법, 수정 매니페스트 및 보안 거버넌스 배경
   */
  async explainKyvernoError(
    dto: ExplainKyvernoErrorDto,
  ): Promise<KyvernoErrorExplanationResultDto> {
    const startTime = Date.now();
    const evalResult = this.workloadEvaluator.evaluate(dto);

    const systemPrompt = `You are a helpful, empathetic Platform Engineering AI Assistant.
Your mission is to explain Kyverno policy rejection errors to application developers who do NOT have deep Kubernetes or Platform Engineering knowledge.

Output format MUST be a valid JSON object matching the following structure without codeblock wrapper or markdown syntax:
{
  "summary": "Easy-to-understand explanation of why the deployment was rejected in Korean",
  "resolutionSteps": ["Step 1 explanation in Korean", "Step 2 explanation in Korean", "..."],
  "suggestedFixYaml": "Valid corrected YAML manifest snippet if applicable",
  "governanceRationale": "Why this Kyverno policy is enforced in our organization (security/reliability benefits) in Korean"
}

Guidelines:
1. Translate technical jargon into plain, intuitive Korean.
2. Provide concrete, copy-pasteable YAML fixes whenever manifest is provided.
3. Be supportive and instructional, avoiding punitive tone.`;

    let feedbackSection = "";
    if (dto.previousAttemptYaml || dto.validationFeedback) {
      feedbackSection = `
[Previous Attempted Manifest]
${dto.previousAttemptYaml || "N/A"}

[Dry-Run Re-validation Feedback / Unresolved Violations]
${dto.validationFeedback || "N/A"}

[Self-Correction Instruction]
The previous attempted manifest fix was rejected by Server-Side Dry-Run validation.
Strictly resolve all the unresolved Kyverno violations above while adhering to Kubernetes specifications.
`;
    }

    const userPrompt = `
[Kyverno Error Message]
${dto.errorMessage}

[Applied Kyverno Policy]
${dto.policyYaml || "N/A"}

[User Submitted Resource Manifest]
${dto.resourceManifest || "N/A"}

[Cluster Environment Context]
${dto.clusterContext || "N/A"}
${feedbackSection}
Please analyze the failure above and generate the JSON response.
`;

    try {
      // 타임아웃 시 AI 호출을 취소하고 Fallback 엔진으로 자동 전환하는 Promise.race 제어
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Bedrock API request timed out after ${this.timeoutMs}ms`,
              ),
            ),
          this.timeoutMs,
        ),
      );

      const rawResponse = (await Promise.race([
        this.bedrockService.invokeClaude(systemPrompt, userPrompt),
        timeoutPromise,
      ])) as string;

      const latencyMs = Date.now() - startTime;

      // 모델 응답에 markdown ```json 태그가 포함되어 있을 경우를 대비하여 파싱 전 정제합니다.
      const cleaned = rawResponse.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned) as KyvernoErrorExplanationResultDto;

      return {
        ...parsed,
        provider: "BEDROCK",
        analysisMode: evalResult.mode,
        taskScope: evalResult.scope,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.warn(
        `Fallback to rule template engine due to Bedrock call failure/timeout (${latencyMs}ms): ${(error as Error).message}`,
      );

      // 정규식 매칭 기반 오프라인 룰 템플릿 엔진으로 즉시 조치 가이드 생성
      const fallbackResult = this.ruleTemplateEngine.matchAndGenerate(
        dto,
        latencyMs,
      );

      return {
        ...fallbackResult,
        analysisMode: evalResult.mode,
        taskScope: evalResult.scope,
      };
    }
  }
}
