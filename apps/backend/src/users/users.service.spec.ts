import { AuditActorType, Prisma, Role } from "@prisma/client";
import argon2 from "argon2";
import { BusinessException } from "../common/errors/business.exception";
import { KUBERNETES_ERROR } from "../kubernetes/kubernetes.errors";
import { PRISMA_ERROR_CODE, PrismaErrorCode } from "../prisma/prisma-error";
import { USER_ERROR } from "./user.errors";
import { UsersService } from "./users.service";

const user = {
  id: "user-1",
  email: "requester@example.com",
  role: Role.REQUESTER,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  disabledAt: null,
};

const selectedUser = { ...user, userClusters: [] };
const userResponse = { ...user, clusterIds: [] };
const actor = {
  id: "admin-1",
  email: "admin@example.com",
  role: Role.ADMIN,
  clusterIds: [],
};

function createService() {
  const prisma = {
    runSerializableTransaction: jest.fn(),
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userCluster: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
  prisma.runSerializableTransaction.mockImplementation(
    async (
      operation: (transaction: typeof prisma) => Promise<unknown>,
    ): Promise<unknown> => operation(prisma),
  );

  const clusters = {
    getMetadata: jest.fn((id: string) => {
      if (id !== "prod" && id !== "staging") {
        throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
          context: { clusterId: id },
        });
      }
      return { id, displayName: id, exceptionNamespace: "kyverno" };
    }),
  };

  return {
    service: new UsersService(prisma as never, clusters as never),
    prisma,
    clusters,
  };
}

function createPrismaError(code: PrismaErrorCode) {
  return new Prisma.PrismaClientKnownRequestError("Prisma request failed.", {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe("UsersService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists users without password hashes", async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([
      {
        ...selectedUser,
        userClusters: [{ clusterId: "prod" }, { clusterId: "staging" }],
      },
    ]);

    await expect(service.list()).resolves.toEqual([
      { ...user, clusterIds: ["prod", "staging"] },
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        disabledAt: true,
        userClusters: {
          select: { clusterId: true },
          orderBy: { clusterId: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("creates a user with normalized email and hashed password", async () => {
    const { service, prisma } = createService();
    prisma.user.create.mockResolvedValue(selectedUser);
    jest.spyOn(argon2, "hash").mockResolvedValue("hashed-password");

    await expect(
      service.create({
        email: " Requester@Example.com ",
        password: "plain-password",
        role: Role.REQUESTER,
      }),
    ).resolves.toEqual(userResponse);
    expect(argon2.hash).toHaveBeenCalledWith("plain-password");
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "requester@example.com",
        pwdHash: "hashed-password",
        role: Role.REQUESTER,
      },
      select: expect.any(Object),
    });
  });

  it("rejects duplicate user emails", async () => {
    const { service, prisma } = createService();
    prisma.user.create.mockRejectedValue(
      createPrismaError(PRISMA_ERROR_CODE.UNIQUE_CONSTRAINT_VIOLATION),
    );
    jest.spyOn(argon2, "hash").mockResolvedValue("hashed-password");

    await expect(
      service.create({
        email: user.email,
        password: "plain-password",
        role: Role.REQUESTER,
      }),
    ).rejects.toMatchObject({
      code: USER_ERROR.EMAIL_ALREADY_EXISTS.code,
    });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("updates a user role", async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue({
      ...selectedUser,
      role: Role.APPROVER,
    });

    await expect(
      service.updateRole(user.id, { role: Role.APPROVER }),
    ).resolves.toEqual({ ...userResponse, role: Role.APPROVER });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { role: Role.APPROVER },
      select: expect.any(Object),
    });
    expect(prisma.runSerializableTransaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("resets a user password", async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue(selectedUser);
    jest.spyOn(argon2, "hash").mockResolvedValue("new-hash");

    await expect(
      service.resetPassword(user.id, { password: "new-password" }),
    ).resolves.toEqual(userResponse);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { pwdHash: "new-hash" },
      select: expect.any(Object),
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("sets disabledAt when disabling a user", async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue({
      ...user,
      disabledAt: new Date("2026-01-02T00:00:00.000Z"),
      userClusters: [],
    });

    await expect(
      service.setDisabled(user.id, { disabled: true }),
    ).resolves.toEqual({
      ...user,
      disabledAt: new Date("2026-01-02T00:00:00.000Z"),
      clusterIds: [],
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { disabledAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("clears disabledAt when enabling a user", async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue(selectedUser);

    await expect(
      service.setDisabled(user.id, { disabled: false }),
    ).resolves.toEqual(userResponse);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { disabledAt: null },
      select: expect.any(Object),
    });
    expect(prisma.runSerializableTransaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("rejects updates for missing users", async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockRejectedValue(
      createPrismaError(PRISMA_ERROR_CODE.RECORD_NOT_FOUND),
    );

    await expect(
      service.updateRole("missing-user", { role: Role.VIEWER }),
    ).rejects.toMatchObject({
      code: USER_ERROR.NOT_FOUND.code,
    });
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it("does not hide unexpected persistence errors", async () => {
    const { service, prisma } = createService();
    const databaseError = new Error("database unavailable");
    prisma.user.update.mockRejectedValue(databaseError);

    await expect(
      service.updateRole(user.id, { role: Role.VIEWER }),
    ).rejects.toBe(databaseError);
  });

  it("replaces cluster assignments in one transaction", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(selectedUser);

    await expect(
      service.setClusters(
        "user-1",
        { clusterIds: ["staging", "prod", "prod"] },
        actor,
      ),
    ).resolves.toEqual({
      ...userResponse,
      clusterIds: ["prod", "staging"],
    });

    expect(prisma.userCluster.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(prisma.userCluster.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", clusterId: "prod" },
        { userId: "user-1", clusterId: "staging" },
      ],
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "USER_CLUSTER_ASSIGNMENTS_UPDATED",
        entityType: "User",
        entityId: "user-1",
        actorType: AuditActorType.USER,
        userId: actor.id,
        metadata: {
          beforeClusterIds: [],
          afterClusterIds: ["prod", "staging"],
        },
      },
    });
  });

  it("returns the current user without writes for an unchanged assignment", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...selectedUser,
      userClusters: [{ clusterId: "prod" }, { clusterId: "staging" }],
    });

    await expect(
      service.setClusters(
        "user-1",
        { clusterIds: ["staging", "prod", "prod"] },
        actor,
      ),
    ).resolves.toEqual({
      ...userResponse,
      clusterIds: ["prod", "staging"],
    });

    expect(prisma.userCluster.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userCluster.createMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown cluster before touching assignments", async () => {
    const { service, prisma } = createService();

    await expect(
      service.setClusters("user-1", { clusterIds: ["nope"] }, actor),
    ).rejects.toMatchObject({
      code: KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED.code,
    });
    expect(prisma.userCluster.deleteMany).not.toHaveBeenCalled();
  });

  it("clears every assignment when given an empty list", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...selectedUser,
      userClusters: [{ clusterId: "prod" }],
    });

    await service.setClusters("user-1", { clusterIds: [] }, actor);

    expect(prisma.userCluster.deleteMany).toHaveBeenCalled();
    expect(prisma.userCluster.createMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("rejects assigning clusters to a missing user", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.setClusters("missing", { clusterIds: ["prod"] }, actor),
    ).rejects.toMatchObject({ code: USER_ERROR.NOT_FOUND.code });
    expect(prisma.userCluster.deleteMany).not.toHaveBeenCalled();
  });
});
