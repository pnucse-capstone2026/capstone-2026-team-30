import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiAgentController } from "./ai-agent.controller";
import { AiAgentService } from "./ai-agent.service";
import { BedrockService } from "./bedrock.service";
import { BedrockLlmProvider } from "./providers/bedrock-llm.provider";
import { LlmProviderFactory } from "./providers/llm-provider.factory";
import { LLM_PROVIDER_TOKEN } from "./providers/llm-provider.interface";
import { NoopLlmProvider } from "./providers/noop-llm.provider";
import { OpenAiLlmProvider } from "./providers/openai-llm.provider";
import { KyvernoRuleTemplateEngine } from "./rule-template.engine";
import { WorkloadEvaluatorService } from "./services/workload-evaluator.service";

/**
 * 벤더 독립적 LLM SPI 및 Kyverno 거버넌스 에이전트 모듈
 */
@Module({
  imports: [ConfigModule],
  controllers: [AiAgentController],
  providers: [
    BedrockService,
    BedrockLlmProvider,
    OpenAiLlmProvider,
    NoopLlmProvider,
    LlmProviderFactory,
    AiAgentService,
    KyvernoRuleTemplateEngine,
    WorkloadEvaluatorService,
  ],
  exports: [
    LLM_PROVIDER_TOKEN,
    BedrockService,
    BedrockLlmProvider,
    AiAgentService,
    KyvernoRuleTemplateEngine,
    WorkloadEvaluatorService,
  ],
})
export class AiAgentModule {}
