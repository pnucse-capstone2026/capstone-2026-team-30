import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { SimulationModule } from "../simulation/simulation.module";
import { AiAgentModule } from "../ai-agent/ai-agent.module";
import { GitOpsPublisherService } from "./gitops-publisher.service";
import { GitOpsService } from "./gitops.service";
import { GitOpsController } from "./gitops.controller";
import { CiOrJwtAuthGuard } from "./guards/ci-or-jwt-auth.guard";
import { GitHubVcsProvider } from "./providers/github-vcs.provider";
import { GitLabVcsProvider } from "./providers/gitlab-vcs.provider";
import { LocalFileVcsProvider } from "./providers/local-file-vcs.provider";
import { VcsProviderFactory } from "./providers/vcs-provider.factory";
import { VCS_PROVIDER_TOKEN } from "./providers/vcs-provider.interface";
import { GitOpsPrReviewQueue } from "./queues/gitops-pr-review.queue";
import { GitOpsPrReviewWorker } from "./queues/gitops-pr-review.worker";

/**
 * Kyverno Platform GitOps 매니페스트 배포 및 Shift-Left PR Gate 거버넌스 모듈
 */
@Module({
  imports: [ConfigModule, KubernetesModule, SimulationModule, AiAgentModule],
  controllers: [GitOpsController],
  providers: [
    GitHubVcsProvider,
    GitLabVcsProvider,
    LocalFileVcsProvider,
    VcsProviderFactory,
    GitOpsPublisherService,
    GitOpsService,
    GitOpsPrReviewQueue,
    GitOpsPrReviewWorker,
    CiOrJwtAuthGuard,
  ],
  exports: [
    VCS_PROVIDER_TOKEN,
    GitHubVcsProvider,
    GitOpsPublisherService,
    GitOpsService,
    GitOpsPrReviewQueue,
    GitOpsPrReviewWorker,
  ],
})
export class GitOpsModule {}
