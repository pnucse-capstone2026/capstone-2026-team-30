import { Role } from "@prisma/client";

export const PERMISSIONS = [
  { key: "users.read", description: "Read users." },
  { key: "users.create", description: "Create users." },
  { key: "users.update_role", description: "Update user roles." },
  { key: "users.disable", description: "Enable or disable users." },
  { key: "users.reset_password", description: "Reset user passwords." },
  { key: "permissions.read", description: "Read permissions." },
  { key: "violations.read", description: "Read policy violations." },
  {
    key: "exception_requests.read",
    description: "Read policy exception requests.",
  },
  {
    key: "exception_requests.create",
    description: "Create policy exception requests.",
  },
  {
    key: "exception_requests.approve",
    description: "Approve policy exception requests.",
  },
  {
    key: "exception_requests.reject",
    description: "Reject policy exception requests.",
  },
  {
    key: "exception_requests.cancel",
    description: "Cancel policy exception requests.",
  },
  {
    key: "exception_requests.retry",
    description: "Retry failed policy exception requests.",
  },
  {
    key: "exception_requests.expire",
    description: "Expire policy exception requests.",
  },
  {
    key: "users.assign_clusters",
    description: "Assign clusters to users.",
  },
  { key: "policies.read", description: "Read Kyverno policies." },
  { key: "audit_logs.read", description: "Read audit logs." },
  { key: "mlops.notebooks", description: "Manage MLOps Kubeflow Notebooks." },
  { key: "mlops.governance", description: "Manage MLOps Governance & FinOps." },
  { key: "mlops.pipelines", description: "Manage MLOps Kubeflow Pipelines." },
  { key: "mlops.serving", description: "Manage MLOps Model Serving Center." },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  [Role.ADMIN]: PERMISSIONS.map((permission) => permission.key),
  [Role.APPROVER]: [
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
  ],
  [Role.REQUESTER]: [
    "policies.read",
    "violations.read",
    "exception_requests.read",
    "exception_requests.create",
    "exception_requests.cancel",
    "mlops.notebooks",
    "mlops.governance",
    "mlops.pipelines",
    "mlops.serving",
  ],
  [Role.VIEWER]: [
    "policies.read",
    "violations.read",
    "exception_requests.read",
    "mlops.governance",
    "mlops.pipelines",
    "mlops.serving",
  ],
};

type PermissionRecord = {
  id: string;
  key: string;
};

type RbacSeedPrisma = {
  permission: {
    upsert(args: {
      where: { key: string };
      update: { description: string };
      create: { key: string; description: string };
    }): Promise<PermissionRecord>;
  };
  rolePermission: {
    upsert(args: {
      where: { role_permissionId: { role: Role; permissionId: string } };
      update: Record<string, never>;
      create: { role: Role; permissionId: string };
    }): Promise<unknown>;
  };
};

type RbacSeedResult = {
  permissionCount: number;
  rolePermissionCount: number;
};

export async function seedRbacPermissions(
  prisma: RbacSeedPrisma,
): Promise<RbacSeedResult> {
  const permissionsByKey = new Map<string, PermissionRecord>();

  for (const permission of PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: {
        key: permission.key,
        description: permission.description,
      },
    });

    permissionsByKey.set(record.key, record);
  }

  let rolePermissionCount = 0;

  for (const [role, permissionKeys] of Object.entries(ROLE_PERMISSIONS) as [
    Role,
    PermissionKey[],
  ][]) {
    for (const permissionKey of permissionKeys) {
      const permission = permissionsByKey.get(permissionKey);

      if (!permission) {
        throw new Error("Unknown permission key: " + permissionKey);
      }

      await prisma.rolePermission.upsert({
        where: {
          role_permissionId: {
            role,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          role,
          permissionId: permission.id,
        },
      });
      rolePermissionCount += 1;
    }
  }

  return {
    permissionCount: PERMISSIONS.length,
    rolePermissionCount,
  };
}
