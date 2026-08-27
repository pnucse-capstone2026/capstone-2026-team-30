import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { ExceptionStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ExceptionReconcileSettings } from "./exception-reconcile.settings";
import {
  ClaimedReconcileCandidate,
  ExceptionLifecycleService,
  ReconcileCandidate,
} from "./exception-lifecycle.service";

const RECONCILE_INTERVAL_MS = 10_000;
const RECONCILE_BATCH_LIMIT = 50;

type CandidateSelection = Omit<
  ReconcileCandidate,
  "reconcileClaimId" | "reconcileLeaseUntil"
> & {
  priority: number;
  dueAt: Date;
};

@Injectable()
export class ExceptionReconcilerService {
  private readonly logger = new Logger(ExceptionReconcilerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ExceptionLifecycleService,
    private readonly settings: ExceptionReconcileSettings,
  ) {}

  @Interval(RECONCILE_INTERVAL_MS)
  async reconcileBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const requests = await this.selectReconcileCandidates();
      const requestsByCluster = new Map<string, ClaimedReconcileCandidate[]>();
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
    requests: ClaimedReconcileCandidate[],
  ): Promise<void> {
    for (const request of requests) {
      const renewed = await this.renewClaim(request);
      if (!renewed) continue;

      try {
        await this.lifecycle.reconcile(renewed);
      } catch (error) {
        this.logger.error(
          `Exception reconciliation failed for ${request.id} in cluster ${request.targetClusterId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  /**
   * 후보 행을 잠근 transaction 안에서 실행 전용 claim을 기록한다. `nextAttemptAt`은
   * retry 일정으로만 사용하고, lease 획득·갱신은 도메인 `updatedAt`을 건드리지 않는다.
   */
  private selectReconcileCandidates(): Promise<ClaimedReconcileCandidate[]> {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<CandidateSelection[]>(Prisma.sql`
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
          "nextAttemptAt",
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
          END AS "priority",
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
            "reconcileLeaseUntil" IS NULL
            OR "reconcileLeaseUntil" <= NOW()
          )
          AND (
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
                    ${this.settings.approvedRecheckIntervalSeconds} * INTERVAL '1 second'
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
          )
        ORDER BY "priority", "dueAt", "updatedAt"
        LIMIT ${RECONCILE_BATCH_LIMIT}
        FOR UPDATE SKIP LOCKED
      `);
      if (candidates.length === 0) return [];

      const claims = candidates.map((candidate) => ({
        id: candidate.id,
        claimId: randomUUID(),
      }));
      const values = Prisma.join(
        claims.map(
          (claim) => Prisma.sql`(${claim.id}, ${claim.claimId}::uuid)`,
        ),
      );
      const claimed = await tx.$queryRaw<ClaimedReconcileCandidate[]>(
        Prisma.sql`
          UPDATE "PolicyExceptionRequest" AS request
          SET
            "reconcileClaimId" = claims."claimId",
            "reconcileLeaseUntil" = NOW() + (
              ${this.settings.claimTtlSeconds} * INTERVAL '1 second'
            )
          FROM (VALUES ${values}) AS claims("id", "claimId")
          WHERE request."id" = claims."id"
          RETURNING
            request."id",
            request."status",
            request."expiresAt",
            request."targetClusterId",
            request."k8sExceptionName",
            request."policyName",
            request."appliedRuleNames",
            request."resourceKind",
            request."resourceName",
            request."resourceNamespace",
            request."applyAttempts",
            request."lastError",
            request."nextAttemptAt",
            request."reconcileClaimId",
            request."reconcileLeaseUntil"
        `,
      );
      const claimedById = new Map(
        claimed.map((request) => [request.id, request]),
      );
      return candidates.flatMap((candidate) => {
        const request = claimedById.get(candidate.id);
        return request ? [request] : [];
      });
    });
  }

  private async renewClaim(
    request: ClaimedReconcileCandidate,
  ): Promise<ClaimedReconcileCandidate | null> {
    const renewed = await this.prisma.$queryRaw<
      Array<{ reconcileLeaseUntil: Date }>
    >(Prisma.sql`
      UPDATE "PolicyExceptionRequest"
      SET "reconcileLeaseUntil" = NOW() + (
        ${this.settings.claimTtlSeconds} * INTERVAL '1 second'
      )
      WHERE "id" = ${request.id}
        AND "status" = ${request.status}::"ExceptionStatus"
        AND "reconcileClaimId" = ${request.reconcileClaimId}::uuid
        AND "reconcileLeaseUntil" > NOW()
      RETURNING "reconcileLeaseUntil"
    `);
    if (!renewed[0]) return null;
    return { ...request, reconcileLeaseUntil: renewed[0].reconcileLeaseUntil };
  }
}
