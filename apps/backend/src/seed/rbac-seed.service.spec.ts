import { Role } from "@prisma/client";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  seedRbacPermissions,
} from "./rbac-seed.service";

describe("seedRbacPermissions", () => {
  it("upserts permissions and role-permission mappings idempotently", async () => {
    const permissionRecords = PERMISSIONS.map((permission, index) => ({
      id: "permission-" + index,
      key: permission.key,
    }));
    const prisma = {
      permission: {
        upsert: jest.fn((args: { where: { key: string } }) => {
          const record = permissionRecords.find(
            (permission) => permission.key === args.where.key,
          );

          return Promise.resolve(record);
        }),
      },
      rolePermission: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const result = await seedRbacPermissions(prisma as never);

    expect(result).toEqual({
      permissionCount: PERMISSIONS.length,
      rolePermissionCount: Object.values(ROLE_PERMISSIONS).flat().length,
    });
    expect(prisma.permission.upsert).toHaveBeenCalledTimes(PERMISSIONS.length);
    expect(prisma.permission.upsert).toHaveBeenCalledWith({
      where: { key: "users.read" },
      update: { description: "Read users." },
      create: { key: "users.read", description: "Read users." },
    });
    expect(prisma.rolePermission.upsert).toHaveBeenCalledTimes(
      Object.values(ROLE_PERMISSIONS).flat().length,
    );
    expect(prisma.rolePermission.upsert).toHaveBeenCalledWith({
      where: {
        role_permissionId: {
          role: Role.ADMIN,
          permissionId: "permission-0",
        },
      },
      update: {},
      create: {
        role: Role.ADMIN,
        permissionId: "permission-0",
      },
    });
  });

  it("grants ADMIN every seeded permission", () => {
    expect(ROLE_PERMISSIONS[Role.ADMIN]).toEqual(
      PERMISSIONS.map((permission) => permission.key),
    );
  });

  it("keeps non-admin roles limited to their expected governance permissions", () => {
    expect(ROLE_PERMISSIONS[Role.APPROVER]).toEqual([
      "policies.read",
      "violations.read",
      "exception_requests.read",
      "exception_requests.approve",
      "exception_requests.reject",
      "exception_requests.retry",
      "audit_logs.read",
      "mlops.governance",
      "mlops.pipelines",
      "mlops.serving",
    ]);
    expect(ROLE_PERMISSIONS[Role.REQUESTER]).toEqual([
      "policies.read",
      "violations.read",
      "exception_requests.read",
      "exception_requests.create",
      "exception_requests.cancel",
      "mlops.notebooks",
      "mlops.governance",
      "mlops.pipelines",
      "mlops.serving",
    ]);
    expect(ROLE_PERMISSIONS[Role.VIEWER]).toEqual([
      "policies.read",
      "violations.read",
      "exception_requests.read",
      "mlops.governance",
      "mlops.pipelines",
      "mlops.serving",
    ]);
  });
});
