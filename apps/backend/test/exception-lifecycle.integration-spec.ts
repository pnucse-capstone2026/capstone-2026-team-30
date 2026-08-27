import { Logger } from "@nestjs/common";
import { AuditActorType, ExceptionStatus, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isBusinessException } from "../src/common/errors/business.exception";
import { ExceptionReconcileSettings } from "../src/exception-lifecycle/exception-reconcile.settings";
import { EXCEPTION_LIFECYCLE_ERROR } from "../src/exception-lifecycle/exception-lifecycle.errors";
import {
  ClaimedReconcileCandidate,
  ExceptionLifecycleService,
} from "../src/exception-lifecycle/exception-lifecycle.service";
import { ExceptionReconcilerService } from "../src/exception-lifecycle/exception-reconciler.service";
import { KyvernoAdapter } from "../src/kubernetes/kyverno.adapter";
import { PrismaService } from "../src/prisma/prisma.service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("policy exception lifecycle transactions", () => {
  let prisma: PrismaService;
  let lifecycle: ExceptionLifecycleService;
  let reconciler: ExceptionReconcilerService;
  const kyverno = {
    ensurePolicyException: jest.fn().mockResolvedValue(undefined),
    deletePolicyException: jest.fn().mockResolvedValue(undefined),
  };
  const settings = {
    claimTtlSeconds: 60,
    approvedRecheckIntervalSeconds: 300,
  } as ExceptionReconcileSettings;

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
      settings,
    );
    reconciler = new ExceptionReconcilerService(prisma, lifecycle, settings);
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
    const active = await claimRequest(request.id);

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
    const active = await claimRequest(request.id);

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

  it("claims a non-expired request once across concurrent reconcilers", async () => {
    const { request } = await createPendingRequest("reconcile-claim", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
    });
    const started = deferred();
    const release = deferred();
    kyverno.ensurePolicyException.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });
    const otherReconciler = new ExceptionReconcilerService(
      prisma,
      lifecycle,
      settings,
    );

    const firstBatch = reconciler.reconcileBatch();
    await started.promise;
    await otherReconciler.reconcileBatch();

    expect(kyverno.ensurePolicyException).toHaveBeenCalledTimes(1);
    release.resolve();
    await firstBatch;
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: ExceptionStatus.APPROVED });
  });

  it("skips a queued request after another reconciler takes over its claim", async () => {
    const staleUpdatedAt = new Date(Date.now() - 2 * 60_000);
    const { request: first } = await createPendingRequest("queued-first", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
      updatedAt: staleUpdatedAt,
    });
    const { request: second } = await createPendingRequest("queued-second", {
      status: ExceptionStatus.APPLYING,
      appliedRuleNames: ["rule"],
      updatedAt: new Date(staleUpdatedAt.getTime() + 1_000),
    });
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const secondStarted = deferred();
    const releaseSecond = deferred();
    kyverno.ensurePolicyException.mockImplementation(
      async (_clusterId: string, input: { requestId: string }) => {
        if (input.requestId === first.id) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        if (input.requestId === second.id) {
          secondStarted.resolve();
          await releaseSecond.promise;
        }
      },
    );
    const otherReconciler = new ExceptionReconcilerService(
      prisma,
      lifecycle,
      settings,
    );

    const firstBatch = reconciler.reconcileBatch();
    await firstStarted.promise;
    await prisma.policyExceptionRequest.update({
      where: { id: second.id },
      data: { reconcileLeaseUntil: new Date(Date.now() - 1) },
    });
    const secondBatch = otherReconciler.reconcileBatch();
    await secondStarted.promise;

    releaseFirst.resolve();
    await firstBatch;
    expect(
      kyverno.ensurePolicyException.mock.calls.filter(
        ([, input]) => input.requestId === second.id,
      ),
    ).toHaveLength(1);

    releaseSecond.resolve();
    await secondBatch;
    await expect(
      prisma.policyExceptionRequest.findMany({
        where: { id: { in: [first.id, second.id] } },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          status: ExceptionStatus.APPROVED,
        }),
        expect.objectContaining({
          id: second.id,
          status: ExceptionStatus.APPROVED,
        }),
      ]),
    );
  });

  it("keeps the expiration claim while Kubernetes deletion is in flight", async () => {
    const { request } = await createPendingRequest("expiration-lease", {
      status: ExceptionStatus.APPROVED,
      appliedRuleNames: ["rule"],
      expiresAt: new Date(Date.now() - 1_000),
      createdAt: new Date(Date.now() - 5_000),
      activatedAt: new Date(Date.now() - 2_000),
    });
    const deletionStarted = deferred();
    const releaseDeletion = deferred();
    kyverno.deletePolicyException.mockImplementationOnce(async () => {
      deletionStarted.resolve();
      await releaseDeletion.promise;
    });
    const otherReconciler = new ExceptionReconcilerService(
      prisma,
      lifecycle,
      settings,
    );

    const firstBatch = reconciler.reconcileBatch();
    await deletionStarted.promise;
    await otherReconciler.reconcileBatch();

    expect(kyverno.deletePolicyException).toHaveBeenCalledTimes(1);
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.EXPIRING,
      reconcileClaimId: expect.any(String),
      reconcileLeaseUntil: expect.any(Date),
    });

    releaseDeletion.resolve();
    await firstBatch;
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.EXPIRED,
      reconcileClaimId: null,
      reconcileLeaseUntil: null,
    });
  });

  it("converges to CANCELLED when cancellation races with apply", async () => {
    const { request, approver, requester } =
      await createPendingRequest("apply-cancel-race");
    const applyStarted = deferred();
    const releaseApply = deferred();
    kyverno.ensurePolicyException.mockImplementationOnce(async () => {
      applyStarted.resolve();
      await releaseApply.promise;
    });

    const applying = lifecycle.approve(request.id, approver.id, ["rule"]);
    await applyStarted.promise;
    const cancelling = await lifecycle.cancel(request.id, requester.id);

    expect(cancelling.status).toBe(ExceptionStatus.CANCELLING);
    expect(kyverno.deletePolicyException).not.toHaveBeenCalled();

    releaseApply.resolve();
    await expect(applying).resolves.toMatchObject({
      status: ExceptionStatus.CANCELLING,
    });
    await reconciler.reconcileBatch();

    expect(kyverno.ensurePolicyException).toHaveBeenCalledTimes(1);
    expect(kyverno.deletePolicyException).toHaveBeenCalledTimes(1);
    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: ExceptionStatus.CANCELLED,
      reconcileClaimId: null,
      reconcileLeaseUntil: null,
    });
    await expect(
      prisma.auditLog.findMany({ where: { entityId: request.id } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "EXCEPTION_APPROVED" }),
        expect.objectContaining({ action: "EXCEPTION_CANCEL_REQUESTED" }),
        expect.objectContaining({ action: "EXCEPTION_CANCELLED" }),
      ]),
    );
    await expect(
      prisma.auditLog.count({
        where: { entityId: request.id, action: "EXCEPTION_ACTIVATED" },
      }),
    ).resolves.toBe(0);
  });

  it("rechecks a healthy APPROVED request every five minutes", async () => {
    const staleUpdatedAt = new Date(Date.now() - 6 * 60_000);
    const { request } = await createPendingRequest("approved-recheck", {
      status: ExceptionStatus.APPROVED,
      appliedRuleNames: ["rule"],
      activatedAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    });

    await reconciler.reconcileBatch();
    expect(kyverno.ensurePolicyException).toHaveBeenCalledTimes(1);
    const reconciled = await prisma.policyExceptionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(reconciled.nextAttemptAt).toBeNull();
    expect(reconciled.updatedAt.getTime()).toBeGreaterThan(
      staleUpdatedAt.getTime(),
    );

    await reconciler.reconcileBatch();
    expect(kyverno.ensurePolicyException).toHaveBeenCalledTimes(1);

    await prisma.policyExceptionRequest.update({
      where: { id: request.id },
      data: { updatedAt: staleUpdatedAt },
    });
    await reconciler.reconcileBatch();
    expect(kyverno.ensurePolicyException).toHaveBeenCalledTimes(2);
  });

  it("prioritizes APPLYING work over a full batch of APPROVED checks", async () => {
    const staleUpdatedAt = new Date(Date.now() - 6 * 60_000);
    const { request, requester } = await createPendingRequest(
      "priority-applying",
      {
        status: ExceptionStatus.APPLYING,
        appliedRuleNames: ["rule"],
      },
    );
    await prisma.policyExceptionRequest.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        id: `integration-priority-approved-${index}`,
        status: ExceptionStatus.APPROVED,
        reason: "integration test",
        policyName: "policy",
        ruleNames: ["rule"],
        appliedRuleNames: ["rule"],
        resourceKind: "Deployment",
        resourceName: `api-${index}`,
        resourceNamespace: "default",
        targetClusterId: "local",
        targetClusterDisplayName: "Local",
        k8sExceptionName: `pac-exception-priority-approved-${index}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: staleUpdatedAt,
        updatedAt: staleUpdatedAt,
        activatedAt: staleUpdatedAt,
        requestUserId: requester.id,
      })),
    });

    await reconciler.reconcileBatch();

    await expect(
      prisma.policyExceptionRequest.findUnique({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: ExceptionStatus.APPROVED });
    expect(kyverno.ensurePolicyException).toHaveBeenCalledTimes(50);
    expect(kyverno.ensurePolicyException.mock.calls[0][1]).toEqual(
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
      const current = await claimRequest(request.id);
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
    const active = await claimRequest(request.id);
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
      updatedAt: Date;
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
        updatedAt: overrides.updatedAt,
        activatedAt: overrides.activatedAt,
        applyAttempts: overrides.applyAttempts,
        lastError: overrides.lastError,
        nextAttemptAt: overrides.nextAttemptAt,
        requestUserId: requester.id,
      },
    });
    return { request, requester, approver };
  }

  async function claimRequest(
    requestId: string,
  ): Promise<ClaimedReconcileCandidate> {
    return prisma.policyExceptionRequest.update({
      where: { id: requestId },
      data: {
        reconcileClaimId: randomUUID(),
        reconcileLeaseUntil: new Date(Date.now() + 60_000),
      },
    }) as Promise<ClaimedReconcileCandidate>;
  }
});
