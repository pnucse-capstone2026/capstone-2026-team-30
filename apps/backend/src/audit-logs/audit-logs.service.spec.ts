import { Test, TestingModule } from "@nestjs/testing";
import { AuditActorType, Role } from "@prisma/client";
import { BusinessException } from "../common/errors/business.exception";
import { PrismaService } from "../prisma/prisma.service";
import { AUDIT_LOG_ERROR } from "./audit-log.errors";
import { AuditLogsService } from "./audit-logs.service";

describe("AuditLogsService", () => {
  let service: AuditLogsService;
  let mockPrismaService: {
    auditLog: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  const mockAuditLog = {
    id: "log-1",
    action: "EXCEPTION_REQUEST_APPROVED",
    entityType: "EXCEPTION_REQUEST",
    entityId: "req-101",
    actorType: AuditActorType.USER,
    beforeStatus: "PENDING",
    afterStatus: "APPLYING",
    metadata: { policyName: "disallow-latest-tag" },
    createdAt: new Date("2026-08-19T05:35:00Z"),
    userId: "user-admin",
    user: {
      id: "user-admin",
      email: "admin@example.com",
      role: Role.ADMIN,
    },
  };

  beforeEach(async () => {
    mockPrismaService = {
      auditLog: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([mockAuditLog]),
        findUnique: jest.fn().mockResolvedValue(mockAuditLog),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
  });

  describe("list", () => {
    it("페이징 및 필터 조건으로 감사 로그 목록을 조회한다", async () => {
      const result = await service.list({ page: 1, limit: 10 });

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "log-1",
        action: "EXCEPTION_REQUEST_APPROVED",
        actorEmail: "admin@example.com",
        actorRole: "ADMIN",
        summary: "admin@example.com님이 정책 예외를 승인했습니다. (EXCEPTION_REQUEST (req-101))",
      });
    });

    it("시작일이 종료일보다 미래일 경우 BusinessException(INVALID_DATE_RANGE)을 던진다", async () => {
      await expect(
        service.list({
          from: "2026-08-30T00:00:00Z",
          to: "2026-08-01T00:00:00Z",
        }),
      ).rejects.toThrow(new BusinessException(AUDIT_LOG_ERROR.INVALID_DATE_RANGE));
    });

    it("검색어 및 액션 필터를 Prisma where 절에 정상 적용한다", async () => {
      await service.list({ action: "EXCEPTION_REQUEST_APPROVED", search: "admin" });

      expect(mockPrismaService.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: "EXCEPTION_REQUEST_APPROVED",
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });

  describe("get", () => {
    it("특정 감사 로그 단건을 정상 반환한다", async () => {
      const result = await service.get("log-1");

      expect(result).toBeDefined();
      expect(result.id).toBe("log-1");
      expect(result.entityId).toBe("req-101");
    });

    it("존재하지 않는 감사 로그 조회 시 BusinessException(NOT_FOUND)을 던진다", async () => {
      mockPrismaService.auditLog.findUnique.mockResolvedValue(null);

      await expect(service.get("non-existent")).rejects.toThrow(
        new BusinessException(AUDIT_LOG_ERROR.NOT_FOUND),
      );
    });
  });
});
