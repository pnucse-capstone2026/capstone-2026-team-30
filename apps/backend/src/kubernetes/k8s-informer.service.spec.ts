import { Test, TestingModule } from "@nestjs/testing";
import { K8sInformerService } from "./k8s-informer.service";
import { ClusterProvider } from "./cluster-provider";
import { KubeConfig } from "@kubernetes/client-node";

const mockMakeInformer = jest.fn();

jest.mock("@kubernetes/client-node", () => {
  const actual = jest.requireActual("@kubernetes/client-node");
  return {
    ...actual,
    makeInformer: (kubeConfig: any, path: string, listFn: any) => {
      mockMakeInformer(kubeConfig, path, listFn);
      return actual.makeInformer(kubeConfig, path, listFn);
    },
  };
});

describe("K8sInformerService", () => {
  let service: K8sInformerService;
  let mockClusterProvider: Partial<ClusterProvider>;

  beforeEach(async () => {
    const mockKubeConfig = new KubeConfig();
    mockKubeConfig.loadFromClusterAndUser(
      {
        name: "test-cluster",
        server: "https://127.0.0.1:6443",
        skipTLSVerify: true,
      },
      { name: "test-user" },
    );

    mockClusterProvider = {
      list: jest.fn().mockReturnValue([
        {
          id: "test-cluster",
          displayName: "Test Cluster",
          exceptionNamespace: "kyverno",
        },
      ]),
      getKubeConfig: jest.fn().mockReturnValue(mockKubeConfig),
      get: jest.fn().mockReturnValue({
        id: "test-cluster",
        displayName: "Test Cluster",
        exceptionNamespace: "kyverno",
        customObjectsApi: {
          listClusterCustomObject: jest.fn().mockResolvedValue({ items: [] }),
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        K8sInformerService,
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
      ],
    }).compile();

    service = module.get<K8sInformerService>(K8sInformerService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("initializes informers on module init without throwing", async () => {
    await expect(service.onModuleInit()).resolves.not.toThrow();
  });

  it("returns null when informer is not yet ready or empty without error", () => {
    const reports = service.listNamespacedPolicyReports(
      "test-cluster",
      "default",
    );
    expect(reports === null || Array.isArray(reports)).toBe(true);
  });

  it("supports registering resource change listeners and cleanly unregistering", () => {
    const listener = jest.fn();
    const unsubscribe = service.onResourceChange(listener);
    expect(typeof unsubscribe).toBe("function");

    unsubscribe();
  });

  it("safely stops all informers on module destroy", async () => {
    await service.onModuleInit();
    await expect(service.onModuleDestroy()).resolves.not.toThrow();
  });

  describe("Leader Election Lifecycle Integration", () => {
    it("starts informers only on onLeaderAcquired and stops on onLeaderLost", async () => {
      let acquiredCallback: () => void = () => {};
      let lostCallback: () => void = () => {};

      const mockLeaderElector = {
        onLeaderAcquired: jest.fn().mockImplementation((cb) => {
          acquiredCallback = cb;
        }),
        onLeaderLost: jest.fn().mockImplementation((cb) => {
          lostCallback = cb;
        }),
      };

      const informerService = new K8sInformerService(
        mockClusterProvider as ClusterProvider,
        mockLeaderElector as any,
      );

      const startSpy = jest.spyOn(informerService, "start");
      const stopSpy = jest.spyOn(informerService, "stop");

      await informerService.onModuleInit();

      expect(mockLeaderElector.onLeaderAcquired).toHaveBeenCalledTimes(1);
      expect(mockLeaderElector.onLeaderLost).toHaveBeenCalledTimes(1);
      // 리더 획득 전에는 start()가 호출되지 않음
      expect(startSpy).not.toHaveBeenCalled();

      // 리더 획득 시뮬레이션
      acquiredCallback();
      expect(startSpy).toHaveBeenCalledTimes(1);

      // 리더 상실 시뮬레이션
      lostCallback();
      expect(stopSpy).toHaveBeenCalledTimes(1);

      // 모듈 종료 시뮬레이션
      await informerService.onModuleDestroy();
      expect(stopSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("PolicyException RBAC Fallback", () => {
    const getPolicyExceptionListFn = () => {
      const call = mockMakeInformer.mock.calls.find(
        (args) =>
          typeof args[1] === "string" && args[1].includes("policyexceptions"),
      );
      return call ? (call[2] as () => Promise<any>) : undefined;
    };

    beforeEach(() => {
      mockMakeInformer.mockClear();
    });

    it("falls back to listNamespacedCustomObject when listClusterCustomObject returns 403 (statusCode)", async () => {
      const listNamespacedCustomObjectMock = jest.fn().mockResolvedValue({
        items: [
          { metadata: { name: "namespaced-exception", namespace: "kyverno" } },
        ],
      });
      const listClusterCustomObjectMock = jest.fn().mockRejectedValue({
        statusCode: 403,
      });

      const mockCluster = {
        id: "test-cluster",
        displayName: "Test Cluster",
        exceptionNamespace: "kyverno",
        customObjectsApi: {
          listClusterCustomObject: listClusterCustomObjectMock,
          listNamespacedCustomObject: listNamespacedCustomObjectMock,
        },
      };

      (mockClusterProvider.get as jest.Mock).mockReturnValue(mockCluster);

      await service.onModuleInit();

      const policyExceptionListFn = getPolicyExceptionListFn();
      expect(policyExceptionListFn).toBeDefined();

      const result = await policyExceptionListFn!();

      expect(listClusterCustomObjectMock).toHaveBeenCalledWith({
        group: "kyverno.io",
        version: "v2",
        plural: "policyexceptions",
      });

      expect(listNamespacedCustomObjectMock).toHaveBeenCalledWith({
        group: "kyverno.io",
        version: "v2",
        namespace: "kyverno",
        plural: "policyexceptions",
      });

      expect(result).toEqual({
        apiVersion: "kyverno.io/v2",
        kind: "PolicyExceptionList",
        items: [
          { metadata: { name: "namespaced-exception", namespace: "kyverno" } },
        ],
      });
    });

    it("falls back to listNamespacedCustomObject when listClusterCustomObject returns response.statusCode = 403", async () => {
      const listNamespacedCustomObjectMock = jest.fn().mockResolvedValue({
        items: [
          { metadata: { name: "namespaced-exception", namespace: "kyverno" } },
        ],
      });
      const listClusterCustomObjectMock = jest.fn().mockRejectedValue({
        response: { statusCode: 403 },
      });

      const mockCluster = {
        id: "test-cluster",
        displayName: "Test Cluster",
        exceptionNamespace: "kyverno",
        customObjectsApi: {
          listClusterCustomObject: listClusterCustomObjectMock,
          listNamespacedCustomObject: listNamespacedCustomObjectMock,
        },
      };

      (mockClusterProvider.get as jest.Mock).mockReturnValue(mockCluster);

      await service.onModuleInit();

      const policyExceptionListFn = getPolicyExceptionListFn();
      expect(policyExceptionListFn).toBeDefined();

      const result = await policyExceptionListFn!();

      expect(listClusterCustomObjectMock).toHaveBeenCalled();
      expect(listNamespacedCustomObjectMock).toHaveBeenCalledWith({
        group: "kyverno.io",
        version: "v2",
        namespace: "kyverno",
        plural: "policyexceptions",
      });
      expect(result.items).toHaveLength(1);
    });

    it("rethrows error when listClusterCustomObject fails with non-403 error", async () => {
      const error500 = { statusCode: 500, message: "Internal Server Error" };
      const mockCluster = {
        id: "test-cluster",
        displayName: "Test Cluster",
        exceptionNamespace: "kyverno",
        customObjectsApi: {
          listClusterCustomObject: jest.fn().mockRejectedValue(error500),
          listNamespacedCustomObject: jest.fn(),
        },
      };

      (mockClusterProvider.get as jest.Mock).mockReturnValue(mockCluster);

      await service.onModuleInit();

      const policyExceptionListFn = getPolicyExceptionListFn();
      expect(policyExceptionListFn).toBeDefined();
      await expect(policyExceptionListFn!()).rejects.toEqual(error500);
    });
  });
});
