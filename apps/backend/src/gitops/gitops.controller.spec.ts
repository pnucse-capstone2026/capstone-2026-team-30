import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GitOpsController } from "./gitops.controller";
import { GitOpsService } from "./gitops.service";
import {
  GitOpsPrReviewDto,
  GitOpsPrReviewResultDto,
} from "./dto/gitops-pr-review.dto";
import { GitOpsPrReviewQueue } from "./queues/gitops-pr-review.queue";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "./providers/vcs-provider.interface";

describe("GitOpsController", () => {
  let controller: GitOpsController;
  let prReviewQueue: { addReviewJob: jest.Mock };
  let gitOpsService: { reviewPullRequest: jest.Mock };
  let vcsProvider: Partial<VcsProvider>;

  beforeEach(async () => {
    prReviewQueue = {
      addReviewJob: jest.fn(),
    };

    gitOpsService = {
      reviewPullRequest: jest.fn(),
    };

    vcsProvider = {
      createCheckRun: jest.fn().mockResolvedValue(98765),
      updateCheckRun: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitOpsController],
      providers: [
        { provide: GitOpsService, useValue: gitOpsService },
        { provide: GitOpsPrReviewQueue, useValue: prReviewQueue },
        { provide: VCS_PROVIDER_TOKEN, useValue: vcsProvider },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("mock-token") },
        },
      ],
    }).compile();

    controller = module.get<GitOpsController>(GitOpsController);
  });

  it("should create queued Check Run and enqueue job into BullMQ returning 202 response", async () => {
    const dto: GitOpsPrReviewDto = {
      repository: "org/repo",
      pullNumber: 10,
      commitSha: "sha123",
      targetNamespace: "default",
      manifestYaml: "apiVersion: v1\nkind: Pod",
    };

    prReviewQueue.addReviewJob.mockResolvedValueOnce({
      id: "pr-org-repo-10-abc12345",
      status: "queued",
      checkRunId: 98765,
    });

    const result = await controller.reviewPullRequest(dto);

    expect(vcsProvider.createCheckRun).toHaveBeenCalledWith({
      repository: "org/repo",
      commitSha: "sha123",
      name: "kyverno/pr-review-gate",
      status: "queued",
      title: "Kyverno Policy Validation Queued",
      summary: expect.stringContaining("BullMQ"),
    });

    expect(prReviewQueue.addReviewJob).toHaveBeenCalledWith(dto, 98765);
    expect(result).toEqual({
      jobId: "pr-org-repo-10-abc12345",
      status: "queued",
      checkRunId: 98765,
    });
  });

  it("should gracefully handle Check Run creation failure and still enqueue job", async () => {
    const dto: GitOpsPrReviewDto = {
      repository: "org/repo",
      pullNumber: 10,
      commitSha: "sha123",
      targetNamespace: "default",
      manifestYaml: "apiVersion: v1\nkind: Pod",
    };

    (vcsProvider.createCheckRun as jest.Mock).mockRejectedValueOnce(
      new Error("API rate limit exceeded"),
    );

    prReviewQueue.addReviewJob.mockResolvedValueOnce({
      id: "fallback-uuid",
      status: "queued",
      checkRunId: undefined,
    });

    const result = await controller.reviewPullRequest(dto);

    expect(prReviewQueue.addReviewJob).toHaveBeenCalledWith(dto, undefined);
    expect(result).toEqual({
      jobId: "fallback-uuid",
      status: "queued",
      checkRunId: undefined,
    });
  });

  it("should perform immediate synchronous review when ?sync=true is provided", async () => {
    const dto: GitOpsPrReviewDto = {
      repository: "org/repo",
      pullNumber: 10,
      commitSha: "sha123",
      targetNamespace: "default",
      manifestYaml: "apiVersion: v1\nkind: Pod",
    };

    const mockSyncResult: GitOpsPrReviewResultDto = {
      valid: true,
      dryRunPassed: true,
      blocked: false,
      totalResources: 1,
      blockedCount: 0,
      status: "PASSED",
      violations: [],
    };

    gitOpsService.reviewPullRequest.mockResolvedValueOnce(mockSyncResult);
    const mockRes = { status: jest.fn() } as any;

    const result = await controller.reviewPullRequest(dto, "true", mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(gitOpsService.reviewPullRequest).toHaveBeenCalledWith(dto);
    expect(prReviewQueue.addReviewJob).not.toHaveBeenCalled();
    expect(vcsProvider.createCheckRun).not.toHaveBeenCalled();
    expect(result).toEqual(mockSyncResult);
  });

  it("should perform immediate synchronous review when dto.async is false", async () => {
    const dto: GitOpsPrReviewDto = {
      repository: "org/repo",
      pullNumber: 10,
      commitSha: "sha123",
      targetNamespace: "default",
      manifestYaml: "apiVersion: v1\nkind: Pod",
      async: false,
    };

    const mockSyncResult: GitOpsPrReviewResultDto = {
      valid: false,
      dryRunPassed: false,
      blocked: true,
      totalResources: 1,
      blockedCount: 1,
      status: "BLOCKED",
      violations: [],
    };

    gitOpsService.reviewPullRequest.mockResolvedValueOnce(mockSyncResult);
    const mockRes = { status: jest.fn() } as any;

    const result = await controller.reviewPullRequest(dto, undefined, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(gitOpsService.reviewPullRequest).toHaveBeenCalledWith(dto);
    expect(prReviewQueue.addReviewJob).not.toHaveBeenCalled();
    expect(result).toEqual(mockSyncResult);
  });

  it("should failover to inline synchronous review when queue returns fallback_sync", async () => {
    const dto: GitOpsPrReviewDto = {
      repository: "org/repo",
      pullNumber: 10,
      commitSha: "sha123",
      targetNamespace: "default",
      manifestYaml: "apiVersion: v1\nkind: Pod",
    };

    const mockSyncResult: GitOpsPrReviewResultDto = {
      valid: true,
      dryRunPassed: true,
      blocked: false,
      totalResources: 1,
      blockedCount: 0,
      status: "PASSED",
      violations: [],
    };

    prReviewQueue.addReviewJob.mockResolvedValueOnce({
      id: "fallback-sync-12345",
      status: "fallback_sync",
      checkRunId: 98765,
    });
    gitOpsService.reviewPullRequest.mockResolvedValueOnce(mockSyncResult);
    const mockRes = { status: jest.fn() } as any;

    const result = await controller.reviewPullRequest(dto, undefined, mockRes);

    expect(prReviewQueue.addReviewJob).toHaveBeenCalledWith(dto, 98765);
    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(gitOpsService.reviewPullRequest).toHaveBeenCalledWith(dto);
    expect(result).toEqual(mockSyncResult);
  });
});
