import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GitOpsPublisherService } from "./gitops-publisher.service";

// Kyverno Platform GitOps 매니페스트 게시 모듈

@Module({
  imports: [ConfigModule],
  providers: [GitOpsPublisherService],
  exports: [GitOpsPublisherService],
})
export class GitOpsModule {}
