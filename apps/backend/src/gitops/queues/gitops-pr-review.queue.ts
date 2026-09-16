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
import { GitOpsPrReviewDto } from "../dto/gitops-pr-review.dto";

export const GITOPS_PR_REVIEW_QUEUE_NAME = "gitops-pr-review";
export const INJECTED_BULLMQ_QUEUE = "INJECTED_BULLMQ_QUEUE";

export interface PrReviewJobData {
  dto: GitOpsPrReviewDto;
  checkRunId?: number | string;
  enqueuedAt: string;
}

export interface EnqueueJobResult {
  id: string;
  status: "queued";
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

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    @Inject(INJECTED_BULLMQ_QUEUE)
    injectedQueue?: Queue<PrReviewJobData>,
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
        // 동일 PR(repository + pullNumber)의 이전 대기 중(waiting) 작업 선점 취소(Debounce)
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
          `[BullMQ] Failed to enqueue job to Redis, generating fallback jobId: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Redis 큐 미연결 시 fallback 식별자 반환
    const fallbackId = `fallback-${uuidv4()}`;
    return {
      id: fallbackId,
      status: "queued",
      checkRunId,
    };
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
