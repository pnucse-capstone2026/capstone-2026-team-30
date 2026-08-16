import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ExceptionRequestsController } from "./exception-requests.controller";

describe("ExceptionRequestsController", () => {
  it("protects every endpoint with JWT and permission guards", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ExceptionRequestsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it.each([
    ["list", "exception_requests.read"],
    ["get", "exception_requests.read"],
    ["create", "exception_requests.create"],
    ["approve", "exception_requests.approve"],
    ["reject", "exception_requests.reject"],
    ["cancel", "exception_requests.cancel"],
  ])("declares %s permission", (method, permission) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ExceptionRequestsController.prototype[
          method as keyof ExceptionRequestsController
        ],
      ),
    ).toEqual([permission]);
  });

  it("delegates the authenticated user and DTO", async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: "request-1" }),
    };
    const controller = new ExceptionRequestsController(service as never);
    const user = {
      id: "user-1",
      email: "user@example.com",
      role: Role.REQUESTER,
      clusterIds: ["local"],
    };
    const dto = {
      policyName: "policy",
      ruleNames: ["rule"],
      reason: "reason",
      resourceKind: "Pod",
      resourceName: "api",
      resourceNamespace: "default",
      targetClusterId: "local",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(controller.create(dto, user)).resolves.toEqual({
      id: "request-1",
    });
    expect(service.create).toHaveBeenCalledWith(dto, user);
  });
});
