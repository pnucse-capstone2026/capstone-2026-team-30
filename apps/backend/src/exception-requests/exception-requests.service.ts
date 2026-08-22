import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AuditActorType,
  ExceptionStatus,
  PolicyExceptionRequest,
  Role,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  BusinessException,
  isBusinessException,
} from "../common/errors/business.exception";
import { EXCEPTION_LIFECYCLE_ERROR } from "../exception-lifecycle/exception-lifecycle.errors";
import { ExceptionLifecycleService } from "../exception-lifecycle/exception-lifecycle.service";
import { GitOpsPublisherService } from "../gitops/gitops-publisher.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import {
  KyvernoAdapter,
  PolicyNotFoundError,
  PolicyRuleValidationError,
} from "../kubernetes/kyverno.adapter";
import { KUBERNETES_ERROR } from "../kubernetes/kubernetes.errors";
import { PrismaService } from "../prisma/prisma.service";
import { ApproveExceptionRequestDto } from "./dto/approve-exception-request.dto";
import { CreateExceptionRequestDto } from "./dto/create-exception-request.dto";
import { RejectExceptionRequestDto } from "./dto/reject-exception-request.dto";
import { EXCEPTION_REQUEST_ERROR } from "./exception-request.errors";

const DEFAULT_MAX_DURATION_HOURS = 720;

