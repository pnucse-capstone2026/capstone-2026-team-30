import { PrismaClient } from '@prisma/client';
import { seedAdminUser } from '../src/seed/admin-seed.service';
import { seedRbacPermissions } from '../src/seed/rbac-seed.service';
import { env, exit } from 'process';

const prisma = new PrismaClient();

async function main() {
  const rbacResult = await seedRbacPermissions(prisma);
  console.log(
    'Seeded RBAC permissions: ' +
      rbacResult.permissionCount +
      ' permissions, ' +
      rbacResult.rolePermissionCount +
      ' role mappings',
  );

  const result = await seedAdminUser(prisma, {
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
  });

  const action = result.created ? 'Created' : 'Found existing';
  console.log(action + ' admin user: ' + result.user.email);
}

main()
  .catch((error) => {
    console.error(error);
    exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
