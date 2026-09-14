import { Injectable, Logger } from "@nestjs/common";
import { LlmOptions, LlmProvider } from "./llm-provider.interface";

/**
 * LLM 호출을 완전히 비활성화하고 즉시 로컬 룰 엔진으로 폴백하도록 유도하는 No-op Provider
 */
@Injectable()
export class NoopLlmProvider implements LlmProvider {
  readonly providerId = "NONE";
  private readonly logger = new Logger(NoopLlmProvider.name);

  isAvailable(): boolean {
    return false;
  }

  /**
   * 의도적으로 에러를 발생시켜 서비스 레이어가 오프라인 룰 엔진으로 즉각 폴백하도록 트리거합니다.
   */
  async chatCompletion(
    _systemPrompt: string,
    _userPrompt: string,
    _options?: LlmOptions,
  ): Promise<string> {
    this.logger.debug(
      "LLM provider is disabled (NONE). Triggering rule template fallback.",
    );
    throw new Error(
      "LLM provider is disabled. Falling back to offline rule template engine.",
    );
  }
}
