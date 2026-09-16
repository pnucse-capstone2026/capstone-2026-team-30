import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Job, Queue, Worker } from "bullmq";
import {
  DEFAULT_PR_REVIEW_WORKER_OPTIONS,
  GITOPS_PR_REVIEW_DLQ_NAME,
  GitOpsPrReviewWorker,
  INJECTED_BULLMQ_DLQ,
  INJECTED_BULLMQ_WORKER,
  PrReviewDlqJobData,
} from "./gitops-pr-review.worker";
import { GitOpsService } from "../gitops.service";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "../providers/vcs-provider.interface";
import {
  GitOpsPrReviewDto,
  GitOpsPrReviewResultDto,
} from "../dto/gitops-pr-review.dto";
import { PrReviewJobData } from "./gitops-pr-review.queue";

describe("GitOpsPrReviewWorker", () => {
  let workerService: GitOpsPrReviewWorker;
  let mockGitOpsService: { reviewPullRequest: jest.Mock };
  let mockVcsProvider: Partial<VcsProvider>;
  let mockWorker: jest.Mocked<
    Partial<Worker<PrReviewJobData, GitOpsPrReviewResultDto>>
  >;
  let mockDlqQueue: jest.Mocked<Partial<Queue<PrReviewDlqJobData>>>;

  const mockDto: GitOpsPrReviewDto = {
    repository: "org/repo",
    pullNumber: 42,
    commitSha: "sha123456",
    targetNamespace: "default",
    manifestYaml: "apiVersion: apps/v1\nkind: Deployment",
  };

  const createMockJob = (
    attemptsMade = 0,
    maxAttempts = 3,
    checkRunId: number | string = 12345,
  ): Job<PrReviewJobData, GitOpsPrReviewResultDto> =>
    ({
      id: "job-1",
      data: {
        dto: mockDto,
        checkRunId,
        enqueuedAt: new Date().toISOString(),
      },
      opts: {
        attempts: maxAttempts,
      },
      attemptsMade,
    }) as unknown as Job<PrReviewJobData, GitOpsPrReviewResultDto>;

  beforeEach(async () => {
    mockGitOpsService = {
      reviewPullRequest: jest.fn(),
    };

    mockVcsProvider = {
      updateCheckRun: jest.fn().mockResolvedValue(undefined),
      createCheckRun: jest.fn().mockResolvedValue(12345),
    };

    mockWorker = {
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    mockDlqQueue = {
      add: jest
        .fn()
        .mockResolvedValue({
          id: "dlq-1",
        } as unknown as Job<PrReviewDlqJobData>),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitOpsPrReviewWorker,
        { provide: GitOpsService, useValue: mockGitOpsService },
        { provide: VCS_PROVIDER_TOKEN, useValue: mockVcsProvider },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined),
          },
        },
        {
          provide: INJECTED_BULLMQ_WORKER,
          useValue: mockWorker,
        },
        {
          provide: INJECTED_BULLMQ_DLQ,
          useValue: mockDlqQueue,
        },
      ],
    }).compile();

    workerService = module.get<GitOpsPrReviewWorker>(GitOpsPrReviewWorker);
  });

  afterEach(async () => {
    await workerService.onModuleDestroy();
  });

  describe("processJob", () => {
    it("should update Check Run to in_progress, process review and complete with success when passed", async () => {
      const mockResult: GitOpsPrReviewResultDto = {
        valid: true,
        dryRunPassed: true,
        blocked: false,
        totalResources: 1,
        blockedCount: 0,
        status: "PASSED",
        violations: [],
      };
      mockGitOpsService.reviewPullRequest.mockResolvedValueOnce(mockResult);

      const job = createMockJob(0, 3, 12345);
      const result = await workerService.processJob(job);

      expect(mockVcsProvider.updateCheckRun).toHaveBeenNthCalledWith(1, {
        repository: "org/repo",
        commitSha: "sha123456",
        name: "kyverno/pr-review-gate",
        status: "in_progress",
        title: "Kyverno Policy Validation In Progress",
        summary:
          "Executing Server-Side Dry-Run validation with Bedrock review.",
        checkRunId: 12345,
      });

      expect(mockGitOpsService.reviewPullRequest).toHaveBeenCalledWith(mockDto);

      expect(mockVcsProvider.updateCheckRun).toHaveBeenNthCalledWith(2, {
        repository: "org/repo",
        commitSha: "sha123456",
        name: "kyverno/pr-review-gate",
        status: "completed",
        conclusion: "success",
        title: "Kyverno Policy Gate: Passed",
        summary: "All 1 resources passed Server-Side Dry-Run validation.",
        checkRunId: 12345,
      });

      expect(result).toBe(mockResult);
    });

    it("should complete Check Run with failure when policy violations block the PR", async () => {
      const mockResult: GitOpsPrReviewResultDto = {
        valid: false,
        dryRunPassed: false,
        blocked: true,
        totalResources: 1,
        blockedCount: 2,
        status: "BLOCKED",
        violations: [],
      };
      mockGitOpsService.reviewPullRequest.mockResolvedValueOnce(mockResult);

      const job = createMockJob(0, 3, 12345);
      const result = await workerService.processJob(job);

      expect(mockVcsProvider.updateCheckRun).toHaveBeenNthCalledWith(2, {
        repository: "org/repo",
        commitSha: "sha123456",
        name: "kyverno/pr-review-gate",
        status: "completed",
        conclusion: "failure",
        title: "Kyverno Blocked: 2 Violations Found",
        summary: "Detected 2 blocking Kyverno policy violation(s).",
        checkRunId: 12345,
      });

      expect(result).toBe(mockResult);
    });

    it("should rethrow error without DLQ routing or marking completed failure if attempts remain", async () => {
      mockGitOpsService.reviewPullRequest.mockRejectedValueOnce(
        new Error("Bedrock ThrottlingException 429"),
      );

      const job = createMockJob(0, 3, 12345); // attempt 0 of 3

      await expect(workerService.processJob(job)).rejects.toThrow(
        "Bedrock ThrottlingException 429",
      );

      // Only in_progress called, completed not called
      expect(mockVcsProvider.updateCheckRun).toHaveBeenCalledTimes(1);
      expect(mockVcsProvider.updateCheckRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: "in_progress" }),
      );
      expect(mockDlqQueue.add).not.toHaveBeenCalled();
    });

    it("should route job to DLQ and mark Check Run as completed failure when final retry attempt fails", async () => {
      mockGitOpsService.reviewPullRequest.mockRejectedValueOnce(
        new Error("Final attempt failure"),
      );

      const job = createMockJob(2, 3, 12345); // attempt 2 of 3 (final attempt)

      await expect(workerService.processJob(job)).rejects.toThrow(
        "Final attempt failure",
      );

      // 1. DLQ Enqueue verification
      expect(mockDlqQueue.add).toHaveBeenCalledTimes(1);
      expect(mockDlqQueue.add).toHaveBeenCalledWith("failed-review", {
        originalJobId: "job-1",
        dto: mockDto,
        checkRunId: 12345,
        failedReason: "Final attempt failure",
        failedAt: expect.any(String),
        errorStack: expect.any(String),
      });

      // 2. Check Run completed failure verification
      expect(mockVcsProvider.updateCheckRun).toHaveBeenCalledTimes(2);
      expect(mockVcsProvider.updateCheckRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "completed",
          conclusion: "failure",
          title: "Kyverno PR Review Failed after retries",
          summary: expect.stringContaining("routed to DLQ"),
        }),
      );
    });

    it("should gracefully rethrow even if DLQ add throws an error on final attempt failure", async () => {
      mockGitOpsService.reviewPullRequest.mockRejectedValueOnce(
        new Error("Final attempt failure"),
      );
      (mockDlqQueue.add as jest.Mock).mockRejectedValueOnce(
        new Error("DLQ Redis connection failure"),
      );

      const job = createMockJob(2, 3, 12345);

      await expect(workerService.processJob(job)).rejects.toThrow(
        "Final attempt failure",
      );

      expect(mockVcsProvider.updateCheckRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "completed",
          conclusion: "failure",
        }),
      );
    });
  });

  describe("DEFAULT_PR_REVIEW_WORKER_OPTIONS", () => {
    it("should configure concurrency of 5 and Bedrock rate limiter of 40 jobs per 60 seconds", () => {
      expect(DEFAULT_PR_REVIEW_WORKER_OPTIONS.concurrency).toBe(5);
      expect(DEFAULT_PR_REVIEW_WORKER_OPTIONS.limiter).toEqual({
        max: 40,
        duration: 60000,
      });
    });

    it("should export correct DLQ queue name constant", () => {
      expect(GITOPS_PR_REVIEW_DLQ_NAME).toBe("gitops-pr-review-dlq");
    });
  });

  describe("onModuleDestroy", () => {
    it("should close both worker and DLQ queue connection cleanly", async () => {
      await workerService.onModuleDestroy();
      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockDlqQueue.close).toHaveBeenCalled();
      expect(workerService.getWorker()).toBeNull();
      expect(workerService.getDlqQueue()).toBeNull();
    });
  });
});
