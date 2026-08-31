import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  let service: NotificationsService;

  const mockPrismaService = {
    notificationRead: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    notification: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "noti-db-1",
          title: "시스템 공지사항",
          message: "플랫폼 점검 안내",
          type: "policy",
          severity: "info",
          href: "/notifications",
          targetRoles: [Role.ADMIN, Role.APPROVER, Role.REQUESTER, Role.VIEWER],
          targetUserEmails: [],
          createdAt: new Date("2026-08-30T00:00:00Z"),
          updatedAt: new Date("2026-08-30T00:00:00Z"),
        },
      ]),
    },
    policyExceptionRequest: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    violationHistory: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const adminUser: AuthenticatedUser = {
    id: "user-admin-1",
    email: "admin@example.com",
    role: Role.ADMIN,
    clusterIds: ["cluster-1"],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getNotifications", () => {
    it("should return notifications filtered for admin user", async () => {
      mockPrismaService.notificationRead.findMany.mockResolvedValue([]);
      mockPrismaService.notification.findMany.mockResolvedValue([
        {
          id: "noti-db-1",
          title: "시스템 공지사항",
          message: "플랫폼 점검 안내",
          type: "policy",
          severity: "info",
          href: "/notifications",
          targetRoles: [Role.ADMIN],
          targetUserEmails: [],
          createdAt: new Date("2026-08-30T00:00:00Z"),
          updatedAt: new Date("2026-08-30T00:00:00Z"),
        },
      ]);

      const result = await service.getNotifications(adminUser);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe("noti-db-1");
    });

    it("should filter notifications by query type", async () => {
      mockPrismaService.notificationRead.findMany.mockResolvedValue([]);
      mockPrismaService.notification.findMany.mockResolvedValue([
        {
          id: "noti-1",
          title: "승인 필요",
          message: "검토 요청",
          type: "exception",
          severity: "warning",
          href: "/admin/exceptions",
          targetRoles: [Role.ADMIN],
          targetUserEmails: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "noti-2",
          title: "위반 발생",
          message: "경고 메시지",
          type: "violation",
          severity: "critical",
          href: "/admin/violations",
          targetRoles: [Role.ADMIN],
          targetUserEmails: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getNotifications(adminUser, {
        type: "exception",
      });

      expect(result.every((item) => item.type === "exception")).toBe(true);
    });
  });

  describe("markAsRead", () => {
    it("should upsert notificationRead record", async () => {
      const result = await service.markAsRead("noti-1", adminUser);

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.notificationRead.upsert).toHaveBeenCalledWith({
        where: {
          userId_notificationId: {
            userId: adminUser.id,
            notificationId: "noti-1",
          },
        },
        update: expect.any(Object),
        create: expect.any(Object),
      });
    });
  });
});
