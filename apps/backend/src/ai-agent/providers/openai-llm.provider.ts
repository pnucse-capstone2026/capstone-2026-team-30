import { Injectable, Logger, NotImplementedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LlmOptions, LlmProvider } from "./llm-provider.interface";

/**
 * OpenAI / Azure OpenAI / vLLM ChatCompletion 호환 LlmProvider 스텁
 *
 * 향후 OpenAI API 규격(또는 호환 로컬 LLM 서버)과 연동할 때 구현을 확장합니다.
 */
@Injectable()
export class OpenAiLlmProvider implements LlmProvider {
  readonly providerId = "OPENAI";
  private readonly logger = new Logger(OpenAiLlmProvider.name);
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("OPENAI_API_KEY");
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * OpenAI ChatCompletion API 호출을 수행합니다. (현재 TODO 스텁)
   *
   * @param systemPrompt 시스템 프롬프트
   * @param userPrompt 사용자 프롬프트
   * @param options 모델 옵션
   */
  async chatCompletion(
    _systemPrompt: string,
    _userPrompt: string,
    _options?: LlmOptions,
  ): Promise<string> {
    // TODO: Implement OpenAI / Azure OpenAI / vLLM ChatCompletion API client
    this.logger.warn(
      "OpenAiLlmProvider is not yet implemented. Please configure AI_PROVIDER=bedrock or AI_PROVIDER=none.",
    );
    throw new NotImplementedException(
      "OpenAiLlmProvider is not implemented yet. Use Bedrock or local Rule Template Engine fallback.",
    );
  }
}
