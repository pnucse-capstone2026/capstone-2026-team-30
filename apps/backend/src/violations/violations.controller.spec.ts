import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ViolationsController } from "./violations.controller";

describe("ViolationsController", () => {
  it("protects every endpoint with JWT and permission guards", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ViolationsController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ["list", "violations.read"],
    ["getSummary", "violations.read"],
    ["getDetail", "violations.read"],
  ])("declares %s permission as %s", (method, permission) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ViolationsController.prototype[method as keyof ViolationsController],
      ),
    ).toEqual([permission]);
  });

  it("delegates list call to service", async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      getViolations: jest.fn(),
      getDetail: jest.fn(),
    };
    const controller = new ViolationsController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.APPROVER,
      clusterIds: ["cluster-1"],
    };

    await controller.list(user, { clusterId: "cluster-1" });
    expect(service.list).toHaveBeenCalledWith(user, { clusterId: "cluster-1" });
  });

  it("delegates getSummary call to service getViolations", async () => {
    const service = {
      list: jest.fn(),
      getViolations: jest.fn().mockResolvedValue([]),
      getDetail: jest.fn(),
    };
    const controller = new ViolationsController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.APPROVER,
      clusterIds: ["cluster-1"],
    };

    await controller.getSummary(user, { clusterId: "cluster-1" });
    expect(service.getViolations).toHaveBeenCalledWith(user, {
      clusterId: "cluster-1",
    });
  });

  it("delegates getDetail call to service", async () => {
    const service = {
      list: jest.fn(),
      getViolations: jest.fn(),
      getDetail: jest.fn().mockResolvedValue({ id: "v-1" }),
    };
    const controller = new ViolationsController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.APPROVER,
      clusterIds: ["cluster-1"],
    };

    await controller.getDetail(
      "cluster-1",
      "cluster-1:polr-ns-payments:0",
      user,
    );
    expect(service.getDetail).toHaveBeenCalledWith(
      "cluster-1",
      "cluster-1:polr-ns-payments:0",
      user,
    );
  });
});
