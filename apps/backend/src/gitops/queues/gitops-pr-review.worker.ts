import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker, WorkerOptions } from "bullmq";
import { GitOpsService } from "../gitops.service";
import { GitOpsPrReviewResultDto } from "../dto/gitops-pr-review.dto";
import {
  GITOPS_PR_REVIEW_QUEUE_NAME,
  PrReviewJobData,
} from "./gitops-pr-review.queue";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "../providers/vcs-provider.interface";

export const INJECTED_BULLMQ_WORKER = "INJECTED_BULLMQ_WORKER";

export const DEFAULT_PR_REVIEW_WORKER_OPTIONS: Partial<WorkerOptions> = {
  concurrency: 5,
  // Bedrock 분당 할당량(RPM) 보호: 1분당 최대 40건으로 처리율 제한
  limiter: {
    max: 40,
    duration: 60000,
  },
};

/**
 * BullMQ 기반 GitOps PR 리뷰 비동기 워커 서비스
 *
 * AWS Bedrock 및 GitHub API의 분당 Quota를 보호하기 위해
 * Rate Limiter(Max 40 req/60s)와 Full Jitter 지수 백오프 하에서 작업을 처리하고
 * GitHub Check Run 상태를 갱신합니다.
 */
@Injectable()
export class GitOpsPrReviewWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GitOpsPrReviewWorker.name);
  private worker: Worker<PrReviewJobData, GitOpsPrReviewResultDto> | null =
    null;

  constructor(
    private readonly gitOpsService: GitOpsService,
    @Inject(VCS_PROVIDER_TOKEN)
    private readonly vcsProvider: VcsProvider,
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    @Inject(INJECTED_BULLMQ_WORKER)
    injectedWorker?: Worker<PrReviewJobData, GitOpsPrReviewResultDto>,
  ) {
    if (injectedWorker) {
      this.worker = injectedWorker;
    }
  }

  /**
   * 모듈 기동 시 BullMQ 워커를 초기화하고 이벤트 리스너를 바인딩합니다.
   */
  async onModuleInit(): Promise<void> {
    if (!this.worker) {
      this.initWorker();
    }
  }

  /**
   * 모듈 종료 시 워커를 안전하게 중단합니다.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch {
        // 종료 예외 무시
      }
      this.worker = null;
    }
  }

  /**
   * 개별 PR 리뷰 작업을 처리합니다. (단위 테스트에서 직접 호출 가능)
   *
   * @param job BullMQ 작업 인스턴스
   * @returns PR 리뷰 검증 결과
   */
  async processJob(
    job: Job<PrReviewJobData, GitOpsPrReviewResultDto>,
  ): Promise<GitOpsPrReviewResultDto> {
    const { dto, checkRunId } = job.data;
    this.logger.log(
      `[Worker] Processing PR review job #${job.id} for PR #${dto.pullNumber} (${dto.repository})`,
    );

    // 1. GitHub Check Run 상태를 'in_progress'로 갱신
    if (this.vcsProvider.updateCheckRun) {
      try {
        await this.vcsProvider.updateCheckRun({
          repository: dto.repository,
          commitSha: dto.commitSha,
          name: "kyverno/pr-review-gate",
          status: "in_progress",
          title: "Kyverno Policy Validation In Progress",
          summary:
            "Executing Server-Side Dry-Run validation with Bedrock review.",
          checkRunId,
        });
      } catch (err) {
        this.logger.debug(
          `Failed to update check run to in_progress: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    try {
      // 2. 비즈니스 로직 수행 (Server-Side Dry-Run 및 AI 자가 교정)
      const result = await this.gitOpsService.reviewPullRequest(dto);

      // 3. GitHub Check Run 완료 갱신
      if (this.vcsProvider.updateCheckRun) {
        const conclusion = result.blocked ? "failure" : "success";
        const title = result.blocked
          ? `Kyverno Blocked: ${result.blockedCount} Violations Found`
          : "Kyverno Policy Gate: Passed";
        const summary = result.blocked
          ? `Detected ${result.blockedCount} blocking Kyverno policy violation(s).`
          : `All ${result.totalResources} resources passed Server-Side Dry-Run validation.`;

        await this.vcsProvider.updateCheckRun({
          repository: dto.repository,
          commitSha: dto.commitSha,
          name: "kyverno/pr-review-gate",
          status: "completed",
          conclusion,
          title,
          summary,
          checkRunId,
        });
      }

      this.logger.log(
        `[Worker] Completed PR review job #${job.id} with status: ${result.status}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `[Worker] Error processing PR review job #${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      // 마지막 재시도 도달 시 Check Run에 실패 기록
      if (job.attemptsMade >= (job.opts?.attempts || 3) - 1) {
        if (this.vcsProvider.updateCheckRun) {
          try {
            await this.vcsProvider.updateCheckRun({
              repository: dto.repository,
              commitSha: dto.commitSha,
              name: "kyverno/pr-review-gate",
              status: "completed",
              conclusion: "failure",
              title: "Kyverno PR Review Failed after retries",
              summary: `Job processing failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
              checkRunId,
            });
          } catch {
            // 무시
          }
        }
      }

      throw err;
    }
  }

  /**
   * 워커 인스턴스를 반환합니다.
   */
  getWorker(): Worker<PrReviewJobData, GitOpsPrReviewResultDto> | null {
    return this.worker;
  }

  /**
   * Redis 연결 및 Rate Limiter를 설정하여 BullMQ Worker를 초기화합니다.
   */
  private initWorker(): void {
    const host =
      this.configService?.get<string>("REDIS_HOST") ||
      process.env.REDIS_HOST ||
      "localhost";
    const port = Number(
      this.configService?.get<number | string>("REDIS_PORT") ||
        process.env.REDIS_PORT ||
        6379,
    );
    const password =
      this.configService?.get<string>("REDIS_PASSWORD") ||
      process.env.REDIS_PASSWORD ||
      undefined;

    const workerOptions: WorkerOptions = {
      ...(DEFAULT_PR_REVIEW_WORKER_OPTIONS as WorkerOptions),
      connection: {
        host,
        port,
        password,
        maxRetriesPerRequest: null,
      },
    };

    try {
      this.worker = new Worker<PrReviewJobData, GitOpsPrReviewResultDto>(
        GITOPS_PR_REVIEW_QUEUE_NAME,
        async (job) => this.processJob(job),
        workerOptions,
      );

      this.worker.on("failed", (job, err) => {
        this.logger.warn(
          `[Worker Notice] Job #${job?.id} failed on attempt ${job?.attemptsMade}: ${err.message}`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `[BullMQ] Failed to initialize worker ${GITOPS_PR_REVIEW_QUEUE_NAME}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.worker = null;
    }
  }
}
