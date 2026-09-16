import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GitOpsService } from "./gitops.service";
import { SimulationService } from "../simulation/simulation.service";
import { AiAgentService } from "../ai-agent/ai-agent.service";
import { KyvernoRuleTemplateEngine } from "../ai-agent/rule-template.engine";
import { InMemoryFastFailEngine } from "../simulation/fast-fail/in-memory-fast-fail.engine";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { BusinessException } from "../common/errors/business.exception";
import { GITOPS_ERROR } from "./gitops.errors";
import { GitOpsPrReviewDto } from "./dto/gitops-pr-review.dto";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "./providers/vcs-provider.interface";

// VcsProvider 모킹
const mockPostReviewComment = jest
  .fn()
  .mockResolvedValue("https://github.com/org/repo/pull/42#issuecomment-1");
const mockSetCommitStatus = jest.fn().mockResolvedValue(undefined);

const mockVcsProvider: jest.Mocked<VcsProvider> = {
  providerType: "GITHUB",
  createPullRequest: jest.fn(),
  postReviewComment: mockPostReviewComment,
  setCommitStatus: mockSetCommitStatus,
};

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
        KyvernoRuleTemplateEngine,
        InMemoryFastFailEngine,
        { provide: SimulationService, useValue: simulationService },
        { provide: AiAgentService, useValue: aiAgentService },
        { provide: ClusterProvider, useValue: clusterProvider },
        { provide: ConfigService, useValue: configService },
        { provide: VCS_PROVIDER_TOKEN, useValue: mockVcsProvider },
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
  labels:
    app.kubernetes.io/name: test-pod
    team: platform
