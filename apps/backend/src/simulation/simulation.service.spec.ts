import { Test, TestingModule } from "@nestjs/testing";
import { SimulationService } from "./simulation.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { BusinessException } from "../common/errors/business.exception";
import { InMemoryFastFailEngine } from "./fast-fail/in-memory-fast-fail.engine";

describe("SimulationService", () => {
  let service: SimulationService;

  const mockCoreV1Api = {
    createNamespacedPod: jest.fn(),
    deleteNamespacedPod: jest.fn(),
    listPodForAllNamespaces: jest.fn(),
  };

  const mockKubernetesObjectApi = {
    create: jest.fn(),
  };

  const mockFastFailEngine = {
    evaluateResource: jest.fn().mockReturnValue([]),
  };

  const mockKubeConfig = {
    makeApiClient: jest.fn().mockImplementation((apiClass) => {
      if (apiClass?.name === "KubernetesObjectApi") {
        return mockKubernetesObjectApi;
      }
      return mockCoreV1Api;
    }),
  };

  const mockClusterProvider = {
    getKubeConfig: jest.fn().mockReturnValue(mockKubeConfig),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFastFailEngine.evaluateResource.mockReturnValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
        {
          provide: InMemoryFastFailEngine,
          useValue: mockFastFailEngine,
        },
      ],
    }).compile();

    service = module.get<SimulationService>(SimulationService);
  });

  it("should return predefined simulation scenarios", () => {
    const scenarios = service.getScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.some((s) => s.id === "disallow-latest-tag")).toBe(true);
    expect(scenarios.some((s) => s.id === "disallow-privileged")).toBe(true);
  });

  it("should deploy pod and return ALLOWED when K8s API succeeds", async () => {
    mockCoreV1Api.createNamespacedPod.mockResolvedValueOnce({
      body: { metadata: { name: "test-compliant-pod" } },
    });

    const result = await service.deploySimulation({
      scenarioId: "compliant-workload",
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("ALLOWED");
    expect(result.resourceName).toBe("test-compliant-pod");
  });

  it("should prioritize customYaml over default scenario.yaml when customYaml is provided", async () => {
    mockCoreV1Api.createNamespacedPod.mockResolvedValueOnce({
      body: { metadata: { name: "custom-fixed-pod" } },
    });

    const customYaml = `apiVersion: v1
kind: Pod
metadata:
  name: custom-fixed-pod
  namespace: governance-testbed
  labels:
    app.kubernetes.io/name: simulation-test
    team: devops
spec:
  restartPolicy: Never
  containers:
    - name: test
      image: registry.k8s.io/pause:3.10
`;

    const result = await service.deploySimulation({
      scenarioId: "disallow-latest-tag",
      customYaml,
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("ALLOWED");
    expect(result.resourceName).toBe("custom-fixed-pod");
    expect(mockCoreV1Api.createNamespacedPod).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "governance-testbed",
        body: expect.objectContaining({
          metadata: expect.objectContaining({ name: "custom-fixed-pod" }),
        }),
      }),
    );
  });

  it("should catch admission webhook error and return BLOCKED with details", async () => {
    const webhookError = {
      response: {
        body: {
          message: `admission webhook "validate.kyverno.svc-fail" denied the request: \n\nresource Pod/default/bad-pod was blocked due to the following policies \n\ndisallow-latest-tag:\n  disallow-latest-tag: 'validation error: :latest tag is not allowed'`,
        },
      },
    };

    mockCoreV1Api.createNamespacedPod.mockRejectedValueOnce(webhookError);

    const result = await service.deploySimulation({
      scenarioId: "disallow-latest-tag",
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("BLOCKED");
    expect(result.policyName).toBe("disallow-latest-tag");
    expect(result.exceptionApplicable).toBe(true);
    expect(result.suggestedException).toBeDefined();
  });

  it("should throw BusinessException if scenarioId is invalid", async () => {
    await expect(
      service.deploySimulation({
        scenarioId: "non-existent-scenario",
      }),
    ).rejects.toThrow(BusinessException);
  });

  describe("validateManifestDryRun", () => {
    it("should return PASSED when all manifests pass dry-run validation", async () => {
      mockKubernetesObjectApi.create.mockResolvedValueOnce({
        body: { metadata: { name: "my-deployment" } },
      });

      const yamlContent = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
spec:
  replicas: 1
`;
      const result = await service.validateManifestDryRun(
        yamlContent,
        "default",
      );

      expect(result.valid).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.totalResources).toBe(1);
      expect(result.passedCount).toBe(1);
      expect(result.blockedCount).toBe(0);
      expect(result.results[0].status).toBe("PASSED");
      expect(mockKubernetesObjectApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "Deployment" }),
        undefined,
        "All",
      );
    });

    it("should validate multi-document YAML and collect all results", async () => {
      mockKubernetesObjectApi.create
        .mockResolvedValueOnce({ body: { metadata: { name: "app-deploy" } } })
        .mockResolvedValueOnce({ body: { metadata: { name: "app-service" } } });

      const multiYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-deploy
---
apiVersion: v1
kind: Service
metadata:
  name: app-service
`;
      const result = await service.validateManifestDryRun(multiYaml, "prod");

      expect(result.valid).toBe(true);
      expect(result.totalResources).toBe(2);
      expect(result.passedCount).toBe(2);
      expect(mockKubernetesObjectApi.create).toHaveBeenCalledTimes(2);
    });

    it("should return BLOCKED when Kyverno webhook denies admission in dry-run", async () => {
      const webhookError = new Error(
        `admission webhook "validate.kyverno.svc-fail" denied the request: \n\nresource Pod/prod/test-pod was blocked due to the following policies \n\ndisallow-latest-tag:\n  disallow-latest-tag: 'validation error: Using a :latest tag is prohibited. rule disallow-latest-tag failed at path /spec/containers/0/image/'`,
      );
      (webhookError as unknown as { statusCode: number }).statusCode = 403;

      mockKubernetesObjectApi.create.mockRejectedValueOnce(webhookError);

      const yamlContent = `apiVersion: v1
kind: Pod
metadata:
  name: test-pod
spec:
  containers:
    - name: app
      image: nginx:latest
`;
      const result = await service.validateManifestDryRun(yamlContent, "prod");

      expect(result.valid).toBe(false);
      expect(result.allowed).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.results[0].status).toBe("BLOCKED");
      expect(result.allViolations.length).toBeGreaterThan(0);
      expect(result.allViolations[0].policyName).toBe("disallow-latest-tag");
      expect(result.allViolations[0].ruleName).toBe("disallow-latest-tag");
    });

    it("should bypass K8s webhook create call and return BLOCKED immediately when Tier 1 Fast-Fail detects violations", async () => {
      mockFastFailEngine.evaluateResource.mockReturnValueOnce([
        {
          policyName: "disallow-privileged-containers",
          ruleName: "disallow-privileged-containers",
          reason:
            "privileged: true 옵션이 설정된 특권 컨테이너는 허용되지 않습니다.",
          path: "/spec/template/spec/containers/0/securityContext/privileged",
        },
      ]);

      const yamlContent = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: priv-deployment
spec:
  template:
    spec:
      containers:
        - name: app
          image: nginx:1.27.0
          securityContext:
            privileged: true
`;
      const result = await service.validateManifestDryRun(
        yamlContent,
        "default",
      );

      expect(result.valid).toBe(false);
      expect(result.allowed).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.passedCount).toBe(0);
      expect(result.results[0].status).toBe("BLOCKED");
      expect(result.allViolations).toHaveLength(1);
      expect(result.allViolations[0].policyName).toBe(
        "disallow-privileged-containers",
      );
      // 핵심: 실제 K8s API 서버 create 호출이 완전히 건너뛰어졌는지(0회 호출) 검증
      expect(mockKubernetesObjectApi.create).not.toHaveBeenCalled();
    });

    it("should throw BusinessException for empty or invalid manifest YAML", async () => {
      await expect(
        service.validateManifestDryRun("", "default"),
      ).rejects.toThrow(BusinessException);

      await expect(
        service.validateManifestDryRun("just a plain string", "default"),
      ).rejects.toThrow(BusinessException);
    });
  });
});
