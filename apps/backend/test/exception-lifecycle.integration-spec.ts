import { Logger } from "@nestjs/common";
import { AuditActorType, ExceptionStatus, Role } from "@prisma/client";
import { isBusinessException } from "../src/common/errors/business.exception";
import { EXCEPTION_LIFECYCLE_ERROR } from "../src/exception-lifecycle/exception-lifecycle.errors";
import { ExceptionLifecycleService } from "../src/exception-lifecycle/exception-lifecycle.service";
import { ExceptionReconcilerService } from "../src/exception-lifecycle/exception-reconciler.service";
import { KyvernoAdapter } from "../src/kubernetes/kyverno.adapter";
import { PrismaService } from "../src/prisma/prisma.service";

describe("policy exception lifecycle transactions", () => {
  let prisma: PrismaService;
  let lifecycle: ExceptionLifecycleService;
  let reconciler: ExceptionReconcilerService;
  const kyverno = {
    ensurePolicyException: jest.fn().mockResolvedValue(undefined),
    deletePolicyException: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.",
      );
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    lifecycle = new ExceptionLifecycleService(
      prisma,
      kyverno as unknown as KyvernoAdapter,
    );
    reconciler = new ExceptionReconcilerService(prisma, lifecycle);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    kyverno.ensurePolicyException.mockResolvedValue(undefined);
    kyverno.deletePolicyException.mockResolvedValue(undefined);
    await prisma.auditLog.deleteMany();
    await prisma.policyExceptionRequest.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.policyExceptionRequest.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("rolls the state transition back when its audit insert fails", async () => {
    const { request, approver } = await createPendingRequest("atomic");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_exception_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'EXCEPTION_APPROVED' THEN
          RAISE EXCEPTION 'audit rejected by integration test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_exception_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION reject_exception_audit();
    `);

    try {
      await expect(
        lifecycle.approve(request.id, approver.id, ["rule"]),
      ).rejects.toThrow("audit rejected by integration test");
      await expect(
        prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
      ).resolves.toMatchObject({ status: ExceptionStatus.PENDING });
      await expect(
        prisma.auditLog.count({ where: { entityId: request.id } }),
      ).resolves.toBe(0);
      expect(kyverno.ensurePolicyException).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_exception_audit_trigger ON "AuditLog";',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS reject_exception_audit();",
      );
    }
  });

  it("persists user and system audits with a nullable system actor", async () => {
    const { request, approver } = await createPendingRequest("actors");

    await lifecycle.approve(request.id, approver.id, ["rule", "autogen-rule"]);

    const stored = await prisma.policyExceptionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const audits = await prisma.auditLog.findMany({
      where: { entityId: request.id },
      orderBy: { createdAt: "asc" },
    });
    expect(stored).toMatchObject({
      status: ExceptionStatus.APPROVED,
      approverUserId: approver.id,
      appliedRuleNames: ["rule", "autogen-rule"],
    });
    expect(audits).toEqual([
      expect.objectContaining({
        actorType: AuditActorType.USER,
        userId: approver.id,
        afterStatus: ExceptionStatus.APPLYING,
      }),
      expect.objectContaining({
        actorType: AuditActorType.SYSTEM,
        userId: null,
        afterStatus: ExceptionStatus.APPROVED,
      }),
    ]);
  });

  it("allows only one concurrent approval decision", async () => {
    const { request, approver } = await createPendingRequest("approval-race");
    const otherApprover = await prisma.user.create({
      data: {
        email: "other-approver@example.com",
        pwdHash: "hash",
        role: Role.APPROVER,
      },
    });

    const outcomes = await Promise.allSettled([
      lifecycle.approve(request.id, approver.id, ["rule"]),
      lifecycle.approve(request.id, otherApprover.id, ["rule"]),
    ]);

    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.some(
        (result) =>
          result.status === "rejected" &&
          isBusinessException(
            result.reason,
            EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION.code,
          ),
      ),
    ).toBe(true);
    await expect(
      prisma.auditLog.count({ where: { entityId: request.id } }),
    ).resolves.toBe(2);
  });

  it("claims an expired active request once under concurrent reconciliation", async () => {
    const { request } = await createPendingRequest("expiration-race", {
      status: ExceptionStatus.APPROVED,
      appliedRuleNames: ["rule"],
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 5000),
      activatedAt: new Date(Date.now() - 2000),
    });
    const active = await prisma.policyExceptionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });

    await Promise.all([
      lifecycle.reconcile(active),
      lifecycle.reconcile(active),
    ]);

    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: ExceptionStatus.EXPIRED });
    const audits = await prisma.auditLog.findMany({
      where: { entityId: request.id },
    });
    expect(
      audits.filter((audit) => audit.action === "EXCEPTION_EXPIRATION_STARTED"),
    ).toHaveLength(1);
    expect(
      audits.filter((audit) => audit.action === "EXCEPTION_EXPIRED"),
    ).toHaveLength(1);
  });

  it("recreates a missing CR for an APPROVED request", async () => {
    const { request } = await createPendingRequest("repair", {
      status: ExceptionStatus.APPROVED,
      appliedRuleNames: ["rule"],
      activatedAt: new Date(),
    });
    const active = await prisma.policyExceptionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });

    await lifecycle.reconcile(active);

    expect(kyverno.ensurePolicyException).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({ requestId: request.id, ruleNames: ["rule"] }),
    );
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: ExceptionStatus.APPROVED });
  });

  it("processes an APPLYING batch through FOR UPDATE SKIP LOCKED", async () => {
    const { request } = await createPendingRequest("reconcile-batch", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
    });

    await reconciler.reconcileBatch();

    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: ExceptionStatus.APPROVED });
    expect(kyverno.ensurePolicyException).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({ requestId: request.id }),
    );
  });

  it("skips a request whose retry time is still in the future", async () => {
    const { request } = await createPendingRequest("future-retry", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
      applyAttempts: 1,
      lastError: "temporary failure",
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    await reconciler.reconcileBatch();

    expect(kyverno.ensurePolicyException).not.toHaveBeenCalled();
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.APPLYING,
      applyAttempts: 1,
    });
  });

  it("expires an active request immediately even when retry is deferred", async () => {
    const { request } = await createPendingRequest("expired-deferred", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
      createdAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
      applyAttempts: 1,
      lastError: "temporary failure",
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    await reconciler.reconcileBatch();

    expect(kyverno.ensurePolicyException).not.toHaveBeenCalled();
    expect(kyverno.deletePolicyException).toHaveBeenCalledTimes(1);
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.EXPIRED,
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
  });

  it("keeps deletion backoff for an already expiring request", async () => {
    const { request } = await createPendingRequest("delete-backoff", {
      status: ExceptionStatus.EXPIRING,
      appliedRuleNames: ["rule"],
      createdAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
      applyAttempts: 2,
      lastError: "delete failed",
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    await reconciler.reconcileBatch();

    expect(kyverno.deletePolicyException).not.toHaveBeenCalled();
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.EXPIRING,
      applyAttempts: 2,
    });
  });

  it("persists FAILED and its system audit after repeated apply failures", async () => {
    const { request } = await createPendingRequest("apply-failed", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
    });
    kyverno.ensurePolicyException.mockRejectedValue(
      new Error("permanent Kubernetes failure"),
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await prisma.policyExceptionRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      await lifecycle.reconcile(current);
    }

    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.FAILED,
      applyAttempts: 10,
      lastError: "permanent Kubernetes failure",
      nextAttemptAt: null,
    });
    await expect(
      prisma.auditLog.findMany({ where: { entityId: request.id } }),
    ).resolves.toEqual([
      expect.objectContaining({
        action: "EXCEPTION_APPLY_FAILED",
        actorType: AuditActorType.SYSTEM,
        userId: null,
        beforeStatus: ExceptionStatus.APPLYING,
        afterStatus: ExceptionStatus.FAILED,
        metadata: {
          attempts: 10,
          error: "permanent Kubernetes failure",
          errorKind: "Error",
        },
      }),
    ]);

    jest.clearAllMocks();
    await reconciler.reconcileBatch();
    expect(kyverno.ensurePolicyException).not.toHaveBeenCalled();
  });

  it("brings a FAILED request back through retry", async () => {
    const { request, approver } = await createPendingRequest("retry", {
      status: ExceptionStatus.FAILED,
      appliedRuleNames: ["rule"],
      applyAttempts: 10,
      lastError: "permanent Kubernetes failure",
    });

    await lifecycle.retry(request.id, approver.id);

    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.APPROVED,
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
    await expect(
      prisma.auditLog.findMany({
        where: { entityId: request.id, action: "EXCEPTION_APPLY_RETRIED" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("records the FAILED transition once under concurrent final attempts", async () => {
    const { request } = await createPendingRequest("failed-race", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
      applyAttempts: 9,
      lastError: "previous failure",
      nextAttemptAt: new Date(Date.now() - 1),
    });
    kyverno.ensurePolicyException.mockRejectedValue(
      new Error("permanent Kubernetes failure"),
    );
    const active = await prisma.policyExceptionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const logError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    try {
      await Promise.all([
        lifecycle.reconcile(active),
        lifecycle.reconcile(active),
      ]);

      await expect(
        prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
      ).resolves.toMatchObject({
        status: ExceptionStatus.FAILED,
        applyAttempts: 10,
      });
      await expect(
        prisma.auditLog.count({
          where: {
            entityId: request.id,
            action: "EXCEPTION_APPLY_FAILED",
          },
        }),
      ).resolves.toBe(1);
      expect(logError).toHaveBeenCalledTimes(1);
    } finally {
      logError.mockRestore();
    }
  });

  async function createPendingRequest(
    suffix: string,
    overrides: Partial<{
      status: ExceptionStatus;
      appliedRuleNames: string[];
      expiresAt: Date;
      createdAt: Date;
      activatedAt: Date;
      applyAttempts: number;
      lastError: string;
      nextAttemptAt: Date;
    }> = {},
  ) {
    const requester = await prisma.user.create({
      data: {
        email: `requester-${suffix}@example.com`,
        pwdHash: "hash",
        role: Role.REQUESTER,
      },
    });
    const approver = await prisma.user.create({
      data: {
        email: `approver-${suffix}@example.com`,
        pwdHash: "hash",
        role: Role.APPROVER,
      },
    });
    const id = `integration-${suffix}`;
    const request = await prisma.policyExceptionRequest.create({
      data: {
        id,
        status: overrides.status ?? ExceptionStatus.PENDING,
        reason: "integration test",
        policyName: "policy",
        ruleNames: ["rule"],
        appliedRuleNames: overrides.appliedRuleNames ?? [],
        resourceKind: "Deployment",
        resourceName: "api",
        resourceNamespace: "default",
        targetClusterId: "local",
        targetClusterDisplayName: "Local",
        k8sExceptionName: `pac-exception-${suffix}`,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        createdAt: overrides.createdAt,
        activatedAt: overrides.activatedAt,
        applyAttempts: overrides.applyAttempts,
        lastError: overrides.lastError,
        nextAttemptAt: overrides.nextAttemptAt,
        requestUserId: requester.id,
      },
    });
    return { request, requester, approver };
  }
});
