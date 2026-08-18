import { GUARDS_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { AuditLogsController } from "./audit-logs.controller";

describe("AuditLogsController", () => {
  it("protects every endpoint with JWT and permission guards", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AuditLogsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it.each([
    ["list", "audit_logs.read"],
    ["get", "audit_logs.read"],
  ])("declares %s permission as %s", (method, permission) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AuditLogsController.prototype[
          method as keyof AuditLogsController
        ],
      ),
    ).toEqual([permission]);
  });

  it("delegates list call to service", async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      get: jest.fn(),
    };
    const controller = new AuditLogsController(service as never);

    await controller.list({ page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it("delegates get call to service", async () => {
    const service = {
      list: jest.fn(),
      get: jest.fn().mockResolvedValue({ id: "log-1" }),
    };
    const controller = new AuditLogsController(service as never);

    await controller.get("log-1");
    expect(service.get).toHaveBeenCalledWith("log-1");
  });
});
