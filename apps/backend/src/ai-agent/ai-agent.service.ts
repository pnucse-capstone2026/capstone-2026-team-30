import { Injectable, Logger } from "@nestjs/common";
import { BedrockService } from "./bedrock.service";
import {
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";

/**
 * 플랫폼 비전문 사용자를 위한 Kyverno 오류 해설 및 수정 가이드 생성 AI 에이전트 서비스
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(private readonly bedrockService: BedrockService) {}

  /**
   * Kyverno 정책 위반 오류 메시지 및 K8s 매니페스트 context를 분석하여 쉬운 해설 리포트를 생성합니다.
   *
   * @param dto Kyverno 오류 메시지, 정책 YAML, 쿠버네티스 매니페스트, 클러스터 상태 정보
   * @returns 쉬운 해설, 단계별 조치 방법, 수정 매니페스트 및 보안 거버넌스 배경
   */
  async explainKyvernoError(
    dto: ExplainKyvernoErrorDto,
  ): Promise<KyvernoErrorExplanationResultDto> {
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

    const userPrompt = `
[Kyverno Error Message]
${dto.errorMessage}

[Applied Kyverno Policy]
${dto.policyYaml || "N/A"}

[User Submitted Resource Manifest]
${dto.resourceManifest || "N/A"}

[Cluster Environment Context]
${dto.clusterContext || "N/A"}

Please analyze the failure above and generate the JSON response.
`;

    try {
      const rawResponse = await this.bedrockService.invokeClaude(
        systemPrompt,
        userPrompt,
      );

      // 모델 응답에 markdown ```json 태그가 포함되어 있을 경우를 대비하여 파싱 전 정제합니다.
      const cleaned = rawResponse.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned) as KyvernoErrorExplanationResultDto;
      return parsed;
    } catch (error) {
      // Bedrock API 미연결 또는 파싱 실패 환경에서도 프론트엔드가 중단되지 않도록 Fallback 목업 분석 결과를 제공합니다.
      this.logger.warn(
        `Fallback to mock explanation due to Bedrock call failure: ${(error as Error).message}`,
      );
      return this.generateFallbackExplanation(dto);
    }
  }

  /**
   * AWS Bedrock 자격 증명이 누락되었거나 통신 오류 발생 시 반환하는 안정적인 Fallback 해설 로직
   */
  private generateFallbackExplanation(
    dto: ExplainKyvernoErrorDto,
  ): KyvernoErrorExplanationResultDto {
    const isRootFsError =
      dto.errorMessage.includes("rootFS") ||
      dto.errorMessage.includes("read-only");

    if (isRootFsError) {
      return {
        summary:
          "컨테이너 파일시스템이 읽기 전용(Read-Only)으로 설정되지 않아 배포가 차단되었습니다.",
        resolutionSteps: [
          "Deployment 매니페스트의 spec.template.spec.containers[].securityContext 항목을 찾습니다.",
          "readOnlyRootFilesystem: true 구문을 추가하거나 수정합니다.",
          "임시 파일 쓰기가 필요한 경우 emptyDir 볼륨을 마운트하여 사용합니다.",
        ],
        suggestedFixYaml: `securityContext:
  readOnlyRootFilesystem: true
  runAsNonRoot: true`,
        governanceRationale:
          "공격자가 컨테이너 내부 악성 파일(악성코드/웹쉘 등)을 생성하는 것을 근본적으로 차단하여 클러스터 보안을 강화하기 위한 조직 정책입니다.",
      };
    }

    return {
      summary: `Kyverno 정책에 의해 요청이 거부되었습니다: ${dto.errorMessage}`,
      resolutionSteps: [
        "오류 메시지에서 명시된 룰(Rule) 요구사항을 매니페스트에 반영합니다.",
        "필수 레이블(Label)이나 보안 컨텍스트(securityContext) 설정을 확인하세요.",
      ],
      suggestedFixYaml: dto.resourceManifest
        ? `# 수정 필요 매니페스트\n${dto.resourceManifest}`
        : undefined,
      governanceRationale:
        "안정적이고 안전한 쿠버네티스 운영 환경 구축을 위해 가버넌스 검증이 적용되었습니다.",
    };
  }
}
