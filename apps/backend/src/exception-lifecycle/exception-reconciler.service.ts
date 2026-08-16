import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { ExceptionStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ExceptionLifecycleService,
  ReconcileCandidate,
} from "./exception-lifecycle.service";

const RECONCILE_INTERVAL_MS = 10_000;
const RECONCILE_BATCH_LIMIT = 50;

@Injectable()
export class ExceptionReconcilerService {
  private readonly logger = new Logger(ExceptionReconcilerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ExceptionLifecycleService,
  ) {}

  @Interval(RECONCILE_INTERVAL_MS)
  async reconcileBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const requests = await this.selectReconcileCandidates();
      const requestsByCluster = new Map<string, ReconcileCandidate[]>();
      for (const request of requests) {
        const group = requestsByCluster.get(request.targetClusterId);
        if (group) group.push(request);
        else requestsByCluster.set(request.targetClusterId, [request]);
      }

      await Promise.all(
        [...requestsByCluster.values()].map((clusterRequests) =>
          this.reconcileCluster(clusterRequests),
        ),
      );
    } finally {
      this.running = false;
    }
  }

  private async reconcileCluster(
    requests: ReconcileCandidate[],
  ): Promise<void> {
    for (const request of requests) {
      try {
        await this.lifecycle.reconcile(request);
      } catch (error) {
        this.logger.error(
          `Exception reconciliation failed for ${request.id} in cluster ${request.targetClusterId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  /**
   * `FOR UPDATE SKIP LOCKED` 는 이 조회 트랜잭션이 끝나면 함께 풀린다. 따라서
   * 이 메서드는 행을 지속적으로 claim하지 않고 후보만 고른다. 실제 중복 전이는
   * lifecycle의 상태 조건부 updateMany(CAS)가 막는다.
   */
  private selectReconcileCandidates(): Promise<ReconcileCandidate[]> {
    return this.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<ReconcileCandidate[]>(Prisma.sql`
        SELECT
          "id",
          "status",
          "expiresAt",
          "targetClusterId",
          "k8sExceptionName",
          "policyName",
          "appliedRuleNames",
          "resourceKind",
          "resourceName",
          "resourceNamespace",
          "applyAttempts",
          "lastError",
          "nextAttemptAt"
        FROM "PolicyExceptionRequest"
        WHERE "status" IN (
          ${ExceptionStatus.APPLYING}::"ExceptionStatus",
          ${ExceptionStatus.APPROVED}::"ExceptionStatus",
          ${ExceptionStatus.CANCELLING}::"ExceptionStatus",
          ${ExceptionStatus.EXPIRING}::"ExceptionStatus"
        )
        AND (
          (
            "status" IN (
              ${ExceptionStatus.APPLYING}::"ExceptionStatus",
              ${ExceptionStatus.APPROVED}::"ExceptionStatus"
            )
            AND "expiresAt" <= NOW()
          )
          OR "nextAttemptAt" IS NULL
          OR "nextAttemptAt" <= NOW()
        )
        ORDER BY
          CASE WHEN "expiresAt" <= NOW() THEN 0 ELSE 1 END,
          "updatedAt" ASC
        LIMIT ${RECONCILE_BATCH_LIMIT}
        FOR UPDATE SKIP LOCKED
      `);
    });
  }
}
