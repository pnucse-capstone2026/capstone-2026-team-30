import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import {
  DEFAULT_PR_REVIEW_QUEUE_OPTIONS,
  GitOpsPrReviewQueue,
  INJECTED_BULLMQ_QUEUE,
  PrReviewJobData,
} from "./gitops-pr-review.queue";
import { GitOpsPrReviewDto } from "../dto/gitops-pr-review.dto";

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

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
      getJobs: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
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

    it("should return fallback jobId if queue.add throws an error", async () => {
      (mockQueue.add as jest.Mock).mockRejectedValueOnce(
        new Error("Redis connection lost"),
      );

      const result = await queueService.addReviewJob(mockDto, 1002);

      expect(result.id).toMatch(/^fallback-[0-9a-f-]{36}$/);
      expect(result.status).toBe("queued");
      expect(result.checkRunId).toBe(1002);
    });

    it("should return fallback jobId if queue instance is null", async () => {
      // Create instance without injected queue and with invalid redis
      const noQueueService = new GitOpsPrReviewQueue();
      try {
        const result = await noQueueService.addReviewJob(mockDto);

        expect(result.id).toMatch(/^fallback-[0-9a-f-]{36}$/);
        expect(result.status).toBe("queued");
        expect(result.checkRunId).toBeUndefined();
      } finally {
        await noQueueService.onModuleDestroy();
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
