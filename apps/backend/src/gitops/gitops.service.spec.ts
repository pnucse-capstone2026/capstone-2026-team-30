import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GitOpsService } from "./gitops.service";
import { SimulationService } from "../simulation/simulation.service";
import { AiAgentService } from "../ai-agent/ai-agent.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { BusinessException } from "../common/errors/business.exception";
import { GITOPS_ERROR } from "./gitops.errors";
import { GitOpsPrReviewDto } from "./dto/gitops-pr-review.dto";

// Octokit 모킹
const mockCreateComment = jest.fn().mockResolvedValue({
  data: { html_url: "https://github.com/org/repo/pull/42#issuecomment-1" },
});
const mockCreateCommitStatus = jest.fn().mockResolvedValue({ data: {} });

jest.mock("@octokit/rest", () => {
  return {
    Octokit: jest.fn().mockImplementation(() => ({
      rest: {
        issues: {
          createComment: mockCreateComment,
        },
        repos: {
          createCommitStatus: mockCreateCommitStatus,
        },
      },
    })),
  };
});

describe("GitOpsService", () => {
  let service: GitOpsService;
  let simulationService: { validateManifestDryRun: jest.Mock };
  let aiAgentService: { explainKyvernoError: jest.Mock };
  let clusterProvider: { get: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    simulationService = {
      validateManifestDryRun: jest.fn(),
    };

    aiAgentService = {
      explainKyvernoError: jest.fn(),
    };

    clusterProvider = {
      get: jest.fn().mockReturnValue({ id: "default" }),
    };

    const configService = {
      get: jest
        .fn()
        .mockImplementation((key: string, defaultValue?: string) => {
          if (key === "GITOPS_GITHUB_TOKEN") return "fake-gh-token";
          if (key === "PLATFORM_BASE_URL") return "http://dashboard.local";
          return defaultValue;
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitOpsService,
        { provide: SimulationService, useValue: simulationService },
        { provide: AiAgentService, useValue: aiAgentService },
        { provide: ClusterProvider, useValue: clusterProvider },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<GitOpsService>(GitOpsService);
  });

  const baseDto: GitOpsPrReviewDto = {
    repository: "org/repo",
    pullNumber: 42,
    commitSha: "a1b2c3d4e5f6",
    targetNamespace: "test-ns",
    manifestYaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-pod
spec:
  containers:
    - name: c1
      image: test:latest
`,
  };

  it("should return PASSED and dispatch success status when dry-run passes", async () => {
    simulationService.validateManifestDryRun.mockResolvedValueOnce({
      valid: true,
      allowed: true,
      totalResources: 1,
      blockedCount: 0,
      passedCount: 1,
      errorCount: 0,
      results: [
        {
          apiVersion: "v1",
          kind: "Pod",
          name: "test-pod",
          namespace: "test-ns",
          allowed: true,
          status: "PASSED",
          violations: [],
        },
      ],
      allViolations: [],
    });

    const result = await service.reviewPullRequest(baseDto);

    expect(result.valid).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe("PASSED");
    expect(result.commitStatus).toBe("success");
    expect(mockCreateCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "org",
        repo: "repo",
        sha: "a1b2c3d4e5f6",
        state: "success",
      }),
    );
    expect(mockCreateComment).toHaveBeenCalled();
  });

  it("should return BLOCKED, dispatch failure status and build deep-link when dry-run fails", async () => {
    simulationService.validateManifestDryRun
      // 1차 dry-run 실패
      .mockResolvedValueOnce({
        valid: false,
        allowed: false,
        totalResources: 1,
        blockedCount: 1,
        passedCount: 0,
        errorCount: 0,
        results: [
          {
            apiVersion: "v1",
            kind: "Pod",
            name: "test-pod",
            namespace: "test-ns",
            allowed: false,
            status: "BLOCKED",
            blockedReason: "Tag :latest is forbidden",
            violations: [
              {
                policyName: "disallow-latest-tag",
                ruleName: "disallow-latest-tag",
                reason: "Tag :latest is forbidden",
              },
            ],
          },
        ],
        allViolations: [
          {
            policyName: "disallow-latest-tag",
            ruleName: "disallow-latest-tag",
            reason: "Tag :latest is forbidden",
          },
        ],
      })
      // AI 수정안 재검증 성공
      .mockResolvedValueOnce({
        valid: true,
        allowed: true,
        totalResources: 1,
        blockedCount: 0,
        passedCount: 1,
        errorCount: 0,
        results: [],
        allViolations: [],
      });

    aiAgentService.explainKyvernoError.mockResolvedValueOnce({
      summary: "최신 태그 사용이 금지되었습니다.",
      suggestedFixYaml: `image: test:1.0.0`,
    });

    const result = await service.reviewPullRequest(baseDto);

    expect(result.valid).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.status).toBe("BLOCKED");
    expect(result.commitStatus).toBe("failure");
    expect(result.suggestedDiff).toBe("image: test:1.0.0");
    expect(result.exceptionDeepLink).toContain(
      "http://dashboard.local/exceptions/new",
    );
    expect(result.exceptionDeepLink).toContain("repo=org%2Frepo");
    expect(result.exceptionDeepLink).toContain("pr=42");
    expect(result.exceptionDeepLink).toContain("policy=disallow-latest-tag");

    expect(mockCreateCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "failure",
      }),
    );
  });

  it("should fallback to guidance when AI fix fails self-correction re-validation", async () => {
    simulationService.validateManifestDryRun
      // 1차 dry-run 실패
      .mockResolvedValueOnce({
        valid: false,
        allowed: false,
        totalResources: 1,
        blockedCount: 1,
        passedCount: 0,
        errorCount: 0,
        results: [
          {
            apiVersion: "v1",
            kind: "Pod",
            name: "test-pod",
            namespace: "test-ns",
            allowed: false,
            status: "BLOCKED",
            violations: [
              { policyName: "p1", ruleName: "r1", reason: "denied" },
            ],
          },
        ],
        allViolations: [{ policyName: "p1", ruleName: "r1", reason: "denied" }],
      })
      // AI 수정안 2차 dry-run도 실패
      .mockResolvedValueOnce({
        valid: false,
        allowed: false,
        totalResources: 1,
        blockedCount: 1,
        passedCount: 0,
        errorCount: 0,
        results: [],
        allViolations: [
          { policyName: "p1", ruleName: "r1", reason: "still denied" },
        ],
      });

    aiAgentService.explainKyvernoError.mockResolvedValueOnce({
      summary: "보안 컨텍스트 필요",
      resolutionSteps: ["Step 1: runAsNonRoot 설정"],
      suggestedFixYaml: `bad: yaml`,
    });

    const result = await service.reviewPullRequest(baseDto);

    expect(result.suggestedDiff).toContain("권장 조치 가이드");
    expect(result.suggestedDiff).toContain("Step 1: runAsNonRoot 설정");
  });

  it("should throw CLUSTER_NOT_FOUND when clusterProvider does not recognize cluster", async () => {
    clusterProvider.get.mockImplementationOnce(() => {
      throw new Error("Cluster not found");
    });

    await expect(service.reviewPullRequest(baseDto)).rejects.toThrow(
      new BusinessException(GITOPS_ERROR.CLUSTER_NOT_FOUND),
    );
  });
});
