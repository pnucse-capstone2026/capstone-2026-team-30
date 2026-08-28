import { Injectable, Logger } from "@nestjs/common";
import {
  AuditActorType,
  ExceptionStatus,
  PolicyExceptionRequest,
  Prisma,
} from "@prisma/client";
import { BusinessException } from "../common/errors/business.exception";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { GitOpsPublisherService } from "../gitops/gitops-publisher.service";
import { EXCEPTION_LIFECYCLE_ERROR } from "./exception-lifecycle.errors";

const ENTITY_TYPE = "PolicyExceptionRequest";
/**
 * 실패 원인을 가리지 않는다. 시스템이 이 횟수 안에 처리하지 못하면 붙들고 있지 말고
 * FAILED 로 보내 사람에게 넘긴다 — 감사 로그와 `lastError` 가 남고 retry 로 되살릴 수
 * 있다. 백오프와 합치면 약 25분이다.
 */
const APPLY_MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_CAP_MS = 300_000;
const LAST_ERROR_MAX_LENGTH = 1_000;

type TransactionClient = Prisma.TransactionClient;
type TransitionAction = "approved" | "rejected" | "cancelled";
type FailureRecord = {
  request: PolicyExceptionRequest;
  transitionedToFailed: boolean;
};

export type ReconcileCandidate = Pick<
  PolicyExceptionRequest,
  | "id"
  | "status"
  | "expiresAt"
  | "targetClusterId"
  | "k8sExceptionName"
  | "policyName"
  | "appliedRuleNames"
  | "resourceKind"
  | "resourceName"
  | "resourceNamespace"
  | "applyAttempts"
  | "lastError"
  | "nextAttemptAt"
>;

@Injectable()
export class ExceptionLifecycleService {
  private readonly logger = new Logger(ExceptionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kyverno: KyvernoAdapter,
    private readonly gitOpsPublisher?: GitOpsPublisherService,
  ) {}

  async approve(
    requestId: string,
    approverUserId: string,
    appliedRuleNames: string[],
    decisionNote?: string,
  ): Promise<PolicyExceptionRequest> {
    const decidedAt = new Date();
    const request = await this.prisma.runSerializableTransaction(async (tx) => {
      const changed = await tx.policyExceptionRequest.updateMany({
        where: {
          id: requestId,
          status: ExceptionStatus.PENDING,
          expiresAt: { gt: decidedAt },
        },
        data: {
          status: ExceptionStatus.APPLYING,
          appliedRuleNames,
          approverUserId,
          decisionNote,
          decidedAt,
        },
      });
      if (changed.count !== 1) return null;

      await this.audit(tx, {
        action: "EXCEPTION_APPROVED",
        entityId: requestId,
        actorType: AuditActorType.USER,
        userId: approverUserId,
        beforeStatus: ExceptionStatus.PENDING,
        afterStatus: ExceptionStatus.APPLYING,
        metadata: decisionNote ? { decisionNote } : undefined,
      });
      return tx.policyExceptionRequest.findUnique({
        where: { id: requestId },
      });
    });

    if (!request) await this.throwTransitionError(requestId, "approved");
    return this.tryApply(request as PolicyExceptionRequest);
  }

  async reject(
    requestId: string,
    approverUserId: string,
    decisionNote?: string,
  ): Promise<PolicyExceptionRequest> {
    const decidedAt = new Date();
    const request = await this.prisma.runSerializableTransaction(async (tx) => {
      const changed = await tx.policyExceptionRequest.updateMany({
        where: { id: requestId, status: ExceptionStatus.PENDING },
        data: {
          status: ExceptionStatus.REJECTED,
          approverUserId,
          decisionNote,
          decidedAt,
        },
      });
      if (changed.count !== 1) return null;

      await this.audit(tx, {
        action: "EXCEPTION_REJECTED",
        entityId: requestId,
        actorType: AuditActorType.USER,
        userId: approverUserId,
        beforeStatus: ExceptionStatus.PENDING,
        afterStatus: ExceptionStatus.REJECTED,
        metadata: decisionNote ? { decisionNote } : undefined,
      });
      return tx.policyExceptionRequest.findUnique({ where: { id: requestId } });
    });

    if (!request) await this.throwTransitionError(requestId, "rejected");
    return request as PolicyExceptionRequest;
  }

