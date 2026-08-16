import { Logger } from "@nestjs/common";
import { ExceptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ExceptionLifecycleService,
  ReconcileCandidate,
} from "./exception-lifecycle.service";
import { ExceptionReconcilerService } from "./exception-reconciler.service";

function candidate(id: string, targetClusterId: string): ReconcileCandidate {
  return {
    id,
    status: ExceptionStatus.APPLYING,
    expiresAt: new Date(Date.now() + 60_000),
    targetClusterId,
    k8sExceptionName: `exception-${id}`,
    policyName: "policy",
    appliedRuleNames: ["rule"],
    resourceKind: "Deployment",
    resourceName: "api",
    resourceNamespace: "default",
    applyAttempts: 0,
    lastError: null,
    nextAttemptAt: null,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ExceptionReconcilerService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs clusters in parallel while preserving sequential work within each cluster", async () => {
    const candidates = [
      candidate("slow-1", "slow"),
      candidate("fast-1", "fast"),
      candidate("slow-2", "slow"),
      candidate("fast-2", "fast"),
    ];
    const slowRelease = deferred();
    const fastFinished = deferred();
    const events: string[] = [];
    const reconcile = jest.fn(async (request: ReconcileCandidate) => {
      events.push(`${request.id}:start`);
      if (request.id === "slow-1") {
        await slowRelease.promise;
        throw new Error("slow cluster unavailable");
      }
      events.push(`${request.id}:end`);
      if (request.id === "fast-2") fastFinished.resolve();
    });
    const queryRaw = jest.fn().mockResolvedValue(candidates);
    const prisma = {
      $transaction: jest.fn(async (operation) =>
        operation({ $queryRaw: queryRaw }),
      ),
    } as unknown as PrismaService;
    const service = new ExceptionReconcilerService(prisma, {
      reconcile,
    } as unknown as ExceptionLifecycleService);
    const errorLog = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);

    const batch = service.reconcileBatch();
    await fastFinished.promise;

    expect(events).toEqual([
      "slow-1:start",
      "fast-1:start",
      "fast-1:end",
      "fast-2:start",
      "fast-2:end",
    ]);
    expect(reconcile).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "slow-2" }),
    );

    slowRelease.resolve();
    await batch;

    expect(events.at(-1)).toBe("slow-2:end");
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("slow-1 in cluster slow"),
      expect.any(String),
    );
  });

  it("blocks overlapping batches and releases the guard after completion", async () => {
    const release = deferred();
    const started = deferred();
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([candidate("request-1", "local")])
      .mockResolvedValueOnce([]);
    const prisma = {
      $transaction: jest.fn(async (operation) =>
        operation({ $queryRaw: queryRaw }),
      ),
    } as unknown as PrismaService;
    const reconcile = jest.fn(async () => {
      started.resolve();
      await release.promise;
    });
    const service = new ExceptionReconcilerService(prisma, {
      reconcile,
    } as unknown as ExceptionLifecycleService);

    const first = service.reconcileBatch();
    await started.promise;
    await service.reconcileBatch();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    release.resolve();
    await first;
    await service.reconcileBatch();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
