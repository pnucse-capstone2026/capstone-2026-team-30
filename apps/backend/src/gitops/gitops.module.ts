import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
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
import {
  GITOPS_PR_REVIEW_DLQ_NAME,
  GITOPS_PR_REVIEW_DLQ_TOKEN,
  GitOpsPrReviewWorker,
  PrReviewDlqJobData,
} from "./queues/gitops-pr-review.worker";

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
    {
      provide: GITOPS_PR_REVIEW_DLQ_TOKEN,
      useFactory: (configService: ConfigService) => {
        const host =
          configService.get<string>("REDIS_HOST") ||
          process.env.REDIS_HOST ||
          "localhost";
        const port = Number(
          configService.get<number | string>("REDIS_PORT") ||
            process.env.REDIS_PORT ||
            6379,
        );
        const password =
          configService.get<string>("REDIS_PASSWORD") ||
          process.env.REDIS_PASSWORD ||
          undefined;
        return new Queue<PrReviewDlqJobData>(GITOPS_PR_REVIEW_DLQ_NAME, {
          connection: { host, port, password, maxRetriesPerRequest: null },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    VCS_PROVIDER_TOKEN,
    GitHubVcsProvider,
    GitOpsPublisherService,
    GitOpsService,
    GitOpsPrReviewQueue,
    GitOpsPrReviewWorker,
    GITOPS_PR_REVIEW_DLQ_TOKEN,
  ],
})
export class GitOpsModule {}
