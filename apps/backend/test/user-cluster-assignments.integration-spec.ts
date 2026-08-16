import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";

describe("user cluster assignment transactions", () => {
  let prisma: PrismaService;
  let users: UsersService;

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.",
      );
    }

    prisma = new PrismaService({
      datasources: { db: { url: databaseUrl } },
    });
    users = new UsersService(prisma, {
      getMetadata: (id: string) => {
        if (id !== "prod" && id !== "staging") {
          throw new Error(`Unknown integration cluster: ${id}`);
        }
        return { id, displayName: id, exceptionNamespace: "kyverno" };
      },
    } as never);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("returns the full user and audits a normalized assignment change", async () => {
    const actor = await createUser("admin@example.com", Role.ADMIN);
    const target = await createUser("viewer@example.com", Role.VIEWER);

    await expect(
      users.setClusters(
        target.id,
        { clusterIds: ["staging", "prod", "prod"] },
        authenticated(actor),
      ),
    ).resolves.toMatchObject({
      id: target.id,
      email: target.email,
      role: Role.VIEWER,
      disabledAt: null,
      clusterIds: ["prod", "staging"],
    });

    await expect(
      prisma.auditLog.findMany({ where: { entityId: target.id } }),
    ).resolves.toEqual([
      expect.objectContaining({
        action: "USER_CLUSTER_ASSIGNMENTS_UPDATED",
        entityType: "User",
        actorType: "USER",
        userId: actor.id,
        metadata: {
          beforeClusterIds: [],
          afterClusterIds: ["prod", "staging"],
        },
      }),
    ]);

    await users.setClusters(
      target.id,
      { clusterIds: ["staging", "prod"] },
      authenticated(actor),
    );
    await expect(
      prisma.auditLog.count({ where: { entityId: target.id } }),
    ).resolves.toBe(1);
  });

  it("rolls assignments back when the audit insert fails", async () => {
    const actor = await createUser("admin-rollback@example.com", Role.ADMIN);
    const target = await createUser("viewer-rollback@example.com", Role.VIEWER);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_user_cluster_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'USER_CLUSTER_ASSIGNMENTS_UPDATED' THEN
          RAISE EXCEPTION 'user cluster audit rejected by integration test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_user_cluster_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION reject_user_cluster_audit();
    `);

    try {
      await expect(
        users.setClusters(
          target.id,
          { clusterIds: ["prod"] },
          authenticated(actor),
        ),
      ).rejects.toThrow("user cluster audit rejected by integration test");
      await expect(
        prisma.userCluster.count({ where: { userId: target.id } }),
      ).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_user_cluster_audit_trigger ON "AuditLog";',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS reject_user_cluster_audit();",
      );
    }
  });

  function createUser(email: string, role: Role) {
    return prisma.user.create({
      data: { email, pwdHash: "integration-hash", role },
    });
  }

  function authenticated(user: {
    id: string;
    email: string;
    role: Role;
  }): AuthenticatedUser {
    return { id: user.id, email: user.email, role: user.role, clusterIds: [] };
  }
});
