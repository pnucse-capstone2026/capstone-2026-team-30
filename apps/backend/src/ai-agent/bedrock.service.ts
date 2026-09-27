import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * AWS Bedrock Runtime Converse API와 연동하여 범용 LLM 모델(Amazon Nova, Claude 등) 호출을 처리하는 서비스
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

    // 즉시 사용 가능한 AWS Bedrock 최신 LLM 모델 기본 지정
    this.modelId = this.configService.get<string>(
      "BEDROCK_MODEL_ID",
      "amazon.nova-lite-v1:0",
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
   * AWS Bedrock Converse API 규격으로 파운데이션 모델을 호출합니다.
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
    try {
      const command = new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: systemPrompt }],
        messages: [
          {
            role: "user",
            content: [{ text: userPrompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: options?.maxTokens ?? 2048,
          temperature: options?.temperature ?? 0.2,
        },
      });

      const response = await this.client.send(command);
      const responseText = response.output?.message?.content?.[0]?.text;

      if (responseText) {
        return responseText;
      }

      throw new Error(
        "Bedrock Converse response does not contain valid text content",
      );
    } catch (error) {
      this.logger.warn(
        `AWS Bedrock Converse API invocation failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
