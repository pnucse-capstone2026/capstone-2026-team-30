import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiAgentController } from "./ai-agent.controller";
import { AiAgentService } from "./ai-agent.service";
import { BedrockService } from "./bedrock.service";

/**
 * AWS Bedrock 연동 Kyverno 에이전트 모듈
 */
@Module({
  imports: [ConfigModule],
  controllers: [AiAgentController],
  providers: [BedrockService, AiAgentService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
