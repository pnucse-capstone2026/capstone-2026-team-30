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
const RECONCILE_CLAIM_TTL_SECONDS = 60;
const APPROVED_RECHECK_INTERVAL_SECONDS = 5 * 60;

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
   * 후보를 잠근 채 `nextAttemptAt` 을 짧은 lease 로 갱신한다. 조회 transaction 이
   * 끝난 뒤에도 다른 인스턴스는 lease 가 만료되기 전까지 같은 작업을 선택하지 않는다.
   * 정상 APPROVED 는 `updatedAt` 기준으로 주기 점검하고, 실패 건은 기존 backoff 를
   * 그대로 따른다.
   */
  private selectReconcileCandidates(): Promise<ReconcileCandidate[]> {
    return this.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<ReconcileCandidate[]>(Prisma.sql`
        WITH candidates AS (
          SELECT
            "id",
            CASE
              WHEN "status" IN (
                ${ExceptionStatus.APPLYING}::"ExceptionStatus",
                ${ExceptionStatus.APPROVED}::"ExceptionStatus"
              ) AND "expiresAt" <= NOW() THEN 0
              WHEN "status" IN (
                ${ExceptionStatus.EXPIRING}::"ExceptionStatus",
                ${ExceptionStatus.CANCELLING}::"ExceptionStatus"
              ) THEN 1
              WHEN "status" = ${ExceptionStatus.APPLYING}::"ExceptionStatus" THEN 2
              ELSE 3
            END AS priority,
            CASE
              WHEN "status" IN (
                ${ExceptionStatus.APPLYING}::"ExceptionStatus",
                ${ExceptionStatus.APPROVED}::"ExceptionStatus"
              ) AND "expiresAt" <= NOW() THEN "expiresAt"
              ELSE COALESCE("nextAttemptAt", "updatedAt")
            END AS "dueAt"
          FROM "PolicyExceptionRequest"
          WHERE
            (
              "status" IN (
                ${ExceptionStatus.APPLYING}::"ExceptionStatus",
                ${ExceptionStatus.APPROVED}::"ExceptionStatus"
              )
              AND "expiresAt" <= NOW()
            )
            OR (
              "status" = ${ExceptionStatus.APPROVED}::"ExceptionStatus"
              AND (
                "nextAttemptAt" <= NOW()
                OR (
                  "nextAttemptAt" IS NULL
                  AND "updatedAt" <= NOW() - (
                    ${APPROVED_RECHECK_INTERVAL_SECONDS} * INTERVAL '1 second'
                  )
                )
              )
            )
            OR (
              "status" IN (
                ${ExceptionStatus.APPLYING}::"ExceptionStatus",
                ${ExceptionStatus.CANCELLING}::"ExceptionStatus",
                ${ExceptionStatus.EXPIRING}::"ExceptionStatus"
              )
              AND (
                "nextAttemptAt" IS NULL
                OR "nextAttemptAt" <= NOW()
              )
            )
          ORDER BY priority, "dueAt", "updatedAt"
          LIMIT ${RECONCILE_BATCH_LIMIT}
          FOR UPDATE SKIP LOCKED
        ), claimed AS (
          UPDATE "PolicyExceptionRequest" AS request
          SET "nextAttemptAt" = NOW() + (
            ${RECONCILE_CLAIM_TTL_SECONDS} * INTERVAL '1 second'
          )
          FROM candidates
          WHERE request."id" = candidates."id"
          RETURNING request.*
        )
        SELECT
          claimed."id",
          claimed."status",
          claimed."expiresAt",
          claimed."targetClusterId",
          claimed."k8sExceptionName",
          claimed."policyName",
          claimed."appliedRuleNames",
          claimed."resourceKind",
          claimed."resourceName",
          claimed."resourceNamespace",
          claimed."applyAttempts",
          claimed."lastError",
          claimed."nextAttemptAt"
        FROM claimed
        JOIN candidates ON candidates."id" = claimed."id"
        ORDER BY candidates.priority, candidates."dueAt"
      `);
    });
  }
}