spec:
  securityContext:
    runAsNonRoot: true
  containers:
    - name: c1
      image: test:1.0.0
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 200m
          memory: 256Mi
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
    expect(mockSetCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "org/repo",
        commitSha: "a1b2c3d4e5f6",
        state: "success",
      }),
    );
    expect(mockPostReviewComment).toHaveBeenCalled();
  });

  it("should return BLOCKED and AI fix immediately when 1st dry-run passes", async () => {
    simulationService.validateManifestDryRun
      // 1. 초기 PR dry-run 검증 실패
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
      // 2. 1차 AI 수정안 dry-run 재검증 즉시 통과
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

    expect(mockSetCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "failure",
      }),
    );

    expect(mockPostReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentMarkdown: expect.stringContaining("[AI Self-Correction Passed]"),
      }),
    );
    expect(mockPostReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentMarkdown: expect.stringContaining(
          "```suggestion\nimage: test:1.0.0\n```",
        ),
      }),
    );
    expect(aiAgentService.explainKyvernoError).toHaveBeenCalledTimes(1);
    expect(simulationService.validateManifestDryRun).toHaveBeenCalledTimes(2);
  });

  it("should retry with feedback and return 2nd AI fix when 1st attempt fails and 2nd attempt passes", async () => {
    simulationService.validateManifestDryRun
      // 1. 초기 PR dry-run 검증 실패
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
              {
                policyName: "require-non-root",
                ruleName: "check-run-as-non-root",
                reason: "Container must run as non-root user",
              },
            ],
          },
        ],
        allViolations: [
          {
            policyName: "require-non-root",
            ruleName: "check-run-as-non-root",
            reason: "Container must run as non-root user",
          },
        ],
      })
      // 2. 1차 AI 수정안 dry-run 재검증 실패
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
              {
                policyName: "require-read-only-rootfs",
                ruleName: "check-read-only-rootfs",
                reason: "Root filesystem must be read-only",
              },
            ],
          },
        ],
        allViolations: [
          {
            policyName: "require-read-only-rootfs",
            ruleName: "check-read-only-rootfs",
            reason: "Root filesystem must be read-only",
          },
        ],
      })
      // 3. 2차 AI 수정안 dry-run 재검증 통과
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

    // 1차 AI 설명 응답
    aiAgentService.explainKyvernoError.mockResolvedValueOnce({
      summary: "Non-root 설정 필요",
      suggestedFixYaml: `securityContext:\n  runAsNonRoot: true`,
    });

    // 2차 AI 설명 응답 (피드백 반영)
    aiAgentService.explainKyvernoError.mockResolvedValueOnce({
      summary: "Non-root 및 ReadOnlyRootFilesystem 설정 완료",
      suggestedFixYaml: `securityContext:\n  runAsNonRoot: true\n  readOnlyRootFilesystem: true`,
    });

    const result = await service.reviewPullRequest(baseDto);

    expect(result.valid).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.status).toBe("BLOCKED");
    expect(result.suggestedDiff).toBe(
      `securityContext:\n  runAsNonRoot: true\n  readOnlyRootFilesystem: true`,
    );

    // AI 서비스 호출 2회 및 피드백 전달 확인
    expect(aiAgentService.explainKyvernoError).toHaveBeenCalledTimes(2);
    expect(aiAgentService.explainKyvernoError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousAttemptYaml: `securityContext:\n  runAsNonRoot: true`,
        validationFeedback: expect.stringContaining("require-read-only-rootfs"),
      }),
    );

    // Dry-run 검증 총 3회 실행 확인 (PR 초기 1회 + 1차 fix 1회 + 2차 fix 1회)
    expect(simulationService.validateManifestDryRun).toHaveBeenCalledTimes(3);

    expect(mockPostReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentMarkdown: expect.stringContaining("[AI Self-Correction Passed]"),
      }),
    );
  });

  it("should fallback to safe guidance when both 1st and 2nd AI fixes fail self-correction re-validation", async () => {
    simulationService.validateManifestDryRun
      // 1. 초기 PR dry-run 실패
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
              { policyName: "p1", ruleName: "r1", reason: "denied 1st" },
            ],
          },
        ],
        allViolations: [
          { policyName: "p1", ruleName: "r1", reason: "denied 1st" },
        ],
      })
      // 2. 1차 AI 수정안 dry-run 재검증 실패
      .mockResolvedValueOnce({
        valid: false,
        allowed: false,
        totalResources: 1,
        blockedCount: 1,
        passedCount: 0,
        errorCount: 0,
        results: [],
        allViolations: [
          { policyName: "p1", ruleName: "r1", reason: "still denied 1st" },
        ],
      })
      // 3. 2차 AI 수정안 dry-run 재검증 실패
      .mockResolvedValueOnce({
        valid: false,
        allowed: false,
        totalResources: 1,
        blockedCount: 1,
        passedCount: 0,
        errorCount: 0,
        results: [],
        allViolations: [
          { policyName: "p1", ruleName: "r1", reason: "still denied 2nd" },
        ],
      });

    // 1차 AI 설명 응답
    aiAgentService.explainKyvernoError.mockResolvedValueOnce({
      summary: "보안 컨텍스트 1차 시도",
      resolutionSteps: ["Step 1: runAsNonRoot 설정"],
      suggestedFixYaml: `bad: yaml 1`,
    });

    // 2차 AI 설명 응답
    aiAgentService.explainKyvernoError.mockResolvedValueOnce({
      summary: "보안 컨텍스트 2차 시도 여전히 오류",
      resolutionSteps: [
        "Step 1: runAsNonRoot 설정",
        "Step 2: 관리자 문의 필요",
      ],
      suggestedFixYaml: `bad: yaml 2`,
    });

    const result = await service.reviewPullRequest(baseDto);

    expect(result.suggestedDiff).toContain(
      "<!-- AI Auto-fix could not pass deterministic policy dry-run verification -->",
    );
    expect(result.suggestedDiff).toContain("권장 조치 가이드");
    expect(result.suggestedDiff).toContain(
      "보안 컨텍스트 2차 시도 여전히 오류",
    );
    expect(result.suggestedDiff).toContain("Step 2: 관리자 문의 필요");

    // 안전 폴백 시 마크다운에 suggestion 블록 대신 안전 가이드 블록 포함 확인
    expect(mockPostReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentMarkdown: expect.stringContaining(
          "AI 권장 조치 가이드 (Manual Review Required)",
        ),
      }),
    );
    expect(mockPostReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentMarkdown: expect.not.stringContaining(
          "[AI Self-Correction Passed]",
        ),
      }),
    );
  });

  it("should throw CLUSTER_NOT_FOUND when clusterProvider does not recognize cluster", async () => {
    clusterProvider.get.mockImplementationOnce(() => {
      throw new Error("Cluster not found");
    });

    await expect(service.reviewPullRequest(baseDto)).rejects.toThrow(
      new BusinessException(GITOPS_ERROR.CLUSTER_NOT_FOUND),
    );
  });

  describe("Two-Tier Policy Validation Gate", () => {
    it("should bypass Tier 2 K8s Webhook (0 calls) and trigger AI self-correction when Tier 1 label validation fails", async () => {
      const missingLabelsDto: GitOpsPrReviewDto = {
        repository: "org/repo",
        pullNumber: 42,
        commitSha: "a1b2c3d4e5f6",
        targetNamespace: "test-ns",
        manifestYaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: unlabelled-deployment
spec:
  template:
    spec:
      containers:
        - name: app
          image: app:1.0.0
`,
      };

      aiAgentService.explainKyvernoError.mockResolvedValueOnce({
        summary:
          "Deployment metadata.labels에 'app.kubernetes.io/name' 및 'team' 레이블이 반드시 지정되어야 합니다.",
        resolutionSteps: [
          "metadata.labels에 app.kubernetes.io/name: my-app 지정",
          "metadata.labels에 team: platform 지정",
        ],
      });

      const result = await service.reviewPullRequest(missingLabelsDto);

      // K8s API Server 및 Webhook 호출이 완전히 생략(Bypass)되어 0회 호출되었음을 단언 검증
      expect(simulationService.validateManifestDryRun).not.toHaveBeenCalled();

      // AI 자가 교정 루프가 정상적으로 트리거되었음을 검증
      expect(aiAgentService.explainKyvernoError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining("metadata.labels"),
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.status).toBe("BLOCKED");
      expect(mockPostReviewComment).toHaveBeenCalled();
      expect(mockSetCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "failure",
        }),
      );
    });

    it("should pass Tier 1 and execute Tier 2 validateManifestDryRun when manifest is compliant", async () => {
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

      // Tier 1 통과 후 최종 권위(Authoritative) 관문으로서 실제 K8s validateManifestDryRun 1회 호출 검증
      expect(simulationService.validateManifestDryRun).toHaveBeenCalledTimes(1);
      expect(result.valid).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.status).toBe("PASSED");
    });
  });
});
