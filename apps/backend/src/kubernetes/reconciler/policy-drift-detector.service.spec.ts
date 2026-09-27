import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ExceptionStatus } from "@prisma/client";
import { KubernetesObject } from "@kubernetes/client-node";
import { PrismaService } from "../../prisma/prisma.service";
import { IncidentsService } from "../../incidents/incidents.service";
import { K8sInformerService } from "../k8s-informer.service";
import { KyvernoAdapter } from "../kyverno.adapter";
import {
  computeSpecHash,
  normalizeObject,
  PolicyDriftDetectorService,
} from "./policy-drift-detector.service";
import { buildPolicyExceptionManifest } from "../policy-exception-manifest";

type K8sResourceWithSpec = KubernetesObject & { spec?: unknown };

describe("PolicyDriftDetectorService", () => {
  let service: PolicyDriftDetectorService;
  let mockInformerService: {
    registerChangeListener: jest.Mock;
  };
  let mockPrismaService: {
    policyExceptionRequest: {
      findFirst: jest.Mock;
    };
  };
  let mockIncidentsService: {
    recordAdmissionBlock: jest.Mock;
  };
  let mockKyvernoAdapter: {
    restorePolicyException: jest.Mock;
    createClusterPolicy?: jest.Mock;
    updateClusterPolicy?: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };

  const sampleClusterId = "prod-cluster-1";
  const sampleExceptionName = "allow-root-pod";
  const sampleRequestId = "0191f630-3333-7777-8888-000000000001";

  const sampleDbRequest = {
    id: sampleRequestId,
    status: ExceptionStatus.APPROVED,
    reason: "Legacy workload migration",
    policyName: "disallow-privileged",
    ruleNames: ["check-privileged"],
    appliedRuleNames: ["check-privileged"],
    resourceKind: "Deployment",
    resourceName: "legacy-worker",
    resourceNamespace: "workloads",
    targetClusterId: sampleClusterId,
    targetClusterDisplayName: "Production Cluster 1",
    k8sExceptionName: sampleExceptionName,
    expiresAt: new Date(Date.now() + 86400000),
    applyAttempts: 0,
    lastError: null,
    nextAttemptAt: null,
    reconcileClaimId: null,
    reconcileLeaseUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    requestUserId: "user-1",
    approverUserId: "admin-1",
  };

  beforeEach(async () => {
    mockInformerService = {
      registerChangeListener: jest.fn().mockReturnValue(jest.fn()),
    };

    mockPrismaService = {
      policyExceptionRequest: {
        findFirst: jest.fn(),
      },
    };

    mockIncidentsService = {
      recordAdmissionBlock: jest.fn().mockResolvedValue({ id: "incident-1" }),
    };

    mockKyvernoAdapter = {
      restorePolicyException: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === "DRIFT_AUTO_HEAL_ENABLED") return "true";
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyDriftDetectorService,
        { provide: K8sInformerService, useValue: mockInformerService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: IncidentsService, useValue: mockIncidentsService },
        { provide: KyvernoAdapter, useValue: mockKyvernoAdapter },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PolicyDriftDetectorService>(
      PolicyDriftDetectorService,
    );
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("Hashing and Normalization Utility Functions", () => {
    it("normalizes object keys in alphabetical order regardless of original key order", () => {
      const obj1 = { b: 2, a: 1, c: { y: "world", x: "hello" } };
      const obj2 = { a: 1, c: { x: "hello", y: "world" }, b: 2 };

      const normalized1 = normalizeObject(obj1);
      const normalized2 = normalizeObject(obj2);

      expect(JSON.stringify(normalized1)).toBe(JSON.stringify(normalized2));
    });

    it("generates identical SHA-256 hash for objects with identical data but different key orders", () => {
      const spec1 = {
        exceptions: [
          { policyName: "disallow-root", ruleNames: ["rule-a", "rule-b"] },
        ],
        match: { any: [{ resources: { kinds: ["Pod"], names: ["api-*"] } }] },
      };
      const spec2 = {
        match: { any: [{ resources: { names: ["api-*"], kinds: ["Pod"] } }] },
        exceptions: [
          { ruleNames: ["rule-a", "rule-b"], policyName: "disallow-root" },
        ],
      };

      const hash1 = computeSpecHash(spec1);
      const hash2 = computeSpecHash(spec2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    it("generates distinct SHA-256 hashes when spec content differs", () => {
      const spec1 = {
        exceptions: [{ policyName: "disallow-root", ruleNames: ["rule-a"] }],
      };
      const spec2 = {
        exceptions: [{ policyName: "disallow-root", ruleNames: ["rule-b"] }],
      };

      const hash1 = computeSpecHash(spec1);
      const hash2 = computeSpecHash(spec2);

      expect(hash1).not.toBe(hash2);
    });

    it("handles null or undefined spec safely", () => {
      expect(computeSpecHash(null)).toBe(computeSpecHash(undefined));
      expect(computeSpecHash(null)).toHaveLength(64);
    });
  });

  describe("handleResourceMutation", () => {
    it("ignores non-policyexceptions resource types", async () => {
      const result = await service.handleResourceMutation(
        sampleClusterId,
        "clusterpolicies",
        "update",
        { metadata: { name: "some-policy" } },
      );

      expect(result).toBeNull();
      expect(
        mockPrismaService.policyExceptionRequest.findFirst,
      ).not.toHaveBeenCalled();
    });

    it("ignores 'add' event type", async () => {
      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "add",
        { metadata: { name: sampleExceptionName } },
      );

      expect(result).toBeNull();
      expect(
        mockPrismaService.policyExceptionRequest.findFirst,
      ).not.toHaveBeenCalled();
    });

    it("ignores resources without metadata.name", async () => {
      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        { metadata: {} },
      );

      expect(result).toBeNull();
      expect(
        mockPrismaService.policyExceptionRequest.findFirst,
      ).not.toHaveBeenCalled();
    });

    it("returns null when resource is not found in Hub DB", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue(
        null,
      );

      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        { metadata: { name: "untracked-exception" } },
      );

      expect(result).toBeNull();
      expect(mockIncidentsService.recordAdmissionBlock).not.toHaveBeenCalled();
    });

    it("returns null when request is in inactive status (CANCELLED / EXPIRED)", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue({
        ...sampleDbRequest,
        status: ExceptionStatus.CANCELLED,
      });

      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "delete",
        { metadata: { name: sampleExceptionName } },
      );

      expect(result).toBeNull();
      expect(mockIncidentsService.recordAdmissionBlock).not.toHaveBeenCalled();
    });

    it("detects no drift when updated spec matches Hub DB original manifest", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue(
        sampleDbRequest,
      );

      const expectedManifest = buildPolicyExceptionManifest({
        name: sampleDbRequest.k8sExceptionName,
        namespace: sampleDbRequest.resourceNamespace,
        requestId: sampleDbRequest.id,
        policyName: sampleDbRequest.policyName,
        ruleNames: sampleDbRequest.appliedRuleNames,
        resourceKind: sampleDbRequest.resourceKind,
        resourceName: sampleDbRequest.resourceName,
        resourceNamespace: sampleDbRequest.resourceNamespace,
      });

      const updatedObj: K8sResourceWithSpec = {
        metadata: {
          name: sampleExceptionName,
          namespace: "workloads",
        },
        spec: expectedManifest.spec,
      };

      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        updatedObj,
      );

      expect(result).not.toBeNull();
      expect(result?.drifted).toBe(false);
      expect(mockIncidentsService.recordAdmissionBlock).not.toHaveBeenCalled();
      expect(mockKyvernoAdapter.restorePolicyException).not.toHaveBeenCalled();
    });

    it("detects out-of-band mutation when spec is modified, registers incident, and triggers auto-healing", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue(
        sampleDbRequest,
      );

      const mutatedObj: K8sResourceWithSpec = {
        metadata: {
          name: sampleExceptionName,
          namespace: "workloads",
        },
        spec: {
          exceptions: [
            {
              policyName: sampleDbRequest.policyName,
              ruleNames: ["mutated-tampered-rule", "bypass-all"], // 임의 변조된 규칙
            },
          ],
          match: {
            any: [{ resources: { kinds: ["Pod"], names: ["*"] } }],
          },
        },
      };

      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        mutatedObj,
      );

      expect(result).not.toBeNull();
      expect(result?.drifted).toBe(true);
      expect(result?.autoHealed).toBe(true);
      expect(result?.eventType).toBe("update");

      // 인시던트 등록 확인
      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledTimes(
        1,
      );
      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: sampleClusterId,
          resourceKind: "PolicyException",
          resourceName: sampleExceptionName,
          policyName: sampleDbRequest.policyName,
          ruleName: "UNAUTHORIZED_POLICY_MUTATION",
          metadata: expect.objectContaining({
            incidentType: "UNAUTHORIZED_POLICY_MUTATION",
            eventType: "update",
            requestId: sampleRequestId,
          }),
        }),
      );

      // Self-Healing 복구 호출 확인
      expect(mockKyvernoAdapter.restorePolicyException).toHaveBeenCalledTimes(
        1,
      );
      expect(mockKyvernoAdapter.restorePolicyException).toHaveBeenCalledWith(
        sampleClusterId,
        expect.objectContaining({
          name: sampleDbRequest.k8sExceptionName,
          requestId: sampleDbRequest.id,
          policyName: sampleDbRequest.policyName,
          ruleNames: sampleDbRequest.appliedRuleNames,
          resourceKind: sampleDbRequest.resourceKind,
          resourceName: sampleDbRequest.resourceName,
          resourceNamespace: sampleDbRequest.resourceNamespace,
        }),
      );
    });

    it("detects out-of-band deletion when active PolicyException is deleted, registers incident, and restores resource", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue(
        sampleDbRequest,
      );

      const deletedObj: KubernetesObject = {
        metadata: {
          name: sampleExceptionName,
          namespace: "workloads",
        },
      };

      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "delete",
        deletedObj,
      );

      expect(result).not.toBeNull();
      expect(result?.drifted).toBe(true);
      expect(result?.autoHealed).toBe(true);
      expect(result?.eventType).toBe("delete");

      // 인시던트 등록 검증
      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: sampleClusterId,
          ruleName: "UNAUTHORIZED_POLICY_MUTATION",
          blockReason: expect.stringContaining("deleted out-of-band"),
        }),
      );

      // Self-Healing 복구(재배포) 검증
      expect(mockKyvernoAdapter.restorePolicyException).toHaveBeenCalledWith(
        sampleClusterId,
        expect.objectContaining({
          name: sampleDbRequest.k8sExceptionName,
          requestId: sampleDbRequest.id,
        }),
      );
    });

    it("bypasses auto-healing when DRIFT_AUTO_HEAL_ENABLED is set to false", async () => {
      const disabledConfigService = {
        get: jest.fn().mockReturnValue("false"),
      };

      const disabledService = new PolicyDriftDetectorService(
        mockInformerService as any,
        mockPrismaService as any,
        mockIncidentsService as any,
        mockKyvernoAdapter as any,
        disabledConfigService as any,
      );

      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue(
        sampleDbRequest,
      );

      const mutatedObj: K8sResourceWithSpec = {
        metadata: { name: sampleExceptionName },
        spec: { exceptions: [] },
      };

      const result = await disabledService.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        mutatedObj,
      );

      expect(result?.drifted).toBe(true);
      expect(result?.autoHealed).toBe(false);
      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledTimes(
        1,
      );
      expect(mockKyvernoAdapter.restorePolicyException).not.toHaveBeenCalled();
    });

    it("suppresses repeated cascade auto-healing during cooldown window to prevent storm", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockResolvedValue(
        sampleDbRequest,
      );

      const mutatedObj: K8sResourceWithSpec = {
        metadata: { name: sampleExceptionName },
        spec: { exceptions: [] },
      };

      // 1st mutation: trigger auto-heal and set cooldown
      const firstResult = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        mutatedObj,
      );
      expect(firstResult?.drifted).toBe(true);
      expect(firstResult?.autoHealed).toBe(true);
      expect(mockKyvernoAdapter.restorePolicyException).toHaveBeenCalledTimes(
        1,
      );

      // 2nd mutation immediately after: cooldown active, suppress auto-heal
      const secondResult = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        mutatedObj,
      );
      expect(secondResult?.drifted).toBe(true);
      expect(secondResult?.autoHealed).toBe(false);
      // restorePolicyException must not be called again
      expect(mockKyvernoAdapter.restorePolicyException).toHaveBeenCalledTimes(
        1,
      );
    });

    it("handles database query failure gracefully without throwing unhandled exceptions", async () => {
      mockPrismaService.policyExceptionRequest.findFirst.mockRejectedValue(
        new Error("Database connection timeout"),
      );

      const result = await service.handleResourceMutation(
        sampleClusterId,
        "policyexceptions",
        "update",
        { metadata: { name: sampleExceptionName } },
      );

      expect(result).toBeNull();
    });

    describe("ClusterPolicy Drift Detection", () => {
      beforeEach(() => {
        mockKyvernoAdapter.createClusterPolicy = jest
          .fn()
          .mockResolvedValue({});
        mockKyvernoAdapter.updateClusterPolicy = jest
          .fn()
          .mockResolvedValue({});
      });

      it("detects out-of-band mutation on ClusterPolicy, records incident, and triggers auto-healing", async () => {
        const baseline = {
          metadata: { name: "require-labels" },
          spec: {
            validationFailureAction: "Enforce",
            rules: [{ name: "check-labels" }],
          },
        };
        jest
          .spyOn(service, "loadGitOpsPolicyManifest")
          .mockReturnValue(baseline);

        const mutatedK8sObj = {
          metadata: { name: "require-labels" },
          spec: {
            validationFailureAction: "Audit",
            rules: [{ name: "check-labels" }],
          },
        };

        const result = await service.handleResourceMutation(
          sampleClusterId,
          "clusterpolicies",
          "update",
          mutatedK8sObj,
        );

        expect(result).not.toBeNull();
        expect(result?.drifted).toBe(true);
        expect(result?.autoHealed).toBe(true);
        expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceKind: "ClusterPolicy",
            resourceName: "require-labels",
            ruleName: "UNAUTHORIZED_POLICY_MUTATION",
          }),
        );
        expect(mockKyvernoAdapter.updateClusterPolicy).toHaveBeenCalledWith(
          sampleClusterId,
          "require-labels",
          baseline,
        );
      });

      it("detects out-of-band deletion on ClusterPolicy, records incident, and restores resource", async () => {
        const baseline = {
          metadata: { name: "require-labels" },
          spec: { validationFailureAction: "Enforce" },
        };
        jest
          .spyOn(service, "loadGitOpsPolicyManifest")
          .mockReturnValue(baseline);

        const result = await service.handleResourceMutation(
          sampleClusterId,
          "clusterpolicies",
          "delete",
          { metadata: { name: "require-labels" } },
        );

        expect(result?.drifted).toBe(true);
        expect(result?.autoHealed).toBe(true);
        expect(mockKyvernoAdapter.createClusterPolicy).toHaveBeenCalledWith(
          sampleClusterId,
          baseline,
        );
      });

      it("ignores unmanaged ClusterPolicy without GitOps baseline", async () => {
        jest.spyOn(service, "loadGitOpsPolicyManifest").mockReturnValue(null);

        const result = await service.handleResourceMutation(
          sampleClusterId,
          "clusterpolicies",
          "update",
          { metadata: { name: "unknown-policy" } },
        );

        expect(result).toBeNull();
      });
    });
  });

  describe("Lifecycle Integration", () => {
    it("subscribes to Informer change events on onModuleInit and unregisters on onModuleDestroy", async () => {
      const mockUnsubscribe = jest.fn();
      mockInformerService.registerChangeListener.mockReturnValue(
        mockUnsubscribe,
      );

      await service.onModuleInit();
      expect(mockInformerService.registerChangeListener).toHaveBeenCalledTimes(
        1,
      );

      await service.onModuleDestroy();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
