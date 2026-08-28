import { PrismaClient } from "@prisma/client";
import { seedDefaultAccounts } from "../src/seed/admin-seed.service";
import { seedRbacPermissions } from "../src/seed/rbac-seed.service";
import { env, exit } from "process";

const prisma = new PrismaClient();

async function main() {
  const rbacResult = await seedRbacPermissions(prisma);
  console.log(
    "Seeded RBAC permissions: " +
      rbacResult.permissionCount +
      " permissions, " +
      rbacResult.rolePermissionCount +
      " role mappings",
  );

  const { admin, user } = await seedDefaultAccounts(prisma, {
    adminEmail: env.SEED_ADMIN_EMAIL || "admin@test.com",
    adminPassword: env.SEED_ADMIN_PASSWORD || "test1234!",
    userEmail: env.SEED_USER_EMAIL || "user@test.com",
    userPassword: env.SEED_USER_PASSWORD || "test1234!",
  });

  const adminAction = admin.created
    ? "Created"
    : admin.updated
      ? "Reset/Updated"
      : "Found existing";
  const userAction = user.created
    ? "Created"
    : user.updated
      ? "Reset/Updated"
      : "Found existing";

  console.log(
    `${adminAction} admin user: ${admin.user.email} (password: ${env.SEED_ADMIN_PASSWORD || "test1234!"})`,
  );
  console.log(
    `${userAction} user account: ${user.user.email} (password: ${env.SEED_USER_PASSWORD || "test1234!"})`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
