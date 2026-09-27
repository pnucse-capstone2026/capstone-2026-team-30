import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import argon2 from "argon2";
import { AUTH_ERROR } from "../src/auth/auth.errors";
import { AuthService } from "../src/auth/auth.service";
import { SessionEventsService } from "../src/auth/session-events.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";

const OLD_PASSWORD = "old-integration-password";
const NEW_PASSWORD = "new-integration-password";

describe("user session invalidation transactions", () => {
  let prisma: PrismaService;
  let authService: AuthService;
  let usersService: UsersService;

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.",
      );
    }

    prisma = new PrismaService({
      datasources: {
        db: { url: databaseUrl },
      },
    });
    const configValues: Record<string, string> = {
      JWT_ACCESS_SECRET: "integration-access-secret",
      JWT_REFRESH_SECRET: "integration-refresh-secret",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_REFRESH_EXPIRES_IN: "7d",
    };
    const configService = {
      get: (key: string) => configValues[key],
      getOrThrow: (key: string) => {
        const value = configValues[key];

        if (!value) {
          throw new Error("Missing integration configuration: " + key);
        }

        return value;
      },
    };

    authService = new AuthService(
      prisma,
      new JwtService(),
      configService as unknown as ConfigService,
      new SessionEventsService(),
    );
    // setClusters 를 쓰지 않는 스펙이라 ClusterProvider 는 자리만 채운다.
    usersService = new UsersService(prisma, {
      getMetadata: () => {
        throw new Error("not used in this spec");
      },
    } as never);
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("prevents a concurrent old-password login from surviving password reset", async () => {
    const user = await createUser("password-reset-race@example.com");
    const existingLogin = await authService.login({
      email: user.email,
      password: OLD_PASSWORD,
    });
    const [loginResult, resetResult] = await Promise.allSettled([
      authService.login({ email: user.email, password: OLD_PASSWORD }),
      usersService.resetPassword(user.id, { password: NEW_PASSWORD }),
    ]);

    expect(resetResult.status).toBe("fulfilled");
    await expect(activeTokenCount(user.id)).resolves.toBe(0);
    await expect(
      authService.refresh(existingLogin.refreshToken),
    ).rejects.toMatchObject({
      code: AUTH_ERROR.INVALID_REFRESH_TOKEN.code,
    });

    if (loginResult.status === "fulfilled") {
      await expect(
        authService.refresh(loginResult.value.refreshToken),
      ).rejects.toMatchObject({
        code: AUTH_ERROR.INVALID_REFRESH_TOKEN.code,
      });
    }
  });

  it("prevents concurrent refresh from surviving disable and re-enable", async () => {
    const user = await createUser("disable-race@example.com");
    const existingLogin = await authService.login({
      email: user.email,
      password: OLD_PASSWORD,
    });
    const [refreshResult, disableResult] = await Promise.allSettled([
      authService.refresh(existingLogin.refreshToken),
      usersService.setDisabled(user.id, { disabled: true }),
    ]);

    expect(disableResult.status).toBe("fulfilled");
    await expect(activeTokenCount(user.id)).resolves.toBe(0);

    await usersService.setDisabled(user.id, { disabled: false });
    await expect(
      authService.refresh(existingLogin.refreshToken),
    ).rejects.toMatchObject({
      code: AUTH_ERROR.INVALID_REFRESH_TOKEN.code,
    });

    if (refreshResult.status === "fulfilled") {
      await expect(
        authService.refresh(refreshResult.value.refreshToken),
      ).rejects.toMatchObject({
        code: AUTH_ERROR.INVALID_REFRESH_TOKEN.code,
      });
    }
  });

  async function createUser(email: string) {
    return prisma.user.create({
      data: {
        email,
        pwdHash: await argon2.hash(OLD_PASSWORD),
        role: Role.REQUESTER,
      },
    });
  }

  function activeTokenCount(userId: string) {
    return prisma.refreshToken.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }
});
