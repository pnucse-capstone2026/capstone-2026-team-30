import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BedrockLlmProvider } from "./bedrock-llm.provider";
import { LLM_PROVIDER_TOKEN, LlmProvider } from "./llm-provider.interface";
import { NoopLlmProvider } from "./noop-llm.provider";
import { OpenAiLlmProvider } from "./openai-llm.provider";

/**
 * 환경 설정(AI_PROVIDER)에 따라 적절한 LlmProvider 구현체를 주입하는 팩토리 프로바이더
 */
export const LlmProviderFactory: Provider<LlmProvider> = {
  provide: LLM_PROVIDER_TOKEN,
  useFactory: (
    config: ConfigService,
    bedrock: BedrockLlmProvider,
    openai: OpenAiLlmProvider,
    noop: NoopLlmProvider,
  ): LlmProvider => {
    const providerType = config
      .get<string>("AI_PROVIDER", "bedrock")
      .toLowerCase();

    switch (providerType) {
      case "openai":
        return openai;
      case "none":
      case "disabled":
        return noop;
      case "bedrock":
      default:
        return bedrock;
    }
  },
  inject: [
    ConfigService,
    BedrockLlmProvider,
    OpenAiLlmProvider,
    NoopLlmProvider,
  ],
};