  /**
   * FAILED 는 리컨실 후보에서 제외되므로 스스로 빠져나오지 못한다. 클러스터가 회복된
   * 뒤 사람이 되살릴 수 있는 유일한 경로다. 소진 카운터를 0 으로 되돌려 재시도 예산을
   * 새로 준다.
   */
  async retry(
    requestId: string,
    actorUserId: string,
  ): Promise<PolicyExceptionRequest> {
    const request = await this.prisma.runSerializableTransaction(async (tx) => {
      const changed = await tx.policyExceptionRequest.updateMany({
        where: { id: requestId, status: ExceptionStatus.FAILED },
        data: {
          status: ExceptionStatus.APPLYING,
          applyAttempts: 0,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      if (changed.count !== 1) return null;

      await this.audit(tx, {
        action: "EXCEPTION_APPLY_RETRIED",
        entityId: requestId,
        actorType: AuditActorType.USER,
        userId: actorUserId,
        beforeStatus: ExceptionStatus.FAILED,
        afterStatus: ExceptionStatus.APPLYING,
      });
      return tx.policyExceptionRequest.findUnique({ where: { id: requestId } });
    });

    if (!request) {
      throw new BusinessException(
        EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION,
        {
          message: "Only a FAILED exception request can be retried.",
          context: { requestId, action: "retried" },
        },
      );
    }

    return this.tryApply(request);
  }

  async cancel(
    requestId: string,
    actorUserId: string,
  ): Promise<PolicyExceptionRequest> {
    const request = await this.prisma.runSerializableTransaction(async (tx) => {
      const current = await tx.policyExceptionRequest.findUnique({
        where: { id: requestId },
      });
      if (!current) return null;

      const afterStatus =
        current.status === ExceptionStatus.PENDING
          ? ExceptionStatus.CANCELLED
          : current.status === ExceptionStatus.APPLYING ||
              current.status === ExceptionStatus.APPROVED ||
              current.status === ExceptionStatus.FAILED
            ? ExceptionStatus.CANCELLING
            : null;
      if (!afterStatus) return current;

      const changed = await tx.policyExceptionRequest.updateMany({
        where: { id: requestId, status: current.status },
        data: { status: afterStatus, nextAttemptAt: null },
      });
      if (changed.count !== 1) return null;

      await this.audit(tx, {
        action: "EXCEPTION_CANCEL_REQUESTED",
        entityId: requestId,
        actorType: AuditActorType.USER,
        userId: actorUserId,
        beforeStatus: current.status,
        afterStatus,
      });
      return tx.policyExceptionRequest.findUnique({ where: { id: requestId } });
    });

    if (!request) await this.throwTransitionError(requestId, "cancelled");
    if (request?.status !== ExceptionStatus.CANCELLING) {
      if (request?.status !== ExceptionStatus.CANCELLED) {
        throw new BusinessException(
          EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION,
          {
            message: "Exception request cannot be cancelled.",
            context: {
              requestId,
              currentStatus: request?.status,
              action: "cancelled",
            },
          },
        );
      }
      return request;
    }
    return this.tryDelete(request, ExceptionStatus.CANCELLED);
  }

  async reconcile(request: ReconcileCandidate): Promise<void> {
    const now = new Date();
    if (
      request.expiresAt <= now &&
      (request.status === ExceptionStatus.APPLYING ||
        request.status === ExceptionStatus.APPROVED)
    ) {
      const expiring = await this.markExpiring(request);
      if (expiring) await this.tryDelete(expiring, ExceptionStatus.EXPIRED);
      return;
    }

    switch (request.status) {
      case ExceptionStatus.APPLYING:
        await this.tryApply(request);
        break;
      case ExceptionStatus.APPROVED:
        await this.tryEnsureApproved(request);
        break;
      case ExceptionStatus.CANCELLING:
        await this.tryDelete(request, ExceptionStatus.CANCELLED);
        break;
      case ExceptionStatus.EXPIRING:
        await this.tryDelete(request, ExceptionStatus.EXPIRED);
        break;
    }
  }

  private async tryApply(
    request: ReconcileCandidate,
  ): Promise<PolicyExceptionRequest> {
    if (request.expiresAt <= new Date()) {
      const expiring = await this.markExpiring(request);
      if (!expiring) return this.getRequired(request.id);
      return this.tryDelete(expiring, ExceptionStatus.EXPIRED);
    }

    try {
      await this.ensure(request);
      return await this.completeTransition(
        request.id,
        ExceptionStatus.APPLYING,
        ExceptionStatus.APPROVED,
        "EXCEPTION_ACTIVATED",
        { activatedAt: new Date() },
      );
    } catch (error) {
      const failure = await this.recordFailure(request, error);
      if (failure.transitionedToFailed) {
        this.logger.error(
          `PolicyException apply failed permanently for request ${request.id}: ${this.errorMessage(error)}`,
        );
      } else if (failure.request.status === request.status) {
        this.logger.warn(
          `PolicyException apply will be retried for request ${request.id}: ${this.errorMessage(error)}`,
        );
      }
      return failure.request;
    }
  }

  private async tryEnsureApproved(request: ReconcileCandidate): Promise<void> {
    try {
      await this.ensure(request);
      await this.clearFailure(request);
    } catch (error) {
      const failure = await this.recordFailure(request, error);
      if (failure.request.status === request.status) {
        this.logger.warn(
          `PolicyException repair will be retried for request ${request.id}: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private async tryDelete(
    request: ReconcileCandidate,
    target: ExceptionStatus,
  ): Promise<PolicyExceptionRequest> {
    const expected =
      target === ExceptionStatus.CANCELLED
        ? ExceptionStatus.CANCELLING
        : ExceptionStatus.EXPIRING;
    try {
      await this.kyverno.deletePolicyException(
        request.targetClusterId,
        request.k8sExceptionName,
      );
      const result = await this.completeTransition(
        request.id,
        expected,
        target,
        target === ExceptionStatus.CANCELLED
          ? "EXCEPTION_CANCELLED"
          : "EXCEPTION_EXPIRED",
      );
      if (this.gitOpsPublisher) {
        try {
          await this.gitOpsPublisher.unpublishManifest(
            request.id,
            request.resourceNamespace || "default",
          );
        } catch {
          // GitOps deletion failure does not affect runtime status
        }
      }
      return result;
    } catch (error) {
      const failure = await this.recordFailure(request, error);
      if (failure.request.status === request.status) {
        this.logger.warn(
          `PolicyException deletion will be retried for request ${request.id}: ${this.errorMessage(error)}`,
        );
      }
      return failure.request;
    }
  }

  private async recordFailure(
    request: ReconcileCandidate,
    error: unknown,
  ): Promise<FailureRecord> {
    const failureMessage = this.errorMessage(error);
    const failedAt = new Date();
    const updated: {
      request: PolicyExceptionRequest | null;
      transitionedToFailed: boolean;
    } = await this.prisma.runSerializableTransaction(async (tx) => {
      const current = await tx.policyExceptionRequest.findUnique({
        where: { id: request.id },
      });
      if (!current || current.status !== request.status) {
        return { request: current, transitionedToFailed: false };
      }

      const attempts = current.applyAttempts + 1;
      const exhausted =
        current.status === ExceptionStatus.APPLYING &&
        attempts >= APPLY_MAX_ATTEMPTS;
      const afterStatus = exhausted ? ExceptionStatus.FAILED : current.status;
      const backoffMs = Math.min(
        BACKOFF_BASE_MS * 2 ** current.applyAttempts,
        BACKOFF_CAP_MS,
      );
      const changed = await tx.policyExceptionRequest.updateMany({
        where: {
          id: current.id,
          status: current.status,
          applyAttempts: current.applyAttempts,
        },
        data: {
          status: afterStatus,
          applyAttempts: attempts,
          lastError: failureMessage,
          nextAttemptAt: exhausted
            ? null
            : new Date(failedAt.getTime() + backoffMs),
        },
      });
      if (changed.count !== 1) {
        return { request: null, transitionedToFailed: false };
      }

      if (exhausted) {
        await this.audit(tx, {
          action: "EXCEPTION_APPLY_FAILED",
          entityId: current.id,
          actorType: AuditActorType.SYSTEM,
          beforeStatus: ExceptionStatus.APPLYING,
          afterStatus: ExceptionStatus.FAILED,
          metadata: {
            attempts,
            error: failureMessage,
            errorKind: (error as Error)?.constructor?.name ?? "Unknown",
          },
        });
      }

      return {
        request: await tx.policyExceptionRequest.findUnique({
          where: { id: current.id },
        }),
        transitionedToFailed: exhausted,
      };
    });

    return {
      request: updated.request ?? (await this.getRequired(request.id)),
      transitionedToFailed: updated.transitionedToFailed,
    };
  }

  private async clearFailure(request: ReconcileCandidate): Promise<void> {
    if (
      request.applyAttempts === 0 &&
      request.lastError === null &&
      request.nextAttemptAt === null
    ) {
      return;
    }

    await this.prisma.policyExceptionRequest.updateMany({
      where: {
        id: request.id,
        status: request.status,
        applyAttempts: request.applyAttempts,
      },
      data: {
        applyAttempts: 0,
        lastError: null,
        nextAttemptAt: null,
      },
    });
  }

  private async markExpiring(
    request: ReconcileCandidate,
  ): Promise<PolicyExceptionRequest | null> {
    return this.prisma.runSerializableTransaction(async (tx) => {
      const changed = await tx.policyExceptionRequest.updateMany({
        where: {
          id: request.id,
          status: request.status,
          expiresAt: { lte: new Date() },
        },
        data: {
          status: ExceptionStatus.EXPIRING,
          nextAttemptAt: null,
        },
      });
      if (changed.count !== 1) return null;

      await this.audit(tx, {
        action: "EXCEPTION_EXPIRATION_STARTED",
        entityId: request.id,
        actorType: AuditActorType.SYSTEM,
        beforeStatus: request.status,
        afterStatus: ExceptionStatus.EXPIRING,
      });
      return tx.policyExceptionRequest.findUnique({
        where: { id: request.id },
      });
    });
  }

  private async completeTransition(
    requestId: string,
    beforeStatus: ExceptionStatus,
    afterStatus: ExceptionStatus,
    action: string,
    data: Prisma.PolicyExceptionRequestUpdateManyMutationInput = {},
  ): Promise<PolicyExceptionRequest> {
    const request = await this.prisma.runSerializableTransaction(async (tx) => {
      const changed = await tx.policyExceptionRequest.updateMany({
        where: { id: requestId, status: beforeStatus },
        data: {
          ...data,
          status: afterStatus,
          applyAttempts: 0,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      if (changed.count !== 1) return null;

      await this.audit(tx, {
        action,
        entityId: requestId,
        actorType: AuditActorType.SYSTEM,
        beforeStatus,
        afterStatus,
      });
      return tx.policyExceptionRequest.findUnique({ where: { id: requestId } });
    });

    return request ?? this.getRequired(requestId);
  }

  private ensure(request: ReconcileCandidate): Promise<void> {
    return this.kyverno.ensurePolicyException(request.targetClusterId, {
      name: request.k8sExceptionName,
      requestId: request.id,
      policyName: request.policyName,
      ruleNames: request.appliedRuleNames,
      resourceKind: request.resourceKind,
      resourceName: request.resourceName,
      resourceNamespace: request.resourceNamespace,
    });
  }

  private async getRequired(id: string): Promise<PolicyExceptionRequest> {
    const request = await this.prisma.policyExceptionRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new BusinessException(EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND, {
        context: { requestId: id },
      });
    }
    return request;
  }

  private async throwTransitionError(
    id: string,
    action: TransitionAction,
  ): Promise<never> {
    const request = await this.prisma.policyExceptionRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new BusinessException(EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND, {
        context: { requestId: id },
      });
    }
    throw new BusinessException(EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION, {
      message: `Exception request cannot be ${action}.`,
      context: {
        requestId: id,
        currentStatus: request.status,
        action,
      },
    });
  }

  private audit(
    tx: TransactionClient,
    input: {
      action: string;
      entityId: string;
      actorType: AuditActorType;
      userId?: string;
      beforeStatus: ExceptionStatus;
      afterStatus: ExceptionStatus;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return tx.auditLog.create({
      data: {
        action: input.action,
        entityType: ENTITY_TYPE,
        entityId: input.entityId,
        actorType: input.actorType,
        userId: input.userId,
        beforeStatus: input.beforeStatus,
        afterStatus: input.afterStatus,
        metadata: input.metadata,
      },
    });
  }

  private errorMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : "unknown Kubernetes error";
    return message.slice(0, LAST_ERROR_MAX_LENGTH);
  }
}
