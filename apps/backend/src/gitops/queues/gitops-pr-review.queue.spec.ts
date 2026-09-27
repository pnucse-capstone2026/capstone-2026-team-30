import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { BusinessException } from "../../common/errors/business.exception";
import { GitOpsPrReviewDto } from "../dto/gitops-pr-review.dto";
import { GITOPS_ERROR } from "../gitops.errors";
import {
  DEFAULT_PR_REVIEW_QUEUE_OPTIONS,
  GitOpsPrReviewQueue,
  INJECTED_BULLMQ_QUEUE,
  PrReviewJobData,
} from "./gitops-pr-review.queue";

describe("GitOpsPrReviewQueue", () => {
  let queueService: GitOpsPrReviewQueue;
  let mockQueue: jest.Mocked<Partial<Queue<PrReviewJobData>>>;

  const mockDto: GitOpsPrReviewDto = {
    repository: "my-org/my-repo",
    pullNumber: 42,
    commitSha: "abc123def456",
    targetNamespace: "production",
    manifestYaml: "apiVersion: apps/v1\nkind: Deployment",
  };

  let mockVcsProvider: {
    updateCheckRun: jest.Mock;
  };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
      getJobs: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockVcsProvider = {
      updateCheckRun: jest
        .fn()
        .mockResolvedValue({ id: 999, status: "completed" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitOpsPrReviewQueue,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "REDIS_HOST") return "127.0.0.1";
              if (key === "REDIS_PORT") return 6379;
              return undefined;
            }),
          },
        },
        {
          provide: INJECTED_BULLMQ_QUEUE,
          useValue: mockQueue,
        },
        {
          provide: "VCS_PROVIDER_TOKEN",
          useValue: mockVcsProvider,
        },
      ],
    }).compile();

    queueService = module.get<GitOpsPrReviewQueue>(GitOpsPrReviewQueue);
  });

  afterEach(async () => {
    await queueService.onModuleDestroy();
  });

  describe("addReviewJob", () => {
    it("should successfully add a job to BullMQ and return enqueue result", async () => {
      (mockQueue.add as jest.Mock).mockResolvedValueOnce({
        id: "pr-my-org-my-repo-42-12345678",
      });

      const result = await queueService.addReviewJob(mockDto, 1001);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, jobData, jobOpts] = (mockQueue.add as jest.Mock).mock
        .calls[0];

      expect(jobName).toBe("pr-review");
      expect(jobData.dto).toEqual(mockDto);
      expect(jobData.checkRunId).toBe(1001);
      expect(jobData.enqueuedAt).toBeDefined();
      expect(jobOpts.jobId).toMatch(/^pr-my-org-my-repo-42-[a-f0-9]{8}$/);

      expect(result).toEqual({
        id: "pr-my-org-my-repo-42-12345678",
        status: "queued",
        checkRunId: 1001,
      });
    });

    it("should preempt and remove older waiting jobs for the same PR", async () => {
      const olderJobRemove = jest.fn().mockResolvedValue(undefined);
      const differentPrJobRemove = jest.fn().mockResolvedValue(undefined);

      const waitingJobs = [
        {
          id: "pr-my-org-my-repo-42-old1",
          data: {
            dto: { repository: "my-org/my-repo", pullNumber: 42 },
          },
          remove: olderJobRemove,
        },
        {
          id: "pr-other-org-other-repo-99-old2",
          data: {
            dto: { repository: "other-org/other-repo", pullNumber: 99 },
          },
          remove: differentPrJobRemove,
        },
      ];

      (mockQueue.getJobs as jest.Mock).mockResolvedValueOnce(waitingJobs);
      (mockQueue.add as jest.Mock).mockResolvedValueOnce({
        id: "pr-my-org-my-repo-42-new1",
      });

      const result = await queueService.addReviewJob(mockDto, 1001);

      expect(mockQueue.getJobs).toHaveBeenCalledWith(["waiting"]);
      expect(olderJobRemove).toHaveBeenCalledTimes(1);
      expect(differentPrJobRemove).not.toHaveBeenCalled();
      expect(result.id).toBe("pr-my-org-my-repo-42-new1");
    });

    it("should update older superseded Check Run to neutral when preempting older job", async () => {
      const olderJobRemove = jest.fn().mockResolvedValue(undefined);
      const waitingJobs = [
        {
          id: "pr-my-org-my-repo-42-old",
          data: {
            dto: {
              repository: "my-org/my-repo",
              pullNumber: 42,
              commitSha: "old-sha-123",
            },
            checkRunId: 777,
          },
          remove: olderJobRemove,
        },
      ];

      (mockQueue.getJobs as jest.Mock).mockResolvedValueOnce(waitingJobs);
      (mockQueue.add as jest.Mock).mockResolvedValueOnce({
        id: "pr-my-org-my-repo-42-new",
      });

      await queueService.addReviewJob(mockDto, 1001);

      expect(olderJobRemove).toHaveBeenCalledTimes(1);
      expect(mockVcsProvider.updateCheckRun).toHaveBeenCalledWith(
        expect.objectContaining({
          checkRunId: 777,
          status: "completed",
          conclusion: "neutral",
          title: "Kyverno PR Review Superseded",
        }),
      );
    });

    it("should gracefully continue enqueuing when preemption scan throws an error", async () => {
      (mockQueue.getJobs as jest.Mock).mockRejectedValueOnce(
        new Error("Redis getJobs scan failed"),
      );
      (mockQueue.add as jest.Mock).mockResolvedValueOnce({
        id: "pr-my-org-my-repo-42-new2",
      });

      const result = await queueService.addReviewJob(mockDto, 1001);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(result.id).toBe("pr-my-org-my-repo-42-new2");
    });

    it("should throw BusinessException(QUEUE_UNAVAILABLE) when queue.add throws an error and fallback sync is disabled (default fail-closed)", async () => {
      (mockQueue.add as jest.Mock).mockRejectedValueOnce(
        new Error("Redis connection lost"),
      );

      await expect(queueService.addReviewJob(mockDto, 1002)).rejects.toThrow(
        BusinessException,
      );
      await expect(queueService.addReviewJob(mockDto, 1002)).rejects.toThrow(
        expect.objectContaining({
          code: GITOPS_ERROR.QUEUE_UNAVAILABLE.code,
        }),
      );
    });

    it("should throw BusinessException(QUEUE_UNAVAILABLE) when queue instance is null and fallback sync is disabled", async () => {
      const noQueueService = new GitOpsPrReviewQueue();
      try {
        await expect(noQueueService.addReviewJob(mockDto)).rejects.toThrow(
          BusinessException,
        );
      } finally {
        await noQueueService.onModuleDestroy();
      }
    });

    it("should return fallback_sync status when queue.add throws an error and GITOPS_QUEUE_FALLBACK_SYNC is enabled", async () => {
      const configServiceMock = {
        get: jest.fn((key: string) => {
          if (key === "GITOPS_QUEUE_FALLBACK_SYNC") return "true";
          return undefined;
        }),
      };

      const fallbackModule: TestingModule = await Test.createTestingModule({
        providers: [
          GitOpsPrReviewQueue,
          {
            provide: ConfigService,
            useValue: configServiceMock,
          },
          {
            provide: INJECTED_BULLMQ_QUEUE,
            useValue: mockQueue,
          },
        ],
      }).compile();

      const fallbackQueueService =
        fallbackModule.get<GitOpsPrReviewQueue>(GitOpsPrReviewQueue);

      (mockQueue.add as jest.Mock).mockRejectedValueOnce(
        new Error("Redis connection lost"),
      );

      const result = await fallbackQueueService.addReviewJob(mockDto, 1003);

      expect(result.id).toMatch(/^fallback-sync-[0-9a-f-]{36}$/);
      expect(result.status).toBe("fallback_sync");
      expect(result.checkRunId).toBe(1003);

      await fallbackQueueService.onModuleDestroy();
    });

    it("should return fallback_sync status when queue is null and GITOPS_QUEUE_FALLBACK_SYNC is enabled", async () => {
      const configServiceMock = {
        get: jest.fn((key: string) => {
          if (key === "GITOPS_QUEUE_FALLBACK_SYNC") return "true";
          return undefined;
        }),
      };

      const fallbackQueueService = new GitOpsPrReviewQueue(
        configServiceMock as unknown as ConfigService,
      );

      try {
        const result = await fallbackQueueService.addReviewJob(mockDto, 1004);

        expect(result.id).toMatch(/^fallback-sync-[0-9a-f-]{36}$/);
        expect(result.status).toBe("fallback_sync");
        expect(result.checkRunId).toBe(1004);
      } finally {
        await fallbackQueueService.onModuleDestroy();
      }
    });
  });

  describe("DEFAULT_PR_REVIEW_QUEUE_OPTIONS", () => {
    it("should configure 3 retry attempts with exponential backoff and 2000ms delay", () => {
      expect(DEFAULT_PR_REVIEW_QUEUE_OPTIONS.defaultJobOptions?.attempts).toBe(
        3,
      );
      expect(
        DEFAULT_PR_REVIEW_QUEUE_OPTIONS.defaultJobOptions?.backoff,
      ).toEqual({
        type: "exponential",
        delay: 2000,
      });
      expect(
        DEFAULT_PR_REVIEW_QUEUE_OPTIONS.defaultJobOptions?.removeOnComplete,
      ).toBe(true);
      expect(
        DEFAULT_PR_REVIEW_QUEUE_OPTIONS.defaultJobOptions?.removeOnFail,
      ).toBe(false);
    });
  });

  describe("onModuleDestroy", () => {
    it("should close the queue connection cleanly", async () => {
      await queueService.onModuleDestroy();
      expect(mockQueue.close).toHaveBeenCalled();
      expect(queueService.getQueue()).toBeNull();
    });
  });
});
