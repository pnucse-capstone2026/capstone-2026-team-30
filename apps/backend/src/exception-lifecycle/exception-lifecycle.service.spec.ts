import {
  AuditActorType,
  ExceptionStatus,
  PolicyExceptionRequest,
} from "@prisma/client";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { ExceptionReconcileSettings } from "./exception-reconcile.settings";
import { EXCEPTION_LIFECYCLE_ERROR } from "./exception-lifecycle.errors";
import {
  ClaimedReconcileCandidate,
  ExceptionLifecycleService,
} from "./exception-lifecycle.service";

function request(
  overrides: Partial<PolicyExceptionRequest> = {},
): PolicyExceptionRequest {
  const now = new Date();
  return {
    id: "request-1",
    status: ExceptionStatus.PENDING,
    reason: "temporary migration",
    policyName: "require-labels",
    ruleNames: ["require-team"],
    appliedRuleNames: [],
    resourceKind: "Deployment",
    resourceName: "api",
    resourceNamespace: "production",
    targetClusterId: "local",
    targetClusterDisplayName: "Local",
    k8sExceptionName: "exception-request-1",
    expiresAt: new Date(now.getTime() + 60_000),
    decisionNote: null,
    decidedAt: null,
    activatedAt: null,
    applyAttempts: 0,
    lastError: null,
    nextAttemptAt: null,
    reconcileClaimId: null,
    reconcileLeaseUntil: null,
    createdAt: now,
    updatedAt: now,
    requestUserId: "requester-1",
    approverUserId: null,
    ...overrides,
  };
}

