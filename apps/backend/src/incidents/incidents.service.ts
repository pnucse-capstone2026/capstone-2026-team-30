import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  AuditActorType,
  DeploymentIncident,
  ExceptionStatus,
  IncidentStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { dumpYaml } from "@kubernetes/client-node";
import { v7 as uuidv7 } from "uuid";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { GitOpsPublisherService } from "../gitops/gitops-publisher.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { buildPolicyExceptionManifest } from "../kubernetes/policy-exception-manifest";
import { PrismaService } from "../prisma/prisma.service";
import { EmergencyRemediateDto } from "./dto/emergency-remediate.dto";
import { IgnoreIncidentDto } from "./dto/ignore-incident.dto";
import { ListIncidentsQueryDto } from "./dto/incident-query.dto";
import {
  DeploymentIncidentDto,
  PaginatedIncidentsResponseDto,
} from "./dto/incident-response.dto";
import { RemediationDraftDto } from "./dto/remediation-draft.dto";
import { ResolveHotfixDto } from "./dto/resolve-hotfix.dto";
import { IncidentsEventsService } from "./incidents-events.service";
import { INCIDENT_ERROR } from "./incidents.errors";

/**
 * SSE 차분 동기화(Delta Hydration) 조회 결과 DTO
 */
export interface IncidentsDeltaResultDto {
  items: DeploymentIncidentDto[];
  hasMore: boolean;
  lastEventId?: string;
}

export interface RecordAdmissionBlockParams {
  clusterId: string;
  namespace: string;
  resourceKind: string;
  resourceName: string;
  policyName: string;
  ruleName?: string;
  blockReason: string;
  gitopsAppName?: string;
  gitCommitSha?: string;
  gitRepository?: string;
  metadata?: Record<string, any>;
}

