import { PrismaClient, Role } from '@prisma/client';

describe('isolated PostgreSQL integration environment', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.',
      );
    }

    const parsedDatabaseUrl = new URL(databaseUrl);

    expect(parsedDatabaseUrl.pathname).toBe('/kyverno_dashboard_integration');

    prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('applies the Prisma schema and persists data in the disposable database', async () => {
    const createdUser = await prisma.user.create({
      data: {
        email: 'integration-smoke@example.com',
        pwdHash: 'not-a-real-password-hash',
        role: Role.VIEWER,
      },
    });

    await expect(
      prisma.user.findUnique({ where: { id: createdUser.id } }),
    ).resolves.toMatchObject({
      email: 'integration-smoke@example.com',
      role: Role.VIEWER,
    });
  });
});
