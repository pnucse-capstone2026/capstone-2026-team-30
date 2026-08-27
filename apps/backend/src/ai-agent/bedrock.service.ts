import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * AWS Bedrock Runtime과 연동하여 LLM 모델 호출을 처리하는 서비스
 */
@Injectable()
export class BedrockService {
  private readonly logger = new Logger(BedrockService.name);
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(private readonly configService: ConfigService) {
    // 프로젝트 AWS 표준 기본 리전: us-east-1
    const region = this.configService.get<string>("AWS_REGION", "us-east-1");
    const accessKeyId = this.configService.get<string>("AWS_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>(
      "AWS_SECRET_ACCESS_KEY",
    );

    this.modelId = this.configService.get<string>(
      "BEDROCK_MODEL_ID",
      "anthropic.claude-3-5-sonnet-20240620-v1:0",
    );

    const clientConfig: Record<string, unknown> = { region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.client = new BedrockRuntimeClient(clientConfig);
  }

  /**
   * Anthropic Claude Messages API 규격으로 Bedrock 모델을 호출합니다.
   *
   * @param systemPrompt 에이전트 페르소나 및 응답 지침
   * @param userPrompt 오류 메시지, 정책, 매니페스트 또는 MLOps 질의 프롬프트
   * @param options 선택적 모델 파라미터 (maxTokens, temperature)
   * @returns Bedrock 모델 생성 텍스트 응답
   */
  async invokeClaude(
    systemPrompt: string,
    userPrompt: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.2,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    try {
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (responseBody.content && responseBody.content.length > 0) {
        return responseBody.content[0].text;
      }

      throw new Error(
        "Bedrock response body does not contain valid text content",
      );
    } catch (error) {
      // 로컬 개발 및 테스트 시 AWS 자격증명이 연결되어 있지 않거나 타임아웃 발생 시 로깅 처리
      this.logger.warn(
        `AWS Bedrock invocation failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
