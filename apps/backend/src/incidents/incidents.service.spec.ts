import { Test, TestingModule } from "@nestjs/testing";
import { ExceptionStatus, IncidentStatus, Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { GitOpsPublisherService } from "../gitops/gitops-publisher.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { PrismaService } from "../prisma/prisma.service";
import { IncidentsEventsService } from "./incidents-events.service";
import { INCIDENT_ERROR } from "./incidents.errors";
import { IncidentsService } from "./incidents.service";

describe("IncidentsService", () => {
  let service: IncidentsService;
  let mockPrisma: any;
  let mockEventsService: any;
  let mockGitOpsPublisher: any;
  let mockClusterProvider: any;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "operator@example.com",
    role: Role.APPROVER,
    clusterIds: ["cluster-alpha", "cluster-beta"],
  };

  const mockAdminUser: AuthenticatedUser = {
    id: "admin-1",
    email: "admin@example.com",
    role: Role.ADMIN,
    clusterIds: [],
  };

  const sampleIncident = {
    id: "inc-1",
    clusterId: "cluster-alpha",
    namespace: "mlops-serving",
    resourceKind: "Deployment",
    resourceName: "deepseek-serving",
    policyName: "disallow-privileged-containers",
    ruleName: "check-privileged",
    blockReason: "Privileged containers are disallowed",
    gitopsAppName: "deepseek-app",
    gitCommitSha: "abc1234",
    gitRepository: "https://github.com/org/gitops-repo",
    status: IncidentStatus.ACTIVE,
    blockCount: 1,
    firstBlockedAt: new Date("2026-09-14T08:00:00Z"),
    lastBlockedAt: new Date("2026-09-14T08:00:00Z"),
    resolvedAt: null,
    exceptionId: null,
    metadata: { source: "ArgoCD" },
    createdAt: new Date("2026-09-14T08:00:00Z"),
    updatedAt: new Date("2026-09-14T08:00:00Z"),
  };

  beforeEach(async () => {
    mockPrisma = {
      deploymentIncident: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      policyExceptionRequest: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    mockEventsService = {
      emitIncidentCreated: jest.fn(),
      emitIncidentUpdated: jest.fn(),
    };

    mockGitOpsPublisher = {
      publishManifest: jest.fn().mockResolvedValue({
        publishedToGitOps: true,
        appliedDirectly: true,
      }),
    };

    mockClusterProvider = {
      getMetadata: jest.fn().mockReturnValue({
        id: "cluster-alpha",
        displayName: "Production Cluster Alpha",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IncidentsEventsService, useValue: mockEventsService },
        { provide: GitOpsPublisherService, useValue: mockGitOpsPublisher },
        { provide: ClusterProvider, useValue: mockClusterProvider },
      ],
    }).compile();

    service = module.get<IncidentsService>(IncidentsService);
  });

  describe("recordAdmissionBlock", () => {
    it("creates a new DeploymentIncident when no active matching incident exists", async () => {
      mockPrisma.deploymentIncident.findFirst.mockResolvedValue(null);
      mockPrisma.deploymentIncident.create.mockResolvedValue(sampleIncident);

      const result = await service.recordAdmissionBlock({
        clusterId: "cluster-alpha",
        namespace: "mlops-serving",
        resourceKind: "Deployment",
        resourceName: "deepseek-serving",
        policyName: "disallow-privileged-containers",
        ruleName: "check-privileged",
        blockReason: "Privileged containers are disallowed",
        gitopsAppName: "deepseek-app",
      });

      expect(mockPrisma.deploymentIncident.create).toHaveBeenCalledTimes(1);
      expect(mockEventsService.emitIncidentCreated).toHaveBeenCalledWith(
        result,
      );
      expect(result.id).toBe("inc-1");
      expect(result.status).toBe(IncidentStatus.ACTIVE);
    });

    it("deduplicates and increments blockCount when an ACTIVE incident already exists", async () => {
      mockPrisma.deploymentIncident.findFirst.mockResolvedValue(sampleIncident);
      const updatedIncident = {
        ...sampleIncident,
        blockCount: 2,
        lastBlockedAt: new Date("2026-09-14T08:05:00Z"),
      };
      mockPrisma.deploymentIncident.update.mockResolvedValue(updatedIncident);

      const result = await service.recordAdmissionBlock({
        clusterId: "cluster-alpha",
        namespace: "mlops-serving",
        resourceKind: "Deployment",
        resourceName: "deepseek-serving",
        policyName: "disallow-privileged-containers",
        blockReason: "Updated block reason",
      });

      expect(mockPrisma.deploymentIncident.create).not.toHaveBeenCalled();
      expect(mockPrisma.deploymentIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "inc-1" },
          data: expect.objectContaining({
            blockCount: { increment: 1 },
            blockReason: "Updated block reason",
          }),
        }),
      );
      expect(mockEventsService.emitIncidentUpdated).toHaveBeenCalledWith(
        result,
      );
      expect(result.blockCount).toBe(2);
    });
  });

  describe("getIncidents", () => {
    it("returns paginated incidents within user allowed clusters", async () => {
      mockPrisma.deploymentIncident.findMany.mockResolvedValue([
        sampleIncident,
      ]);
      mockPrisma.deploymentIncident.count.mockResolvedValue(1);

      const result = await service.getIncidents(mockUser, {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.deploymentIncident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clusterId: { in: ["cluster-alpha", "cluster-beta"] },
          }),
          take: 10,
          skip: 0,
        }),
      );
    });

    it("throws BusinessException(CLUSTER_ACCESS_DENIED) when non-admin queries unauthorized cluster", async () => {
      await expect(
        service.getIncidents(mockUser, { clusterId: "cluster-gamma" }),
      ).rejects.toThrow(BusinessException);

      try {
        await service.getIncidents(mockUser, { clusterId: "cluster-gamma" });
      } catch (err) {
        expect((err as BusinessException).code).toBe(
          INCIDENT_ERROR.CLUSTER_ACCESS_DENIED.code,
        );
      }
    });

    it("allows ADMIN user to query any cluster", async () => {
      mockPrisma.deploymentIncident.findMany.mockResolvedValue([]);
      mockPrisma.deploymentIncident.count.mockResolvedValue(0);

      const result = await service.getIncidents(mockAdminUser, {
        clusterId: "cluster-gamma",
      });

      expect(result.items).toHaveLength(0);
      expect(mockPrisma.deploymentIncident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clusterId: "cluster-gamma" }),
        }),
      );
    });
  });

  describe("getIncidentById", () => {
    it("returns single incident when found and cluster is authorized", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(
        sampleIncident,
      );

      const result = await service.getIncidentById(mockUser, "inc-1");

      expect(result.id).toBe("inc-1");
      expect(result.resourceName).toBe("deepseek-serving");
    });

    it("throws NOT_FOUND when incident does not exist", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(null);

      await expect(
        service.getIncidentById(mockUser, "inc-999"),
      ).rejects.toThrow(BusinessException);
    });

    it("throws CLUSTER_ACCESS_DENIED when user cannot access incident cluster", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue({
        ...sampleIncident,
        clusterId: "cluster-forbidden",
      });

      await expect(service.getIncidentById(mockUser, "inc-1")).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe("getRemediationDraft", () => {
    it("generates PolicyException YAML, prefill URL, and guidance correctly", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(
        sampleIncident,
      );

      const result = await service.getRemediationDraft(mockUser, "inc-1");

      expect(result.suggestedExceptionYaml).toContain("kyverno.io/v2");
      expect(result.suggestedExceptionYaml).toContain("PolicyException");
      expect(result.suggestedExceptionYaml).toContain(
        "disallow-privileged-containers",
      );
      expect(result.autoFillUrl).toContain("/exceptions/new?");
      expect(result.autoFillUrl).toContain("cluster=cluster-alpha");
      expect(result.autoFillUrl).toContain("namespace=mlops-serving");
      expect(result.autoFillUrl).toContain("resource=deepseek-serving");
      expect(result.autoFillUrl).toContain("kind=Deployment");
      expect(result.autoFillUrl).toContain(
        "policy=disallow-privileged-containers",
      );
      expect(result.autoFillUrl).toContain("rule=check-privileged");
      expect(result.remediationGuide).toContain(
        "disallow-privileged-containers",
      );
      expect(result.defaultTtlHours).toBe(24);
      expect(result.incident.id).toBe("inc-1");
    });

    it("throws NOT_FOUND when incident does not exist", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(null);

      await expect(
        service.getRemediationDraft(mockUser, "inc-missing"),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe("remediateEmergency", () => {
    it("rejects non-admin users with ONLY_ADMIN_ALLOWED", async () => {
      await expect(
        service.remediateEmergency(mockUser, "inc-1", {
          reason: "Emergency fix attempt by non-admin",
        }),
      ).rejects.toThrow(BusinessException);

      try {
        await service.remediateEmergency(mockUser, "inc-1", {
          reason: "Emergency fix attempt",
        });
      } catch (err) {
        expect((err as BusinessException).code).toBe(
          INCIDENT_ERROR.ONLY_ADMIN_ALLOWED.code,
        );
      }
    });

    it("throws ALREADY_RESOLVED if incident is not ACTIVE", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue({
        ...sampleIncident,
        status: IncidentStatus.RESOLVED_BY_HOTFIX,
      });

      await expect(
        service.remediateEmergency(mockAdminUser, "inc-1", {
          reason: "Emergency fix",
        }),
      ).rejects.toThrow(BusinessException);
    });

    it("creates approved PolicyExceptionRequest, resolves incident, and calls gitops publisher", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(
        sampleIncident,
      );
      const createdException = {
        id: "exp-uuid-1",
        status: ExceptionStatus.APPROVED,
        targetClusterId: "cluster-alpha",
        policyName: "disallow-privileged-containers",
      };
      const resolvedIncident = {
        ...sampleIncident,
        status: IncidentStatus.RESOLVED_BY_EXCEPTION,
        resolvedAt: new Date(),
        exceptionId: "exp-uuid-1",
      };

      mockPrisma.policyExceptionRequest.create.mockResolvedValue(
        createdException,
      );
      mockPrisma.deploymentIncident.update.mockResolvedValue(resolvedIncident);

      const result = await service.remediateEmergency(mockAdminUser, "inc-1", {
        reason: "Urgent fix for production outage",
        ttlHours: 48,
        publishToGitOps: true,
      });

      expect(result.status).toBe(IncidentStatus.RESOLVED_BY_EXCEPTION);
      expect(result.exceptionId).toBe("exp-uuid-1");
      expect(mockPrisma.policyExceptionRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ExceptionStatus.APPROVED,
            targetClusterId: "cluster-alpha",
            policyName: "disallow-privileged-containers",
          }),
        }),
      );
      expect(mockGitOpsPublisher.publishManifest).toHaveBeenCalledWith(
        createdException,
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "DEPLOYMENT_INCIDENT_EMERGENCY_REMEDIATED",
            entityId: "inc-1",
          }),
        }),
      );
      expect(mockEventsService.emitIncidentUpdated).toHaveBeenCalledWith(
        result,
      );
    });
  });

  describe("resolveByHotfix", () => {
    it("successfully sets status to RESOLVED_BY_HOTFIX with commit and note metadata", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(
        sampleIncident,
      );
      const resolvedIncident = {
        ...sampleIncident,
        status: IncidentStatus.RESOLVED_BY_HOTFIX,
        resolvedAt: new Date(),
        metadata: {
          hotfixResolution: {
            commitSha: "sha-fixed-999",
            note: "Updated securityContext in git repo",
          },
        },
      };
      mockPrisma.deploymentIncident.update.mockResolvedValue(resolvedIncident);

      const result = await service.resolveByHotfix(mockUser, "inc-1", {
        commitSha: "sha-fixed-999",
        note: "Updated securityContext in git repo",
      });

      expect(result.status).toBe(IncidentStatus.RESOLVED_BY_HOTFIX);
      expect(mockPrisma.deploymentIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "inc-1" },
          data: expect.objectContaining({
            status: IncidentStatus.RESOLVED_BY_HOTFIX,
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "DEPLOYMENT_INCIDENT_RESOLVED_BY_HOTFIX",
            entityId: "inc-1",
          }),
        }),
      );
      expect(mockEventsService.emitIncidentUpdated).toHaveBeenCalledWith(
        result,
      );
    });

    it("throws ALREADY_RESOLVED if incident is already resolved or ignored", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue({
        ...sampleIncident,
        status: IncidentStatus.RESOLVED_BY_EXCEPTION,
      });

      await expect(
        service.resolveByHotfix(mockUser, "inc-1", {
          commitSha: "sha-123",
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe("ignoreIncident", () => {
    it("successfully sets status to IGNORED and records audit log", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(
        sampleIncident,
      );
      const ignoredIncident = {
        ...sampleIncident,
        status: IncidentStatus.IGNORED,
        resolvedAt: new Date("2026-09-14T08:10:00Z"),
      };
      mockPrisma.deploymentIncident.update.mockResolvedValue(ignoredIncident);

      const result = await service.ignoreIncident(mockUser, "inc-1", {
        reason: "Staging deployment test override",
      });

      expect(result.status).toBe(IncidentStatus.IGNORED);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "DEPLOYMENT_INCIDENT_IGNORED",
            entityType: "DeploymentIncident",
            entityId: "inc-1",
            userId: "user-1",
          }),
        }),
      );
      expect(mockEventsService.emitIncidentUpdated).toHaveBeenCalledWith(
        result,
      );
    });

    it("throws ALREADY_RESOLVED if incident is not ACTIVE", async () => {
      mockPrisma.deploymentIncident.findUnique.mockResolvedValue({
        ...sampleIncident,
        status: IncidentStatus.IGNORED,
      });

      await expect(
        service.ignoreIncident(mockUser, "inc-1", { reason: "test" }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe("getIncidentsSince", () => {
    it("returns empty items and hasMore: false when lastEventId is empty or whitespace", async () => {
      const result = await service.getIncidentsSince(mockUser, "");
      expect(result).toEqual({ items: [], hasMore: false, lastEventId: "" });
      expect(mockPrisma.deploymentIncident.findMany).not.toHaveBeenCalled();
    });

    it("queries incidents updated after the target incident timestamp when lastEventId is an incident id", async () => {
      const targetIncident = {
        ...sampleIncident,
        id: "inc-target-0",
        updatedAt: new Date("2026-09-14T08:05:00Z"),
      };
      const newerIncident = {
        ...sampleIncident,
        id: "inc-newer-1",
        updatedAt: new Date("2026-09-14T08:06:00Z"),
      };

      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(
        targetIncident,
      );
      mockPrisma.deploymentIncident.findMany.mockResolvedValue([newerIncident]);

      const result = await service.getIncidentsSince(mockUser, "inc-target-0");

      expect(mockPrisma.deploymentIncident.findUnique).toHaveBeenCalledWith({
        where: { id: "inc-target-0" },
      });
      expect(mockPrisma.deploymentIncident.findMany).toHaveBeenCalledWith({
        where: {
          clusterId: { in: ["cluster-alpha", "cluster-beta"] },
          updatedAt: { gte: targetIncident.updatedAt },
          id: { not: "inc-target-0" },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      });
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe("inc-newer-1");
      expect(result.hasMore).toBe(false);
      expect(result.lastEventId).toBe("inc-target-0");
    });

    it("queries incidents after timestamp when lastEventId is an ISO date string", async () => {
      const isoTimestamp = "2026-09-14T08:00:00.000Z";
      const newerIncident = {
        ...sampleIncident,
        id: "inc-2",
        updatedAt: new Date("2026-09-14T08:01:00.000Z"),
      };

      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(null);
      mockPrisma.deploymentIncident.findMany.mockResolvedValue([newerIncident]);

      const result = await service.getIncidentsSince(
        mockAdminUser,
        isoTimestamp,
      );

      expect(mockPrisma.deploymentIncident.findMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { gte: new Date(isoTimestamp) },
          id: { not: isoTimestamp },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      });
      expect(result.items.length).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.lastEventId).toBe(isoTimestamp);
    });

    it("retrieves incidents sharing identical millisecond updatedAt without omission", async () => {
      const sharedTime = new Date("2026-09-14T08:00:00.123Z");
      const sameTimeIncident1 = {
        ...sampleIncident,
        id: "inc-same-1",
        updatedAt: sharedTime,
      };
      const sameTimeIncident2 = {
        ...sampleIncident,
        id: "inc-same-2",
        updatedAt: sharedTime,
      };

      mockPrisma.deploymentIncident.findUnique.mockResolvedValue({
        id: "inc-base",
        updatedAt: sharedTime,
      });
      mockPrisma.deploymentIncident.findMany.mockResolvedValue([
        sameTimeIncident1,
        sameTimeIncident2,
      ]);

      const result = await service.getIncidentsSince(mockUser, "inc-base");

      expect(mockPrisma.deploymentIncident.findMany).toHaveBeenCalledWith({
        where: {
          clusterId: { in: ["cluster-alpha", "cluster-beta"] },
          updatedAt: { gte: sharedTime },
          id: { not: "inc-base" },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe("inc-same-1");
      expect(result.items[1].id).toBe("inc-same-2");
    });

    it("returns hasMore: true when retrieved incidents reach the 100 limit", async () => {
      const isoTimestamp = "2026-09-14T08:00:00.000Z";
      const hundredIncidents = Array.from({ length: 100 }, (_, i) => ({
        ...sampleIncident,
        id: `inc-batch-${i}`,
        updatedAt: new Date(Date.now() + i * 1000),
      }));

      mockPrisma.deploymentIncident.findUnique.mockResolvedValue(null);
      mockPrisma.deploymentIncident.findMany.mockResolvedValue(
        hundredIncidents,
      );

      const result = await service.getIncidentsSince(mockUser, isoTimestamp);

      expect(result.items).toHaveLength(100);
      expect(result.hasMore).toBe(true);
      expect(result.lastEventId).toBe(isoTimestamp);
    });
  });
});
