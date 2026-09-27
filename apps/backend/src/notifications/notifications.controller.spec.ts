import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { NotificationsController } from "./notifications.controller";

describe("NotificationsController", () => {
  const adminUser: AuthenticatedUser = {
    id: "user-admin-1",
    email: "admin@example.com",
    role: Role.ADMIN,
    clusterIds: ["cluster-1"],
  };

  it("protects every endpoint with JWT and permission guards", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, NotificationsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it.each([
    ["getNotifications", "notifications.read"],
    ["markAsRead", "notifications.read"],
    ["markAllAsRead", "notifications.read"],
  ])("declares %s permission as %s", (method, permission) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        NotificationsController.prototype[
          method as keyof NotificationsController
        ],
      ),
    ).toEqual([permission]);
  });

  it("delegates getNotifications call to service", async () => {
    const service = {
      getNotifications: jest.fn().mockResolvedValue([]),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
    };
    const controller = new NotificationsController(service as never);
    const query = { type: "exception" };

    const result = await controller.getNotifications(adminUser, query);

    expect(service.getNotifications).toHaveBeenCalledWith(adminUser, query);
    expect(result).toEqual([]);
  });

  it("delegates markAsRead call to service", async () => {
    const service = {
      getNotifications: jest.fn(),
      markAsRead: jest.fn().mockResolvedValue({ success: true }),
      markAllAsRead: jest.fn(),
    };
    const controller = new NotificationsController(service as never);

    const result = await controller.markAsRead("noti-1", adminUser);

    expect(service.markAsRead).toHaveBeenCalledWith("noti-1", adminUser);
    expect(result).toEqual({ success: true });
  });

  it("delegates markAllAsRead call to service", async () => {
    const service = {
      getNotifications: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new NotificationsController(service as never);

    const result = await controller.markAllAsRead(adminUser);

    expect(service.markAllAsRead).toHaveBeenCalledWith(adminUser);
    expect(result).toEqual({ success: true });
  });
});