@Injectable()
export class ExceptionRequestsService {
  private readonly maxDurationHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ExceptionLifecycleService,
    private readonly clusters: ClusterProvider,
    private readonly kyverno: KyvernoAdapter,
    private readonly gitOpsPublisher: GitOpsPublisherService,
    config: ConfigService,
  ) {
    const configured = Number(
      config.get<string>("MAX_EXCEPTION_DURATION_HOURS"),
    );
    this.maxDurationHours =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_DURATION_HOURS;
  }

  async list(user: AuthenticatedUser): Promise<PolicyExceptionRequest[]> {
    const requests = await this.prisma.policyExceptionRequest.findMany({
      where: {
        ...(user.role === Role.REQUESTER ? { requestUserId: user.id } : {}),
        ...this.clusterScope(user),
      },
      orderBy: { createdAt: "desc" },
    });
    return requests.map((request) => this.visibleTo(request, user));
  }

  async get(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    const request = await this.prisma.policyExceptionRequest.findFirst({
      where: {
        id,
        ...(user.role === Role.REQUESTER ? { requestUserId: user.id } : {}),
        ...this.clusterScope(user),
      },
    });
    if (!request) {
      throw new BusinessException(EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND, {
        context: { requestId: id },
      });
    }
    return this.visibleTo(request, user);
  }

  async create(
    dto: CreateExceptionRequestDto,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    const expiresAt = this.validateExpiration(dto.expiresAt);
    const cluster = this.clusters.getMetadata(dto.targetClusterId);
    if (!this.canReachCluster(user, cluster.id)) {
      // 배정되지 않은 클러스터는 존재 여부도 알려주지 않는다 — 미설정과 같은 응답.
      throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
        message: `Cluster '${dto.targetClusterId}' is not configured.`,
        context: { clusterId: dto.targetClusterId },
      });
    }
    const id = randomUUID();
    const ruleNames = this.normalizeRequestedRules(dto.ruleNames);

    return this.prisma.runSerializableTransaction(async (tx) => {
      const created = await tx.policyExceptionRequest.create({
        data: {
          id,
          status: ExceptionStatus.PENDING,
          reason: dto.reason.trim(),
          policyName: dto.policyName.trim(),
          ruleNames,
          resourceKind: dto.resourceKind.trim(),
          resourceName: dto.resourceName.trim(),
          resourceNamespace: dto.resourceNamespace?.trim() || null,
          targetClusterId: cluster.id,
          targetClusterDisplayName: cluster.displayName,
          k8sExceptionName: `pac-exception-${id}`,
          expiresAt,
          requestUserId: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "EXCEPTION_REQUESTED",
          entityType: "PolicyExceptionRequest",
          entityId: id,
          actorType: AuditActorType.USER,
          userId: user.id,
          afterStatus: ExceptionStatus.PENDING,
        },
      });
      return created;
    });
  }

  async approve(
    id: string,
    dto: ApproveExceptionRequestDto,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    const request = await this.get(id, user);
    this.assertNotSelfDecision(request, user);
    if (request.expiresAt <= new Date()) {
      throw new BusinessException(EXCEPTION_REQUEST_ERROR.EXPIRED, {
        context: { requestId: id },
      });
    }
    const requestedRules = dto.ruleNames ?? request.ruleNames;
    if (dto.ruleNames) {
      const original = new Set(request.ruleNames);
      if (dto.ruleNames.some((rule) => !original.has(rule.trim()))) {
        throw new BusinessException(
          EXCEPTION_REQUEST_ERROR.APPROVED_RULES_INVALID,
          { context: { requestId: id } },
        );
      }
    }

    let appliedRuleNames: string[];
    try {
      appliedRuleNames = await this.kyverno.resolveRuleNames(
        request.targetClusterId,
        request.policyName,
        requestedRules,
        request.resourceKind,
      );
    } catch (error) {
      if (isBusinessException(error)) throw error;
      if (error instanceof PolicyNotFoundError) {
        throw new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_NOT_FOUND, {
          message: error.message,
          cause: error,
          context: { requestId: id, policyName: request.policyName },
        });
      }
      if (error instanceof PolicyRuleValidationError) {
        throw new BusinessException(
          EXCEPTION_REQUEST_ERROR.POLICY_RULE_VALIDATION_FAILED,
          {
            message: error.message,
            cause: error,
            context: { requestId: id, policyName: request.policyName },
          },
        );
      }
      throw new BusinessException(
        EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
        {
          cause: error,
          context: { requestId: id, policyName: request.policyName },
        },
      );
    }

    const approvedRequest = await this.lifecycle.approve(
      id,
      user.id,
      appliedRuleNames,
      dto.decisionNote?.trim(),
    );

    // 승인 완료 후 GitOps 매니페스트 게시 (오류 발생 시 런타임 적용 유지를 위해 안전하게 처리)
    try {
      await this.gitOpsPublisher.publishManifest(approvedRequest);
    } catch {
      // GitOps 게시 실패가 승인 프로세스를 중단시키지 않도록 예외 처리
    }

    return approvedRequest;
  }

  /**
   * approve 메서드의 별칭(Alias)으로, 정책 예외 승인 처리 및 GitOps 매니페스트 발행을 수행합니다.
   */
  async approveExceptionRequest(
    id: string,
    dto: ApproveExceptionRequestDto,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    return this.approve(id, dto, user);
  }

  async reject(
    id: string,
    dto: RejectExceptionRequestDto,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    const request = await this.get(id, user);
    this.assertNotSelfDecision(request, user);
    return this.lifecycle.reject(id, user.id, dto.decisionNote?.trim());
  }

  async cancel(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    // 단일 레코드를 읽는 경로는 전부 get() 을 지난다 — 클러스터 스코프와 부재를
    // 한 곳에서만 판정하기 위해서다. 취소는 그 위에 소유권 조건을 더 얹는다.
    // get() 은 REQUESTER 에게만 본인 것으로 제한하므로 APPROVER 는 여기서 걸러야 한다.
    const request = await this.get(id, user);
    if (user.role !== Role.ADMIN && request.requestUserId !== user.id) {
      throw new BusinessException(EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND, {
        context: { requestId: id },
      });
    }
    const cancelled = await this.lifecycle.cancel(id, user.id);
    return this.visibleTo(cancelled, user);
  }

  /**
   * FAILED 로 떨어진 요청을 다시 적용한다. 승인 권한과 별개의 운영 조치라
   * `exception_requests.retry` 로 분리했다.
   */
  async retry(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PolicyExceptionRequest> {
    await this.get(id, user);
    const retried = await this.lifecycle.retry(id, user.id);
    return this.visibleTo(retried, user);
  }

  private assertNotSelfDecision(
    request: PolicyExceptionRequest,
    user: AuthenticatedUser,
  ): void {
    if (request.requestUserId === user.id && user.role !== Role.ADMIN) {
      throw new BusinessException(
        EXCEPTION_REQUEST_ERROR.SELF_DECISION_FORBIDDEN,
        { context: { requestId: request.id, userId: user.id } },
      );
    }
  }

  private validateExpiration(value: string): Date {
    const expiresAt = new Date(value);
    const now = new Date();
    if (expiresAt <= now) {
      throw new BusinessException(
        EXCEPTION_REQUEST_ERROR.EXPIRATION_MUST_BE_FUTURE,
      );
    }
    if (
      expiresAt.getTime() - now.getTime() >
      this.maxDurationHours * 60 * 60 * 1000
    ) {
      throw new BusinessException(EXCEPTION_REQUEST_ERROR.EXPIRATION_TOO_LONG, {
        message: `expiresAt must be within ${this.maxDurationHours} hours.`,
        context: { maxDurationHours: this.maxDurationHours },
      });
    }
    return expiresAt;
  }

  private normalizeRequestedRules(ruleNames: string[]): string[] {
    const normalized = [...new Set(ruleNames.map((rule) => rule.trim()))];
    if (normalized.some((rule) => !rule || rule === "*")) {
      throw new BusinessException(EXCEPTION_REQUEST_ERROR.RULE_NAMES_REQUIRED);
    }
    return normalized;
  }

  /**
   * 역할과 무관하게 배정된 클러스터로 좁힌다. 배정이 없으면 빈 목록이 되어
   * 아무것도 매칭되지 않는다 — deny by default 다.
   */
  private clusterScope(user: AuthenticatedUser): {
    targetClusterId: { in: string[] };
  } {
    return { targetClusterId: { in: user.clusterIds } };
  }

  /**
   * 같은 판정을 where 절 없이 한다. 생성은 대상 클러스터가 DB 레코드가 아니라
   * 요청 본문에서 오므로 조회 조건으로 거를 수 없다.
   */
  private canReachCluster(user: AuthenticatedUser, clusterId: string): boolean {
    return user.clusterIds.includes(clusterId);
  }

  private visibleTo(
    request: PolicyExceptionRequest,
    user: AuthenticatedUser,
  ): PolicyExceptionRequest {
    return user.role === Role.ADMIN || user.role === Role.APPROVER
      ? request
      : { ...request, lastError: null };
  }
}
