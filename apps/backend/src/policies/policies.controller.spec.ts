import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { PoliciesController } from "./policies.controller";

describe("PoliciesController", () => {
  it("protects every endpoint with JWT and permission guards", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PoliciesController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ["list", "policies.read"],
    ["getDetail", "policies.read"],
    ["create", "policies.write"],
    ["update", "policies.write"],
    ["delete", "policies.write"],
  ])("declares %s permission as %s", (method, permission) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        PoliciesController.prototype[method as keyof PoliciesController],
      ),
    ).toEqual([permission]);
  });

  it("delegates list call to service", async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      getDetail: jest.fn(),
    };
    const controller = new PoliciesController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.VIEWER,
      clusterIds: ["cluster-1"],
    };

    await controller.list(user, { clusterId: "cluster-1" });
    expect(service.list).toHaveBeenCalledWith(user, { clusterId: "cluster-1" });
  });

  it("delegates getDetail call to service", async () => {
    const service = {
      list: jest.fn(),
      getDetail: jest.fn().mockResolvedValue({ name: "disallow-latest-tag" }),
    };
    const controller = new PoliciesController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.ADMIN,
      clusterIds: ["cluster-1"],
    };

    await controller.getDetail(
      "cluster-1",
      "disallow-latest-tag",
      "payments",
      user,
    );
    expect(service.getDetail).toHaveBeenCalledWith(
      "cluster-1",
      "disallow-latest-tag",
      user,
      "payments",
    );
  });

  it("delegates create call to service", async () => {
    const service = {
      list: jest.fn(),
      getDetail: jest.fn(),
      create: jest.fn().mockResolvedValue({ name: "require-resource-limits" }),
    };
    const controller = new PoliciesController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.ADMIN,
      clusterIds: ["cluster-1"],
    };
    const dto = {
      name: "require-resource-limits",
      clusterId: "cluster-1",
      scope: "ClusterPolicy" as const,
      type: "validate" as const,
      mode: "enforce" as const,
      ruleName: "check-limits",
      matchKinds: "Pod",
    };

    await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith(dto, user);
  });

  it("delegates update call to service", async () => {
    const service = {
      update: jest.fn().mockResolvedValue({ name: "require-resource-limits" }),
    };
    const controller = new PoliciesController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.ADMIN,
      clusterIds: ["cluster-1"],
    };
    const dto = { mode: "enforce" as const };

    await controller.update(
      "cluster-1",
      "require-resource-limits",
      "default",
      user,
      dto,
    );
    expect(service.update).toHaveBeenCalledWith(
      "cluster-1",
      "require-resource-limits",
      dto,
      user,
      "default",
    );
  });

  it("delegates delete call to service", async () => {
    const service = {
      delete: jest
        .fn()
        .mockResolvedValue({ success: true, name: "require-resource-limits" }),
    };
    const controller = new PoliciesController(service as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "user@example.com",
      role: Role.ADMIN,
      clusterIds: ["cluster-1"],
    };

    await controller.delete(
      "cluster-1",
      "require-resource-limits",
      "default",
      user,
    );
    expect(service.delete).toHaveBeenCalledWith(
      "cluster-1",
      "require-resource-limits",
      user,
      "default",
    );
  });
});
