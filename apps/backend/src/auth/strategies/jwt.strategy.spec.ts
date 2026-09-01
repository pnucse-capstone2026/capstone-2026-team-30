import { ConfigService } from "@nestjs/config";
import { Role } from "@prisma/client";
import { AUTH_ERROR } from "../auth.errors";
import { JwtPayload } from "../auth.types";
import { JwtStrategy } from "./jwt.strategy";

const payload = {
  sub: "user-1",
  email: "admin@example.com",
  role: Role.ADMIN,
};

function createStrategy() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue("access-secret"),
  };

  return {
    strategy: new JwtStrategy(
      prisma as never,
      configService as unknown as ConfigService,
    ),
    prisma,
    configService,
  };
}

describe("JwtStrategy", () => {
  it("uses JWT_ACCESS_SECRET", () => {
    const { configService } = createStrategy();

    expect(configService.getOrThrow).toHaveBeenCalledWith("JWT_ACCESS_SECRET");
  });

  it("validates an active user from the payload subject", async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      disabledAt: null,
      userClusters: [],
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      clusterIds: [],
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        email: true,
        role: true,
        currentSessionId: true,
        disabledAt: true,
        userClusters: { select: { clusterId: true } },
      },
    });
  });

  it("carries the assigned cluster ids on the authenticated user", async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      currentSessionId: null,
      disabledAt: null,
      userClusters: [{ clusterId: "cluster-a" }],
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      clusterIds: ["cluster-a"],
    });
  });

  it("rejects authentication if payload session ID does not match database currentSessionId", async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      currentSessionId: "session-newer-uuid",
      disabledAt: null,
      userClusters: [],
    });

    const oldSessionPayload: JwtPayload = {
      sub: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      sessionId: "session-older-uuid",
    };

    await expect(strategy.validate(oldSessionPayload)).rejects.toMatchObject({
      code: AUTH_ERROR.SESSION_EXPIRED.code,
    });
  });

  it("rejects disabled users", async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: Role.ADMIN,
      currentSessionId: null,
      disabledAt: new Date(),
      userClusters: [],
    });

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      code: AUTH_ERROR.AUTHENTICATION_REQUIRED.code,
    });
  });

  it("rejects unknown users", async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      code: AUTH_ERROR.AUTHENTICATION_REQUIRED.code,
    });
  });
});