/**
 * Closed-Loop Admission Block 배포 차단 인시던트 관리 서비스
 *
 * GitOps Sync 및 K8s API 서버에서 Kyverno Admission Webhook에 의해 차단된 워크로드
 * 이벤트를 수신하여 영속화하고, 중복 방지(Deduplication) 및 3대 보조 복구 경로를 관리합니다.
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly incidentsEventsService: IncidentsEventsService,
    @Inject(forwardRef(() => GitOpsPublisherService))
    private readonly gitOpsPublisher: GitOpsPublisherService,
    @Optional() private readonly clusterProvider?: ClusterProvider,
  ) {}

  /**
   * Kyverno Admission 차단 이벤트를 데이터베이스에 기록하거나 기존 인시던트를 갱신합니다.
   *
   * @param params 차단 이벤트 매개변수
   * @returns 기록 또는 갱신된 인시던트 DTO
   */
  async recordAdmissionBlock(
    params: RecordAdmissionBlockParams,
  ): Promise<DeploymentIncidentDto> {
    const existing = await this.prisma.deploymentIncident.findFirst({
      where: {
        clusterId: params.clusterId,
        namespace: params.namespace,
        resourceKind: params.resourceKind,
        resourceName: params.resourceName,
        policyName: params.policyName,
        status: IncidentStatus.ACTIVE,
      },
    });

    if (existing) {
      const mergedMetadata = {
        ...(typeof existing.metadata === "object" && existing.metadata !== null
          ? (existing.metadata as Record<string, any>)
          : {}),
        ...(params.metadata || {}),
        lastOccurrenceAt: new Date().toISOString(),
      };

      const updated = await this.prisma.deploymentIncident.update({
        where: { id: existing.id },
        data: {
          blockCount: { increment: 1 },
          lastBlockedAt: new Date(),
          blockReason: params.blockReason,
          ruleName: params.ruleName ?? existing.ruleName,
          gitopsAppName: params.gitopsAppName ?? existing.gitopsAppName,
          gitCommitSha: params.gitCommitSha ?? existing.gitCommitSha,
          gitRepository: params.gitRepository ?? existing.gitRepository,
          metadata: mergedMetadata as Prisma.InputJsonValue,
        },
      });

      const dto = this.mapToDto(updated);
      this.incidentsEventsService.emitIncidentUpdated(dto);
      return dto;
    }

    const created = await this.prisma.deploymentIncident.create({
      data: {
        clusterId: params.clusterId,
        namespace: params.namespace,
        resourceKind: params.resourceKind,
        resourceName: params.resourceName,
        policyName: params.policyName,
        ruleName: params.ruleName,
        blockReason: params.blockReason,
        gitopsAppName: params.gitopsAppName,
        gitCommitSha: params.gitCommitSha,
        gitRepository: params.gitRepository,
        status: IncidentStatus.ACTIVE,
        blockCount: 1,
        firstBlockedAt: new Date(),
        lastBlockedAt: new Date(),
        metadata: (params.metadata || {}) as Prisma.InputJsonValue,
      },
    });

    const dto = this.mapToDto(created);
    this.incidentsEventsService.emitIncidentCreated(dto);
    return dto;
  }

  /**
   * 사용자 권한에 기반하여 인시던트 목록을 페이징 조회합니다.
   *
   * @param user 인증된 요청 사용자 컨텍스트
   * @param query 검색 및 필터 쿼리 파라미터 DTO
   * @returns 페이징된 인시던트 목록 응답 DTO
   */
  async getIncidents(
    user: AuthenticatedUser,
    query: ListIncidentsQueryDto,
  ): Promise<PaginatedIncidentsResponseDto> {
    if (query.clusterId) {
      this.validateClusterAccess(user, query.clusterId);
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.DeploymentIncidentWhereInput = {};

    if (query.clusterId) {
      where.clusterId = query.clusterId;
    } else if (user.role !== "ADMIN") {
      where.clusterId = { in: user.clusterIds };
    }

    if (query.namespace) {
      where.namespace = query.namespace;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.gitopsAppName) {
      where.gitopsAppName = {
        contains: query.gitopsAppName,
        mode: "insensitive",
      };
    }
    if (query.policyName) {
      where.policyName = { contains: query.policyName, mode: "insensitive" };
    }

    const [items, total] = await Promise.all([
      this.prisma.deploymentIncident.findMany({
        where,
        orderBy: { lastBlockedAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.deploymentIncident.count({ where }),
    ]);

    return {
      items: items.map((item) => this.mapToDto(item)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * 단일 인시던트의 상세 정보를 조회합니다.
   *
   * @param user 인증된 요청 사용자 컨텍스트
   * @param id 인시던트 고유 ID
   * @returns 인시던트 상세 DTO
   */
  async getIncidentById(
    user: AuthenticatedUser,
    id: string,
  ): Promise<DeploymentIncidentDto> {
    const incident = await this.prisma.deploymentIncident.findUnique({
      where: { id },
    });

    if (!incident) {
      throw new BusinessException(INCIDENT_ERROR.NOT_FOUND);
    }

    this.validateClusterAccess(user, incident.clusterId);
    return this.mapToDto(incident);
  }

  /**
   * 인시던트 해결을 위한 보조 초안(Remediation Draft) 정보를 생성 및 반환합니다.
   * YAML 매니페스트 초안, 정식 신청 URL 프리필 쿼리스트링, 해결 가이드라인을 조립합니다.
   *
   * @param user 인증된 요청 사용자 컨텍스트
   * @param id 인시던트 고유 ID
   * @returns PolicyException YAML 초안 및 조치 가이드 DTO
   */
  async getRemediationDraft(
    user: AuthenticatedUser,
    id: string,
  ): Promise<RemediationDraftDto> {
    const incident = await this.prisma.deploymentIncident.findUnique({
      where: { id },
    });

    if (!incident) {
      throw new BusinessException(INCIDENT_ERROR.NOT_FOUND);
    }

    this.validateClusterAccess(user, incident.clusterId);

    const ruleNames = incident.ruleName ? [incident.ruleName] : ["*"];
    const resourceNamespace = incident.namespace || null;

    const manifest = buildPolicyExceptionManifest({
      name: `pac-exception-${incident.id.slice(0, 8)}`,
      namespace: incident.namespace || "default",
      requestId: incident.id,
      policyName: incident.policyName,
      ruleNames,
      resourceKind: incident.resourceKind,
      resourceName: incident.resourceName,
      resourceNamespace,
    });

    const v2Manifest = {
      ...manifest,
      apiVersion: "kyverno.io/v2",
    };

    const suggestedExceptionYaml = dumpYaml(v2Manifest);

    const params = new URLSearchParams();
    params.set("cluster", incident.clusterId);
    if (incident.namespace) params.set("namespace", incident.namespace);
    params.set("resource", incident.resourceName);
    params.set("kind", incident.resourceKind);
    params.set("policy", incident.policyName);
    if (incident.ruleName) params.set("rule", incident.ruleName);
    params.set("incidentId", incident.id);
    if (incident.gitRepository) params.set("repo", incident.gitRepository);
    if (incident.gitopsAppName) params.set("app", incident.gitopsAppName);

    const autoFillUrl = `/exceptions/new?${params.toString()}`;

    const remediationGuide =
      `클러스터 '${incident.clusterId}'의 '${incident.namespace || "default"}' 네임스페이스에서 ` +
      `'${incident.resourceKind}/${incident.resourceName}' 리소스가 Kyverno 정책 '${incident.policyName}'` +
      `${incident.ruleName ? ` (규칙: ${incident.ruleName})` : ""}에 의해 배포 차단되었습니다.\n\n` +
      `[권장 조치 방안]\n` +
      `1. 경로 A (정식 거버넌스 절차): [정식 예외 신청하기] 버튼을 눌러 승인권자 결재를 진행하십시오.\n` +
      `2. 경로 B (긴급 운영자 모드): 장애 복구 등 긴급 상황 시 관리자가 사전 검토 후 즉시 임시 예외를 발행할 수 있습니다.\n` +
      `3. 경로 C (개발자 매니페스트 수정): 배포 차단 원인을 Git 저장소에서 핫픽스한 후 [Hotfix 완료] 처리하십시오.`;

    return {
      suggestedExceptionYaml,
      autoFillUrl,
      remediationGuide,
      defaultTtlHours: 24,
      incident: this.mapToDto(incident),
    };
  }

  /**
   * 경로 B: 관리자 확인(Confirmation) 기반 긴급 임시 예외를 발행합니다.
   * 클러스터 런타임에 직접 적용하고 GitOps PR을 백그라운드로 발행하여 인시던트를 즉시 해결합니다.
   *
   * @param user 인증된 관리자 사용자 컨텍스트
   * @param id 인시던트 고유 ID
   * @param dto 긴급 발행 요청 파라미터 DTO
   * @returns 갱신된 인시던트 DTO
   */
  async remediateEmergency(
    user: AuthenticatedUser,
    id: string,
    dto: EmergencyRemediateDto,
  ): Promise<DeploymentIncidentDto> {
    if (user.role !== Role.ADMIN) {
      throw new BusinessException(INCIDENT_ERROR.ONLY_ADMIN_ALLOWED);
    }

    const incident = await this.prisma.deploymentIncident.findUnique({
      where: { id },
    });

    if (!incident) {
      throw new BusinessException(INCIDENT_ERROR.NOT_FOUND);
    }

    this.validateClusterAccess(user, incident.clusterId);

    if (incident.status !== IncidentStatus.ACTIVE) {
      throw new BusinessException(INCIDENT_ERROR.ALREADY_RESOLVED);
    }

    const ttlHours = dto.ttlHours && dto.ttlHours > 0 ? dto.ttlHours : 24;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const exceptionId = uuidv7();

    let clusterDisplayName = incident.clusterId;
    if (this.clusterProvider) {
      try {
        const meta = this.clusterProvider.getMetadata(incident.clusterId);
        if (meta?.displayName) {
          clusterDisplayName = meta.displayName;
        }
      } catch {
        // clusterProvider fallback
      }
    }

    const ruleNames = incident.ruleName ? [incident.ruleName] : ["*"];
    const currentMetadata =
      typeof incident.metadata === "object" && incident.metadata !== null
        ? (incident.metadata as Record<string, any>)
        : {};

    const [savedRequest, updatedIncident] = await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.policyExceptionRequest.create({
          data: {
            id: exceptionId,
            status: ExceptionStatus.APPROVED,
            reason: `[긴급 복구] ${dto.reason.trim()}`,
            policyName: incident.policyName,
            ruleNames,
            appliedRuleNames: incident.ruleName ? [incident.ruleName] : [],
            resourceKind: incident.resourceKind,
            resourceName: incident.resourceName,
            resourceNamespace: incident.namespace || null,
            targetClusterId: incident.clusterId,
            targetClusterDisplayName: clusterDisplayName,
            k8sExceptionName: `pac-emg-${incident.id.slice(0, 8)}`,
            expiresAt,
            decidedAt: new Date(),
            activatedAt: new Date(),
            decisionNote: `긴급 운영자 모드 승인: ${dto.reason.trim()}`,
            requestUserId: user.id,
            approverUserId: user.id,
          },
        });

        const incidentRecord = await tx.deploymentIncident.update({
          where: { id },
          data: {
            status: IncidentStatus.RESOLVED_BY_EXCEPTION,
            resolvedAt: new Date(),
            exceptionId,
            metadata: {
              ...currentMetadata,
              emergencyRemediation: {
                resolvedByUserId: user.id,
                resolvedByUserEmail: user.email,
                reason: dto.reason.trim(),
                ttlHours,
                expiresAt: expiresAt.toISOString(),
                resolvedAt: new Date().toISOString(),
                publishToGitOps: dto.publishToGitOps ?? true,
              },
            } as Prisma.InputJsonValue,
          },
        });

        await tx.auditLog.create({
          data: {
            action: "DEPLOYMENT_INCIDENT_EMERGENCY_REMEDIATED",
            entityType: "DeploymentIncident",
            entityId: id,
            actorType: AuditActorType.USER,
            userId: user.id,
            metadata: {
              clusterId: incident.clusterId,
              policyName: incident.policyName,
              resourceKind: incident.resourceKind,
              resourceName: incident.resourceName,
              exceptionId,
              reason: dto.reason.trim(),
              ttlHours,
            },
          },
        });

        return [request, incidentRecord];
      },
    );

    if (dto.publishToGitOps !== false) {
      try {
        await this.gitOpsPublisher.publishManifest(savedRequest);
      } catch (error) {
        // 긴급 배포 시 GitOps 연동 에러가 인시던트 해결 상태 전이를 롤백하지 않도록 격리
        this.logger.error(
          `[Emergency Remediation] GitOps publish failed for exception ${savedRequest.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const resultDto = this.mapToDto(updatedIncident);
    this.incidentsEventsService.emitIncidentUpdated(resultDto);
    return resultDto;
  }

  /**
   * 경로 C: 개발자 매니페스트 핫픽스(Hotfix) 수정 반영 완료 상태로 종결합니다.
   *
   * @param user 인증된 요청 사용자 컨텍스트
   * @param id 인시던트 고유 ID
   * @param dto 핫픽스 커밋 및 조치 내용 DTO
   * @returns 갱신된 인시던트 DTO
   */
  async resolveByHotfix(
    user: AuthenticatedUser,
    id: string,
    dto: ResolveHotfixDto,
  ): Promise<DeploymentIncidentDto> {
    const incident = await this.prisma.deploymentIncident.findUnique({
      where: { id },
    });

    if (!incident) {
      throw new BusinessException(INCIDENT_ERROR.NOT_FOUND);
    }

    this.validateClusterAccess(user, incident.clusterId);

    if (incident.status !== IncidentStatus.ACTIVE) {
      throw new BusinessException(INCIDENT_ERROR.ALREADY_RESOLVED);
    }

    const currentMetadata =
      typeof incident.metadata === "object" && incident.metadata !== null
        ? (incident.metadata as Record<string, any>)
        : {};

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedIncident = await tx.deploymentIncident.update({
        where: { id },
        data: {
          status: IncidentStatus.RESOLVED_BY_HOTFIX,
          resolvedAt: new Date(),
          metadata: {
            ...currentMetadata,
            hotfixResolution: {
              commitSha: dto.commitSha?.trim() || null,
              note: dto.note?.trim() || null,
              resolvedByUserId: user.id,
              resolvedByUserEmail: user.email,
              resolvedAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "DEPLOYMENT_INCIDENT_RESOLVED_BY_HOTFIX",
          entityType: "DeploymentIncident",
          entityId: id,
          actorType: AuditActorType.USER,
          userId: user.id,
          metadata: {
            clusterId: incident.clusterId,
            resourceKind: incident.resourceKind,
            resourceName: incident.resourceName,
            policyName: incident.policyName,
            commitSha: dto.commitSha,
            note: dto.note,
          },
        },
      });

      return updatedIncident;
    });

    const resultDto = this.mapToDto(updated);
    this.incidentsEventsService.emitIncidentUpdated(resultDto);
    return resultDto;
  }

  /**
   * 특정 인시던트를 수동 무시(IGNORED) 상태로 전이합니다.
   *
   * @param user 인시던트 무시를 수행하는 사용자 컨텍스트
   * @param id 인시던트 고유 ID
   * @param dto 무시 사유 DTO
   * @returns 갱신된 인시던트 DTO
   */
  async ignoreIncident(
    user: AuthenticatedUser,
    id: string,
    dto: IgnoreIncidentDto,
  ): Promise<DeploymentIncidentDto> {
    const incident = await this.prisma.deploymentIncident.findUnique({
      where: { id },
    });

    if (!incident) {
      throw new BusinessException(INCIDENT_ERROR.NOT_FOUND);
    }

    this.validateClusterAccess(user, incident.clusterId);

    if (incident.status !== IncidentStatus.ACTIVE) {
      throw new BusinessException(INCIDENT_ERROR.ALREADY_RESOLVED);
    }

    const currentMetadata =
      typeof incident.metadata === "object" && incident.metadata !== null
        ? (incident.metadata as Record<string, any>)
        : {};

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedIncident = await tx.deploymentIncident.update({
        where: { id },
        data: {
          status: IncidentStatus.IGNORED,
          resolvedAt: new Date(),
          metadata: {
            ...currentMetadata,
            ignoredByUserId: user.id,
            ignoredByUserEmail: user.email,
            ignoreReason: dto.reason,
            ignoredAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "DEPLOYMENT_INCIDENT_IGNORED",
          entityType: "DeploymentIncident",
          entityId: id,
          actorType: AuditActorType.USER,
          userId: user.id,
          metadata: {
            clusterId: incident.clusterId,
            resourceKind: incident.resourceKind,
            resourceName: incident.resourceName,
            policyName: incident.policyName,
            reason: dto.reason,
          },
        },
      });

      return updatedIncident;
    });

    const resultDto = this.mapToDto(updated);
    this.incidentsEventsService.emitIncidentUpdated(resultDto);
    return resultDto;
  }

  /**
   * W3C Last-Event-ID 기준으로 해당 시점 이후에 생성되거나 변경된 인시던트 목록을 조회합니다.
   * 네트워크 일시 단절 후 재연결된 클라이언트의 차분 동기화(Delta Hydration)를 지원합니다.
   * 대량 레코드 스트리밍으로 인한 OOM 방지를 위해 최대 100건 차분 하이드레이션으로 제한하며,
   * 한도 도달 시 `hasMore: true` 플래그를 통해 클라이언트의 전체 재동기화(Resync)를 유도합니다.
   *
   * @param user 요청자 인증 컨텍스트
   * @param lastEventId 클라이언트가 수신한 마지막 이벤트 식별자 (인시던트 UUID 또는 타임스탬프)
   * @returns 기준 시점 이후의 차분 동기화 결과 DTO (최대 100건 및 초과 여부 플래그)
   */
  async getIncidentsSince(
    user: AuthenticatedUser,
    lastEventId: string,
  ): Promise<IncidentsDeltaResultDto> {
    if (!lastEventId || !lastEventId.trim()) {
      return { items: [], hasMore: false, lastEventId };
    }

    let sinceTime: Date | null = null;

    // 1. lastEventId가 기존 인시던트 UUID인 경우 해당 레코드의 최종 갱신 시점 확인
    const target = await this.prisma.deploymentIncident.findUnique({
      where: { id: lastEventId },
    });

    if (target) {
      sinceTime = target.updatedAt;
    } else {
      // 2. ISO 타임스탬프 문자열인 경우 날짜 파싱
      const parsed = new Date(lastEventId);
      if (!isNaN(parsed.getTime())) {
        sinceTime = parsed;
      }
    }

    if (!sinceTime) {
      return { items: [], hasMore: false, lastEventId };
    }

    const clusterFilter: Prisma.DeploymentIncidentWhereInput =
      user.role === "ADMIN" ? {} : { clusterId: { in: user.clusterIds || [] } };

    const incidents = await this.prisma.deploymentIncident.findMany({
      where: {
        ...clusterFilter,
        updatedAt: { gte: sinceTime },
        id: { not: lastEventId },
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });

    const items = incidents.map((item) => this.mapToDto(item));
    const hasMore = items.length >= 100;

    return {
      items,
      hasMore,
      lastEventId,
    };
  }

  /**
   * 사용자의 클러스터 접근 권한을 확인합니다.
   * ADMIN 권한은 모든 클러스터에 접근 가능하며, 일반 사용자는 배정된 clusterIds에 포함되어야 합니다.
   *
   * @param user 사용자 컨텍스트
   * @param clusterId 검증할 클러스터 식별자
   */
  private validateClusterAccess(
    user: AuthenticatedUser,
    clusterId: string,
  ): void {
    if (user.role !== "ADMIN" && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(INCIDENT_ERROR.CLUSTER_ACCESS_DENIED);
    }
  }

  /**
   * Prisma DeploymentIncident 엔티티를 응답 DTO 규격으로 매핑합니다.
   */
  private mapToDto(entity: DeploymentIncident): DeploymentIncidentDto {
    return {
      id: entity.id,
      clusterId: entity.clusterId,
      namespace: entity.namespace,
      resourceKind: entity.resourceKind,
      resourceName: entity.resourceName,
      policyName: entity.policyName,
      ruleName: entity.ruleName,
      blockReason: entity.blockReason,
      gitopsAppName: entity.gitopsAppName,
      gitCommitSha: entity.gitCommitSha,
      gitRepository: entity.gitRepository,
      status: entity.status,
      blockCount: entity.blockCount,
      firstBlockedAt: entity.firstBlockedAt,
      lastBlockedAt: entity.lastBlockedAt,
      resolvedAt: entity.resolvedAt,
      exceptionId: entity.exceptionId,
      metadata: entity.metadata as Record<string, any> | null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
