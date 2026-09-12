import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { SimulationModule } from "../simulation/simulation.module";
import { AiAgentModule } from "../ai-agent/ai-agent.module";
import { GitOpsPublisherService } from "./gitops-publisher.service";
import { GitOpsService } from "./gitops.service";
import { GitOpsController } from "./gitops.controller";
import { CiOrJwtAuthGuard } from "./guards/ci-or-jwt-auth.guard";

/**
 * Kyverno Platform GitOps 매니페스트 배포 및 Shift-Left PR Gate 거버넌스 모듈
 */
@Module({
  imports: [ConfigModule, KubernetesModule, SimulationModule, AiAgentModule],
  controllers: [GitOpsController],
  providers: [GitOpsPublisherService, GitOpsService, CiOrJwtAuthGuard],
  exports: [GitOpsPublisherService, GitOpsService],
})
export class GitOpsModule {}