function harness(initial = request()) {
  let current = { ...initial };
  const audits: Array<Record<string, unknown>> = [];
  const policyExceptionRequest = {
    updateMany: jest.fn(async ({ where, data }) => {
      if (where.id !== current.id || where.status !== current.status) {
        return { count: 0 };
      }
      if (
        where.applyAttempts !== undefined &&
        where.applyAttempts !== current.applyAttempts
      ) {
        return { count: 0 };
      }
      if (
        where.reconcileClaimId !== undefined &&
        where.reconcileClaimId !== current.reconcileClaimId
      ) {
        return { count: 0 };
      }
      if (where.expiresAt?.gt && current.expiresAt <= where.expiresAt.gt) {
        return { count: 0 };
      }
      if (where.expiresAt?.lte && current.expiresAt > where.expiresAt.lte) {
        return { count: 0 };
      }
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    }),
    findUnique: jest.fn(async ({ where }) =>
      where.id === current.id ? { ...current } : null,
    ),
  };
  const tx = {
    policyExceptionRequest,
    $queryRaw: jest.fn().mockImplementation(async () => [{ now: new Date() }]),
    auditLog: {
      create: jest.fn(async ({ data }) => {
        audits.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    policyExceptionRequest,
    runSerializableTransaction: jest.fn(async (operation) => operation(tx)),
    $executeRaw: jest.fn(async () => {
      current = {
        ...current,
        reconcileClaimId: null,
        reconcileLeaseUntil: null,
      };
      return 1;
    }),
  } as unknown as PrismaService;
  const kyverno = {
    ensurePolicyException: jest.fn().mockResolvedValue(undefined),
    deletePolicyException: jest.fn().mockResolvedValue(undefined),
  } as unknown as KyvernoAdapter;

  const settings = {
    claimTtlSeconds: 60,
    approvedRecheckIntervalSeconds: 300,
  } as ExceptionReconcileSettings;

  return {
    service: new ExceptionLifecycleService(prisma, kyverno, settings),
    kyverno: kyverno as unknown as {
      ensurePolicyException: jest.Mock;
      deletePolicyException: jest.Mock;
    },
    audits,
    current: () => current,
    claim: (): ClaimedReconcileCandidate => {
      current = {
        ...current,
        reconcileClaimId: "00000000-0000-4000-8000-000000000001",
        reconcileLeaseUntil: new Date(Date.now() + 60_000),
      };
      return current as ClaimedReconcileCandidate;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ExceptionLifecycleService", () => {
  it("records a user decision and system activation separately", async () => {
    const context = harness();

    const result = await context.service.approve(
      "request-1",
      "approver-1",
      ["require-team", "autogen-require-team"],
      "approved",
    );

    expect(result.status).toBe(ExceptionStatus.APPROVED);
    expect(result.activatedAt).toBeInstanceOf(Date);
    expect(context.audits).toEqual([
      expect.objectContaining({
        action: "EXCEPTION_APPROVED",
        actorType: AuditActorType.USER,
        beforeStatus: ExceptionStatus.PENDING,
        afterStatus: ExceptionStatus.APPLYING,
      }),
      expect.objectContaining({
        action: "EXCEPTION_ACTIVATED",
        actorType: AuditActorType.SYSTEM,
        beforeStatus: ExceptionStatus.APPLYING,
        afterStatus: ExceptionStatus.APPROVED,
      }),
    ]);
  });

  it("keeps APPLYING after Kubernetes failure so reconciliation can retry", async () => {
    const context = harness();
    const beforeFailure = Date.now();
    context.kyverno.ensurePolicyException.mockRejectedValueOnce(
      new Error("cluster unavailable"),
    );

    const result = await context.service.approve("request-1", "approver-1", [
      "require-team",
    ]);

    expect(result.status).toBe(ExceptionStatus.APPLYING);
    expect(result).toMatchObject({
      applyAttempts: 1,
      lastError: "cluster unavailable",
    });
    expect(result.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(
      beforeFailure + 10_000,
    );
    expect(context.audits).toHaveLength(1);

    await context.service.reconcile(context.claim());
    expect(context.current().status).toBe(ExceptionStatus.APPROVED);
    expect(context.current()).toMatchObject({
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
    expect(context.kyverno.ensurePolicyException).toHaveBeenCalledTimes(2);
  });

  it("moves APPLYING to FAILED at the retry limit and records a system audit", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.APPLYING,
        appliedRuleNames: ["require-team"],
        applyAttempts: 9,
        lastError: "previous failure",
        nextAttemptAt: new Date(Date.now() - 1),
      }),
    );
    context.kyverno.ensurePolicyException.mockRejectedValue(
      new Error("permanent failure"),
    );

    await context.service.reconcile(context.claim());

    expect(context.current()).toMatchObject({
      status: ExceptionStatus.FAILED,
      applyAttempts: 10,
      lastError: "permanent failure",
      nextAttemptAt: null,
    });
    expect(context.audits).toEqual([
      expect.objectContaining({
        action: "EXCEPTION_APPLY_FAILED",
        actorType: AuditActorType.SYSTEM,
        beforeStatus: ExceptionStatus.APPLYING,
        afterStatus: ExceptionStatus.FAILED,
        metadata: {
          attempts: 10,
          error: "permanent failure",
          errorKind: "Error",
        },
      }),
    ]);
  });

  it("restores a FAILED request to APPLYING on retry and clears the counters", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.FAILED,
        appliedRuleNames: ["require-team"],
        applyAttempts: 10,
        lastError: "permanent failure",
      }),
    );

    await context.service.retry("request-1", "admin-1");

    expect(context.current()).toMatchObject({
      status: ExceptionStatus.APPROVED,
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
    expect(context.audits[0]).toMatchObject({
      action: "EXCEPTION_APPLY_RETRIED",
      beforeStatus: ExceptionStatus.FAILED,
      afterStatus: ExceptionStatus.APPLYING,
    });
  });

  it("refuses to retry a request that is not FAILED", async () => {
    const context = harness(request({ status: ExceptionStatus.APPROVED }));

    await expect(
      context.service.retry("request-1", "admin-1"),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION.code,
    });
  });

  it("keeps APPROVED repair failures retryable beyond the apply limit", async () => {
    const beforeFailure = Date.now();
    const context = harness(
      request({
        status: ExceptionStatus.APPROVED,
        appliedRuleNames: ["require-team"],
        applyAttempts: 9,
      }),
    );
    context.kyverno.ensurePolicyException.mockRejectedValue(
      new Error("repair failed"),
    );

    await context.service.reconcile(context.claim());

    expect(context.current()).toMatchObject({
      status: ExceptionStatus.APPROVED,
      applyAttempts: 10,
      lastError: "repair failed",
    });
    expect(context.current().nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(
      beforeFailure + 300_000,
    );
    expect(context.current().nextAttemptAt?.getTime()).toBeLessThanOrEqual(
      Date.now() + 300_000,
    );
    expect(context.audits).toHaveLength(0);
  });

  it("truncates the persisted failure detail to the database limit", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.APPLYING,
        appliedRuleNames: ["require-team"],
      }),
    );
    context.kyverno.ensurePolicyException.mockRejectedValue(
      new Error("x".repeat(1_200)),
    );

    await context.service.reconcile(context.claim());

    expect(context.current().lastError).toHaveLength(1_000);
  });

  it("clears repair failure details after APPROVED reconciliation succeeds", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.APPROVED,
        appliedRuleNames: ["require-team"],
        applyAttempts: 2,
        lastError: "temporary failure",
        nextAttemptAt: new Date(Date.now() - 1),
      }),
    );

    await context.service.reconcile(context.claim());

    expect(context.current()).toMatchObject({
      status: ExceptionStatus.APPROVED,
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
  });

  it("releases a healthy APPROVED reconciliation claim and refreshes updatedAt", async () => {
    const previousUpdatedAt = new Date(Date.now() - 10 * 60_000);
    const context = harness(
      request({
        status: ExceptionStatus.APPROVED,
        appliedRuleNames: ["require-team"],
        nextAttemptAt: new Date(Date.now() + 60_000),
        updatedAt: previousUpdatedAt,
      }),
    );

    await context.service.reconcile(context.claim());

    expect(context.current()).toMatchObject({
      status: ExceptionStatus.APPROVED,
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
    expect(context.current().updatedAt.getTime()).toBeGreaterThan(
      previousUpdatedAt.getTime(),
    );
  });

  it("keeps CANCELLING if deletion fails and completes on retry", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.APPROVED,
        appliedRuleNames: ["require-team"],
        applyAttempts: 9,
        lastError: "previous failure",
      }),
    );
    context.kyverno.deletePolicyException.mockRejectedValueOnce(
      new Error("timeout"),
    );

    const result = await context.service.cancel("request-1", "requester-1");
    expect(result.status).toBe(ExceptionStatus.CANCELLING);
    expect(result).toMatchObject({
      status: ExceptionStatus.CANCELLING,
      applyAttempts: 10,
      lastError: "timeout",
    });

    await context.service.reconcile(context.claim());
    expect(context.current().status).toBe(ExceptionStatus.CANCELLED);
    expect(context.audits.at(-1)).toEqual(
      expect.objectContaining({
        action: "EXCEPTION_CANCELLED",
        actorType: AuditActorType.SYSTEM,
      }),
    );
  });

  it("defers cancellation while another owner is applying and then cleans up", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.APPLYING,
        appliedRuleNames: ["require-team"],
      }),
    );
    const active = context.claim();
    const started = deferred();
    const release = deferred();
    context.kyverno.ensurePolicyException.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });

    const applying = context.service.reconcile(active);
    await started.promise;
    const cancelling = await context.service.cancel("request-1", "requester-1");

    expect(cancelling.status).toBe(ExceptionStatus.CANCELLING);
    expect(context.kyverno.deletePolicyException).not.toHaveBeenCalled();

    release.resolve();
    await applying;
    expect(context.current()).toMatchObject({
      status: ExceptionStatus.CANCELLING,
      reconcileClaimId: null,
      reconcileLeaseUntil: null,
    });

    await context.service.reconcile(context.claim());
    expect(context.current().status).toBe(ExceptionStatus.CANCELLED);
    expect(context.kyverno.deletePolicyException).toHaveBeenCalledTimes(1);
  });

  it("allows a FAILED request to be cancelled and cleaned up", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.FAILED,
        appliedRuleNames: ["require-team"],
        applyAttempts: 10,
        lastError: "permanent failure",
      }),
    );

    const result = await context.service.cancel("request-1", "requester-1");

    expect(result).toMatchObject({
      status: ExceptionStatus.CANCELLED,
      applyAttempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
    expect(context.kyverno.deletePolicyException).toHaveBeenCalledTimes(1);
  });

  it("expires an APPLYING request without activating it", async () => {
    const context = harness(
      request({
        status: ExceptionStatus.APPLYING,
        appliedRuleNames: ["require-team"],
        expiresAt: new Date(Date.now() - 1),
      }),
    );

    await context.service.reconcile(context.claim());

    expect(context.current().status).toBe(ExceptionStatus.EXPIRED);
    expect(context.kyverno.ensurePolicyException).not.toHaveBeenCalled();
    expect(context.kyverno.deletePolicyException).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent approval transition", async () => {
    const context = harness();

    const outcomes = await Promise.allSettled([
      context.service.approve("request-1", "approver-1", ["require-team"]),
      context.service.approve("request-1", "approver-2", ["require-team"]),
    ]);

    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected).toEqual(
      expect.objectContaining({
        reason: expect.objectContaining({
          code: EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION.code,
        }),
      }),
    );
  });
});
