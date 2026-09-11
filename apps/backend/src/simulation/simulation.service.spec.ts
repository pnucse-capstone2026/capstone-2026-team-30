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

  const mockKubeConfig = {
    makeApiClient: jest.fn().mockReturnValue(mockCoreV1Api),
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
});
