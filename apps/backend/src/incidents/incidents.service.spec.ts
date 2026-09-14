import { Test, TestingModule } from "@nestjs/testing";
import { IncidentStatus, Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { PrismaService } from "../prisma/prisma.service";
import { IncidentsEventsService } from "./incidents-events.service";
import { INCIDENT_ERROR } from "./incidents.errors";
import { IncidentsService } from "./incidents.service";

describe("IncidentsService", () => {
  let service: IncidentsService;
  let mockPrisma: any;
  let mockEventsService: any;

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
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    mockEventsService = {
      emitIncidentCreated: jest.fn(),
      emitIncidentUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IncidentsEventsService, useValue: mockEventsService },
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
    it("returns empty array when lastEventId is empty or whitespace", async () => {
      const result = await service.getIncidentsSince(mockUser, "");
      expect(result).toEqual([]);
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
          updatedAt: { gt: targetIncident.updatedAt },
          id: { not: "inc-target-0" },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("inc-newer-1");
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
          updatedAt: { gt: new Date(isoTimestamp) },
          id: { not: isoTimestamp },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      });
      expect(result.length).toBe(1);
    });
  });
});
