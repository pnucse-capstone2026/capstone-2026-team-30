import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_PASSWORD = 'integration-password';

describe('AuthService refresh token transactions', () => {
  let prisma: PrismaService;
  let authService: AuthService;

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.',
      );
    }

    prisma = new PrismaService({
      datasources: {
        db: { url: databaseUrl },
      },
    });
    const configValues: Record<string, string> = {
      JWT_ACCESS_SECRET: 'integration-access-secret',
      JWT_REFRESH_SECRET: 'integration-refresh-secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };
    const configService = {
      get: (key: string) => configValues[key],
      getOrThrow: (key: string) => {
        const value = configValues[key];

        if (!value) {
          throw new Error('Missing integration configuration: ' + key);
        }

        return value;
      },
    };

    authService = new AuthService(
      prisma as never,
      new JwtService(),
      configService as unknown as ConfigService,
    );
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('allows exactly one concurrent refresh for the same token', async () => {
    const user = await createUser('concurrent-refresh@example.com');
    const loginResult = await authService.login({
      email: user.email,
      password: TEST_PASSWORD,
    });

    const results = await Promise.allSettled([
      authService.refresh(loginResult.refreshToken),
      authService.refresh(loginResult.refreshToken),
    ]);
    const fulfilledResults = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejectedResults = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(fulfilledResults).toHaveLength(1);
    expect(rejectedResults).toHaveLength(1);
    expect((rejectedResults[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      prisma.refreshToken.count({
        where: {
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back revocation when replacement token persistence fails', async () => {
    const user = await createUser('rollback-refresh@example.com');
    const loginResult = await authService.login({
      email: user.email,
      password: TEST_PASSWORD,
    });
    const originalToken = await prisma.refreshToken.findFirstOrThrow({
      where: { userId: user.id, revokedAt: null },
    });
    const collisionUser = await createUser('token-collision@example.com');

    await prisma.refreshToken.create({
      data: {
        userId: collisionUser.id,
        tokenHash: 'forced-token-hash-collision',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    jest
      .spyOn(argon2, 'hash')
      .mockResolvedValue('forced-token-hash-collision');

    await expect(
      authService.refresh(loginResult.refreshToken),
    ).rejects.toMatchObject<Partial<Prisma.PrismaClientKnownRequestError>>({
      code: 'P2002',
    });
    await expect(
      prisma.refreshToken.findUniqueOrThrow({
        where: { id: originalToken.id },
        select: { revokedAt: true },
      }),
    ).resolves.toEqual({ revokedAt: null });
  });

  async function createUser(email: string) {
    return prisma.user.create({
      data: {
        email,
        pwdHash: await argon2.hash(TEST_PASSWORD),
        role: Role.REQUESTER,
      },
    });
  }
});
