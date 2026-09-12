import { Test, TestingModule } from "@nestjs/testing";
import { SimulationService } from "./simulation.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { BusinessException } from "../common/errors/business.exception";

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
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
