import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, QueueOptions } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { BusinessException } from "../../common/errors/business.exception";
import { GitOpsPrReviewDto } from "../dto/gitops-pr-review.dto";
import { GITOPS_ERROR } from "../gitops.errors";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "../providers/vcs-provider.interface";

export const GITOPS_PR_REVIEW_QUEUE_NAME = "gitops-pr-review";
export const INJECTED_BULLMQ_QUEUE = "INJECTED_BULLMQ_QUEUE";

export interface PrReviewJobData {
  dto: GitOpsPrReviewDto;
  checkRunId?: number | string;
  enqueuedAt: string;
}

export interface EnqueueJobResult {
  id: string;
  status: "queued" | "fallback_sync";
  checkRunId?: number | string;
}

export const DEFAULT_PR_REVIEW_QUEUE_OPTIONS: Partial<QueueOptions> = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

/**
 * BullMQ 기반 GitOps PR 리뷰 분산 작업 큐 서비스
 *
 * AWS Bedrock 쿼터(분당 40~50회) 및 GitHub API Rate Limit(5,000 req/hr)을 보호하기 위해
 * 요청을 버퍼링하고 토큰 버킷 기반 분산 레이트 리미팅과 지수 백오프를 적용합니다.
 */
@Injectable()
export class GitOpsPrReviewQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GitOpsPrReviewQueue.name);
  private queue: Queue<PrReviewJobData> | null = null;

  // 동일 PR에 대해 현재 큐에서 대기/지연 중인 이전 작업 식별자 트래커 (O(1) 선점 디바운스용)
  private readonly activePrJobs = new Map<
    string,
    { jobId: string; checkRunId?: number | string; commitSha: string }
  >();

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    @Inject(INJECTED_BULLMQ_QUEUE)
    injectedQueue?: Queue<PrReviewJobData>,
    @Optional()
    @Inject(VCS_PROVIDER_TOKEN)
    private readonly vcsProvider?: VcsProvider,
  ) {
    if (injectedQueue) {
      this.queue = injectedQueue;
    }
  }

  /**
   * 모듈 기동 시 BullMQ Queue를 초기화합니다.
   */
  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      this.initQueue();
    }
  }

  /**
   * PR 정책 검증 작업을 큐에 Enqueue합니다.
   *
   * @param dto PR 리뷰 요청 매개변수
   * @param checkRunId GitHub Check Run 식별자 (선택)
   * @returns 발행된 작업 ID 및 큐 상태
   */
  async addReviewJob(
    dto: GitOpsPrReviewDto,
    checkRunId?: number | string,
  ): Promise<EnqueueJobResult> {
    const jobData: PrReviewJobData = {
      dto,
      checkRunId,
      enqueuedAt: new Date().toISOString(),
    };

    if (this.queue) {
      try {
        const prKey = `${dto.repository}#${dto.pullNumber}`;

        // 1. O(1) 트래커를 통한 이전 활성 작업 선점 취소
        const trackedOld = this.activePrJobs.get(prKey);
        if (trackedOld) {
          try {
            const oldJob = await this.queue.getJob(trackedOld.jobId);
            if (oldJob) {
              const state = await oldJob.getState();
              if (state === "waiting" || state === "delayed") {
                await oldJob.remove();
                this.logger.log(
                  `[BullMQ] Preempted older pending job #${oldJob.id} (state: ${state}) for PR #${dto.pullNumber} via O(1) tracker`,
                );
              }
            }
          } catch (trackerErr) {
            this.logger.debug(
              `[BullMQ] Tracker job removal skipped: ${trackerErr instanceof Error ? trackerErr.message : String(trackerErr)}`,
            );
          }

          // 선점된 이전 작업의 GitHub Check Run을 'neutral/superseded'로 종결 처리
          if (trackedOld.checkRunId && this.vcsProvider?.updateCheckRun) {
            try {
              await this.vcsProvider.updateCheckRun({
                name: "Kyverno Policy PR Review",
                repository: dto.repository,
                commitSha: trackedOld.commitSha,
                status: "completed",
                conclusion: "neutral",
                title: "Kyverno PR Review Superseded",
                summary: `Review superseded by newer commit ${dto.commitSha.slice(0, 7)}`,
                checkRunId: trackedOld.checkRunId,
              });
              this.logger.log(
                `[BullMQ] Marked superseded Check Run #${trackedOld.checkRunId} as completed/neutral`,
              );
            } catch (vcsErr) {
              this.logger.debug(
                `[BullMQ] Failed to update superseded Check Run: ${vcsErr instanceof Error ? vcsErr.message : String(vcsErr)}`,
              );
            }
          }
        }

        // 2. 대기열(waiting)에서 동일 PR의 잔여 작업 스캔 및 취소
        try {
          const waitingJobs = await this.queue.getJobs(["waiting"]);
          for (const oldJob of waitingJobs) {
            if (
              oldJob?.data?.dto?.repository === dto.repository &&
              oldJob?.data?.dto?.pullNumber === dto.pullNumber
            ) {
              await oldJob.remove();
              this.logger.log(
                `[BullMQ] Preempted older pending job #${oldJob.id} for PR #${dto.pullNumber}`,
              );

              // Check Run 종결
              const oldCheckRunId = oldJob.data?.checkRunId;
              const oldCommitSha = oldJob.data?.dto?.commitSha;
              if (oldCheckRunId && this.vcsProvider?.updateCheckRun) {
                try {
                  await this.vcsProvider.updateCheckRun({
                    name: "Kyverno Policy PR Review",
                    repository: dto.repository,
                    commitSha: oldCommitSha || dto.commitSha,
                    status: "completed",
                    conclusion: "neutral",
                    title: "Kyverno PR Review Superseded",
                    summary: `Review superseded by newer commit ${dto.commitSha.slice(0, 7)}`,
                    checkRunId: oldCheckRunId,
                  });
                } catch {
                  // 무시
                }
              }
            }
          }
        } catch (preemptErr) {
          this.logger.warn(
            `[BullMQ] Preemption scan failed for PR #${dto.pullNumber}: ${
              preemptErr instanceof Error
                ? preemptErr.message
                : String(preemptErr)
            }`,
          );
        }

        const job = await this.queue.add("pr-review", jobData, {
          jobId: `pr-${dto.repository.replace(/\//g, "-")}-${dto.pullNumber}-${uuidv4().slice(0, 8)}`,
        });

        // O(1) 트래커 갱신
        this.activePrJobs.set(prKey, {
          jobId: String(job.id),
          checkRunId,
          commitSha: dto.commitSha,
        });

        this.logger.log(
          `[BullMQ] Enqueued PR review job #${job.id} for PR #${dto.pullNumber} (${dto.repository})`,
        );

        return {
          id: String(job.id),
          status: "queued",
          checkRunId,
        };
      } catch (err) {
        this.logger.error(
          `[BullMQ] Failed to enqueue job to Redis: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Redis 큐 미연결 또는 Enqueue 실패 시 fallback 동기 검증 여부 확인
    const isFallbackSync =
      this.configService?.get<string>("GITOPS_QUEUE_FALLBACK_SYNC") ===
        "true" || process.env.GITOPS_QUEUE_FALLBACK_SYNC === "true";

    if (isFallbackSync) {
      this.logger.warn(
        `[BullMQ] Redis queue unavailable. Falling back to inline synchronous PR review execution for PR #${dto.pullNumber}`,
      );
      return {
        id: `fallback-sync-${uuidv4()}`,
        status: "fallback_sync",
        checkRunId,
      };
    }

    this.logger.error(
      `[BullMQ] Redis queue unavailable and inline fallback sync disabled. Rejecting PR review request for PR #${dto.pullNumber}`,
    );
    throw new BusinessException(GITOPS_ERROR.QUEUE_UNAVAILABLE);
  }

  /**
   * 모듈 종료 시 큐 커넥션을 안전하게 닫습니다.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch {
        // 종료 예외 무시
      }
      this.queue = null;
    }
  }

  /**
   * 현재 큐 인스턴스를 반환합니다. (테스트 및 상태 조회용)
   */
  getQueue(): Queue<PrReviewJobData> | null {
    return this.queue;
  }

  /**
   * Redis 연결 설정을 기반으로 BullMQ Queue 인스턴스를 초기화합니다.
   */
  private initQueue(): void {
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

    const queueOptions: QueueOptions = {
      ...DEFAULT_PR_REVIEW_QUEUE_OPTIONS,
      connection: {
        host,
        port,
        password,
        maxRetriesPerRequest: null,
      },
    };

    try {
      this.queue = new Queue<PrReviewJobData>(
        GITOPS_PR_REVIEW_QUEUE_NAME,
        queueOptions,
      );
    } catch (err) {
      this.logger.warn(
        `[BullMQ] Failed to initialize queue ${GITOPS_PR_REVIEW_QUEUE_NAME}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.queue = null;
    }
  }
}
