import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AiAgentService } from "./ai-agent.service";
import {
  LLM_PROVIDER_TOKEN,
  LlmProvider,
} from "./providers/llm-provider.interface";
import { KyvernoRuleTemplateEngine } from "./rule-template.engine";
import { WorkloadEvaluatorService } from "./services/workload-evaluator.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";

describe("AiAgentService", () => {
  let service: AiAgentService;
  let mockLlmProvider: jest.Mocked<LlmProvider>;

  beforeEach(async () => {
    mockLlmProvider = {
      providerId: "BEDROCK",
      isAvailable: jest.fn().mockReturnValue(true),
      chatCompletion: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue("3500"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAgentService,
        KyvernoRuleTemplateEngine,
        WorkloadEvaluatorService,
        {
          provide: LLM_PROVIDER_TOKEN,
          useValue: mockLlmProvider,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiAgentService>(AiAgentService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should parse valid JSON response from Bedrock model", async () => {
    const mockResponse = JSON.stringify({
      summary: "루트 파일시스템이 읽기 전용으로 설정되어야 합니다.",
      resolutionSteps: ["readOnlyRootFilesystem을 true로 설정하세요."],
      suggestedFixYaml: "securityContext:\n  readOnlyRootFilesystem: true",
      governanceRationale: "클러스터 침입 및 파일 변경 방지 목적으로 규정됨",
    });

    mockLlmProvider.chatCompletion.mockResolvedValue(mockResponse);

    const result = await service.explainKyvernoError({
      errorMessage: "action: deny, rule check-read-only-root-filesystem failed",
    });

    expect(result.summary).toContain("루트 파일시스템");
    expect(result.provider).toBe("BEDROCK");
    expect(result.resolutionSteps).toHaveLength(1);
    expect(result.suggestedFixYaml).toBeDefined();
  });

  it("should fallback gracefully to rule template engine when LLM provider throws an error", async () => {
    mockLlmProvider.chatCompletion.mockRejectedValue(
      new Error("LLM connection error"),
    );

    const result = await service.explainKyvernoError({
      errorMessage:
        "action: deny, rule check-read-only-root-filesystem failed: rootFS must be read-only",
    });

    expect(result.summary).toContain("읽기 전용");
    expect(result.provider).toBe("RULE_ENGINE_FALLBACK");
    expect(result.resolutionSteps.length).toBeGreaterThan(0);
    expect(result.governanceRationale).toBeDefined();
  });

  it("should fallback when LLM provider times out", async () => {
    // 10초 대기하도록 하여 3.5초 타임아웃 유발
    mockLlmProvider.chatCompletion.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("{}"), 10000)),
    );

    const result = await service.explainKyvernoError({
      errorMessage:
        "disallow-latest-tag rule failed: image tag latest is not allowed",
    });

    expect(result.summary).toContain("latest");
    expect(result.provider).toBe("RULE_ENGINE_FALLBACK");
  }, 10000);

  it("should inject active cluster policies into the LLM prompt when kyvernoAdapter is available", async () => {
    const mockClusterProvider = {
      list: jest
        .fn()
        .mockReturnValue([
          { id: "test-cluster", displayName: "Test Cluster", provider: "EKS" },
        ]),
    };
    const mockKyvernoAdapter = {
      listClusterPolicies: jest.fn().mockResolvedValue([
        {
          metadata: { name: "disallow-latest-tag" },
          spec: {
            validationFailureAction: "Enforce",
            rules: [
              {
                name: "require-image-tag",
                validate: { message: "Disallow latest" },
              },
            ],
          },
        },
        {
          metadata: { name: "require-labels" },
          spec: {
            validationFailureAction: "Enforce",
            rules: [
              {
                name: "check-team-label",
                validate: { message: "Team label required" },
              },
            ],
          },
        },
      ]),
    };

    const moduleWithK8s: TestingModule = await Test.createTestingModule({
      providers: [
        AiAgentService,
        KyvernoRuleTemplateEngine,
        WorkloadEvaluatorService,
        {
          provide: LLM_PROVIDER_TOKEN,
          useValue: mockLlmProvider,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("15000") },
        },
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
        {
          provide: KyvernoAdapter,
          useValue: mockKyvernoAdapter,
        },
      ],
    }).compile();

    const customService = moduleWithK8s.get<AiAgentService>(AiAgentService);

    mockLlmProvider.chatCompletion.mockResolvedValue(
      JSON.stringify({
        summary: "검사 완료",
        resolutionSteps: ["조치"],
        suggestedFixYaml: "test",
        governanceRationale: "보안",
      }),
    );

    await customService.explainKyvernoError({
      errorMessage: "disallow-latest-tag rule failed",
      clusterId: "test-cluster",
    });

    expect(mockLlmProvider.chatCompletion).toHaveBeenCalledWith(
      expect.stringContaining("HOLISTIC CLUSTER POLICY COMPLIANCE"),
      expect.stringContaining("Active Kyverno ClusterPolicies in Cluster"),
    );
    expect(mockLlmProvider.chatCompletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("disallow-latest-tag [Mode: Enforce]"),
    );
  });

  it("should cache cluster policies in-memory and avoid duplicate K8s API calls within TTL", async () => {
    const mockClusterProvider = {
      list: jest
        .fn()
        .mockReturnValue([
          { id: "cached-cluster", displayName: "Cached Cluster" },
        ]),
    };
    const mockKyvernoAdapter = {
      listClusterPolicies: jest.fn().mockResolvedValue([
        {
          metadata: { name: "test-policy" },
          spec: { validationFailureAction: "Enforce", rules: [] },
        },
      ]),
    };

    const moduleWithCache: TestingModule = await Test.createTestingModule({
      providers: [
        AiAgentService,
        KyvernoRuleTemplateEngine,
        WorkloadEvaluatorService,
        {
          provide: LLM_PROVIDER_TOKEN,
          useValue: mockLlmProvider,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("15000") },
        },
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
        {
          provide: KyvernoAdapter,
          useValue: mockKyvernoAdapter,
        },
      ],
    }).compile();

    const cachedService = moduleWithCache.get<AiAgentService>(AiAgentService);

    // 첫 번째 호출: KyvernoAdapter.listClusterPolicies 호출됨
    const policies1 =
      await cachedService.getCachedClusterPolicies("cached-cluster");
    expect(policies1).toHaveLength(1);
    expect(mockKyvernoAdapter.listClusterPolicies).toHaveBeenCalledTimes(1);

    // 두 번째 호출: 캐시 히트로 인해 KyvernoAdapter.listClusterPolicies 재호출되지 않음
    const policies2 =
      await cachedService.getCachedClusterPolicies("cached-cluster");
    expect(policies2).toHaveLength(1);
    expect(mockKyvernoAdapter.listClusterPolicies).toHaveBeenCalledTimes(1);
  });

  describe("Cluster Scoping Authorization", () => {
    it("should throw BusinessException(CLUSTER_ACCESS_DENIED) when user does not have access to cluster", async () => {
      const unauthorizedUser = {
        userId: "user-1",
        email: "dev@example.com",
        role: "VIEWER" as const,
        clusterIds: ["cluster-a"],
      };

      await expect(
        service.explainKyvernoError(
          {
            errorMessage: "blocked",
            clusterId: "cluster-unauthorized",
          },
          unauthorizedUser as any,
        ),
      ).rejects.toThrow("User does not have access to the specified cluster");
    });

    it("should allow ADMIN role user to analyze any cluster", async () => {
      const adminUser = {
        userId: "admin-1",
        email: "admin@example.com",
        role: "ADMIN" as const,
        clusterIds: [],
      };

      mockLlmProvider.chatCompletion.mockResolvedValue(
        JSON.stringify({
          summary: "정상 진단",
          resolutionSteps: ["해결"],
          suggestedFixYaml: null,
          governanceRationale: "보안",
        }),
      );

      const result = await service.explainKyvernoError(
        {
          errorMessage: "blocked",
          clusterId: "any-cluster",
        },
        adminUser as any,
      );

      expect(result.summary).toBe("정상 진단");
    });

    it("should provide specialized guidance when isolate-management-hub-cluster error is passed", async () => {
      const result = await service.explainKyvernoError({
        errorMessage:
          "admission webhook denied the request: ❌ [거버넌스 차단] Hub 클러스터(kyverno-eks-lab)는 중앙 관리 제어면 전용입니다. 일반 비즈니스 워크로드는 Argo CD가 관리하는 Production Spoke 클러스터(kyverno-eks-spoke-01)에 배포해야 합니다.",
      });

      expect(result.status).toBe("BLOCKED");
      expect(result.provider).toBe("MULTI_CLUSTER_ISOLATION_EXPLAINER");
      expect(result.summary).toContain(
        "중앙 거버넌스 제어면 전용인 Hub 클러스터",
      );
      expect(result.resolutionSteps[0]).toContain("Production Spoke Cluster");
    });
  });
});
