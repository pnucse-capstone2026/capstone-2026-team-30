import { Test, TestingModule } from "@nestjs/testing";
import { V1Lease } from "@kubernetes/client-node";
import {
  COORDINATION_V1_API,
  K8sLeaderElectorService,
} from "./k8s-leader-elector.service";

describe("K8sLeaderElectorService", () => {
  let service: K8sLeaderElectorService;
  let mockCoordinationApi: {
    readNamespacedLease: jest.Mock;
    createNamespacedLease: jest.Mock;
    replaceNamespacedLease: jest.Mock;
  };

  beforeEach(async () => {
    mockCoordinationApi = {
      readNamespacedLease: jest.fn(),
      createNamespacedLease: jest.fn(),
      replaceNamespacedLease: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        K8sLeaderElectorService,
        {
          provide: COORDINATION_V1_API,
          useValue: mockCoordinationApi,
        },
      ],
    }).compile();

    service = module.get<K8sLeaderElectorService>(K8sLeaderElectorService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
    expect(service.getHolderIdentity()).toBeDefined();
    expect(service.isCurrentLeader()).toBe(false);
  });

  describe("Scenario 1: Lease가 없을 때 신규 생성하고 리더 획득", () => {
    it("creates a new lease and triggers onLeaderAcquired callback", async () => {
      // 404 Not Found 시뮬레이션
      mockCoordinationApi.readNamespacedLease.mockRejectedValue({
        statusCode: 404,
        message: "leases.coordination.k8s.io not found",
      });

      const holder = service.getHolderIdentity();
      mockCoordinationApi.createNamespacedLease.mockResolvedValue({
        metadata: {
          name: "kyverno-platform-watcher-lease",
          namespace: "default",
        },
        spec: {
          holderIdentity: holder,
          leaseDurationSeconds: 15,
        },
      } as V1Lease);

      const acquiredCb = jest.fn();
      service.onLeaderAcquired(acquiredCb);

      const result = await service.tryAcquireOrRenew();

      expect(result).toBe(true);
      expect(service.isCurrentLeader()).toBe(true);
      expect(acquiredCb).toHaveBeenCalledTimes(1);
      expect(mockCoordinationApi.createNamespacedLease).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: "default",
          body: expect.objectContaining({
            metadata: expect.objectContaining({
              name: "kyverno-platform-watcher-lease",
              namespace: "default",
            }),
            spec: expect.objectContaining({
              holderIdentity: holder,
              leaseDurationSeconds: 15,
            }),
          }),
        }),
      );
    });
  });

  describe("Scenario 2: 다른 Pod가 유효한 리더를 보유하고 있을 때 Standby 상태 유지", () => {
    it("maintains standby role when another pod holds an active lease", async () => {
      const activeLease: V1Lease = {
        metadata: {
          name: "kyverno-platform-watcher-lease",
          namespace: "default",
          resourceVersion: "12345",
        },
        spec: {
          holderIdentity: "other-active-pod-0",
          leaseDurationSeconds: 15,
          renewTime: new Date(Date.now() - 3000), // 3초 전 갱신 (15초 미경과)
          acquireTime: new Date(Date.now() - 60000),
          leaseTransitions: 1,
        },
      };

      mockCoordinationApi.readNamespacedLease.mockResolvedValue(activeLease);

      const acquiredCb = jest.fn();
      const lostCb = jest.fn();
      service.onLeaderAcquired(acquiredCb);
      service.onLeaderLost(lostCb);

      const result = await service.tryAcquireOrRenew();

      expect(result).toBe(false);
      expect(service.isCurrentLeader()).toBe(false);
      expect(acquiredCb).not.toHaveBeenCalled();
      expect(lostCb).not.toHaveBeenCalled();
      expect(mockCoordinationApi.createNamespacedLease).not.toHaveBeenCalled();
      expect(mockCoordinationApi.replaceNamespacedLease).not.toHaveBeenCalled();
    });
  });

  describe("Scenario 3: 이전 리더의 하트비트가 만료되었을 때 리더십 승계", () => {
    it("takes over expired lease and increments leaseTransitions", async () => {
      const expiredLease: V1Lease = {
        metadata: {
          name: "kyverno-platform-watcher-lease",
          namespace: "default",
          resourceVersion: "5001",
        },
        spec: {
          holderIdentity: "dead-pod-instance",
          leaseDurationSeconds: 15,
          renewTime: new Date(Date.now() - 25000), // 25초 전 갱신 (15초 초과 만료)
          acquireTime: new Date(Date.now() - 100000),
          leaseTransitions: 2,
        },
      };

      mockCoordinationApi.readNamespacedLease.mockResolvedValue(expiredLease);
      mockCoordinationApi.replaceNamespacedLease.mockResolvedValue({
        ...expiredLease,
        metadata: { ...expiredLease.metadata, resourceVersion: "5002" },
        spec: {
          ...expiredLease.spec,
          holderIdentity: service.getHolderIdentity(),
          leaseTransitions: 3,
        },
      });

      const acquiredCb = jest.fn();
      service.onLeaderAcquired(acquiredCb);

      const result = await service.tryAcquireOrRenew();

      expect(result).toBe(true);
      expect(service.isCurrentLeader()).toBe(true);
      expect(acquiredCb).toHaveBeenCalledTimes(1);
      expect(mockCoordinationApi.replaceNamespacedLease).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "kyverno-platform-watcher-lease",
          namespace: "default",
          body: expect.objectContaining({
            metadata: expect.objectContaining({
              resourceVersion: "5001",
            }),
            spec: expect.objectContaining({
              holderIdentity: service.getHolderIdentity(),
              leaseTransitions: 3,
            }),
          }),
        }),
      );
    });
  });

  describe("Scenario 4: 갱신 충돌(409 Conflict) 발생 시 리더십 상실", () => {
    it("relinquishes leadership and triggers onLeaderLost callback upon 409 conflict", async () => {
      const myHolder = service.getHolderIdentity();

      // Step 1: 최초 리더 획득 (신규 생성)
      mockCoordinationApi.readNamespacedLease.mockRejectedValueOnce({
        statusCode: 404,
      });
      mockCoordinationApi.createNamespacedLease.mockResolvedValueOnce({
        metadata: {
          name: "kyverno-platform-watcher-lease",
          resourceVersion: "10",
        },
        spec: { holderIdentity: myHolder, leaseDurationSeconds: 15 },
      });

      const acquiredCb = jest.fn();
      const lostCb = jest.fn();
      service.onLeaderAcquired(acquiredCb);
      service.onLeaderLost(lostCb);

      await service.tryAcquireOrRenew();
      expect(service.isCurrentLeader()).toBe(true);
      expect(acquiredCb).toHaveBeenCalledTimes(1);

      // Step 2: 다음 갱신 주기에서 다른 Pod와 충돌(409 Conflict) 발생
      const existingLease: V1Lease = {
        metadata: {
          name: "kyverno-platform-watcher-lease",
          namespace: "default",
          resourceVersion: "10",
        },
        spec: {
          holderIdentity: myHolder,
          leaseDurationSeconds: 15,
          renewTime: new Date(),
        },
      };

      mockCoordinationApi.readNamespacedLease.mockResolvedValueOnce(
        existingLease,
      );
      mockCoordinationApi.replaceNamespacedLease.mockRejectedValueOnce({
        statusCode: 409,
        response: { statusCode: 409 },
        message:
          "Operation cannot be fulfilled on lease: the object has been modified",
      });

      const renewResult = await service.tryAcquireOrRenew();

      expect(renewResult).toBe(false);
      expect(service.isCurrentLeader()).toBe(false);
      expect(lostCb).toHaveBeenCalledTimes(1);
    });
  });

  describe("Lifecycle & Callback management", () => {
    it("allows unsubscribing from leader callbacks", async () => {
      const acquiredCb = jest.fn();
      const lostCb = jest.fn();

      const unsubAcquired = service.onLeaderAcquired(acquiredCb);
      const unsubLost = service.onLeaderLost(lostCb);

      unsubAcquired();
      unsubLost();

      // 리더 획득 시뮬레이션
      mockCoordinationApi.readNamespacedLease.mockRejectedValue({
        statusCode: 404,
      });
      mockCoordinationApi.createNamespacedLease.mockResolvedValue({});

      await service.tryAcquireOrRenew();
      expect(service.isCurrentLeader()).toBe(true);
      expect(acquiredCb).not.toHaveBeenCalled();

      // stop 호출로 리더십 상실
      service.stop();
      expect(service.isCurrentLeader()).toBe(false);
      expect(lostCb).not.toHaveBeenCalled();
    });
  });
});
