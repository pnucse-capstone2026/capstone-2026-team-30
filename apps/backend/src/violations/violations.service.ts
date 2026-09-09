import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import {
  ClusterMetadata,
  ClusterProvider,
} from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { ListViolationsQueryDto } from "./dto/list-violations-query.dto";
import { UpdateViolationStatusDto } from "./dto/update-violation-status.dto";
import { ViolationDetailDto } from "./dto/violation-detail.dto";
import { ViolationSummaryDto } from "./dto/violation-summary.dto";
import { VIOLATION_ERROR } from "./violation.errors";

/**
 * 클러스터 범위(네임스페이스 없음) PolicyReport의 위반 ID에 사용하는 센티널.
 * 위반 ID 포맷은 `<clusterId>:<namespace>/<reportName>:<index>` 이며,
 * 네임스페이스가 없는 ClusterPolicyReport는 이 값으로 대체한다.
 */
const CLUSTER_SCOPE_SENTINEL = "cluster";

type PolicyReportResultRaw = {
  policy?: string;
  rule?: string;
  category?: string;
  severity?: string;
  result?: string;
  message?: string;
  scored?: boolean;
  source?: string;
  timestamp?: { seconds?: number; nanos?: number };
  resources?: Array<{
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
  }>;
  properties?: Record<string, string>;
  [key: string]: unknown;
};

type PolicyReportRaw = {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    ownerReferences?: Array<{
      apiVersion?: string;
      kind?: string;
      name?: string;
      uid?: string;
    }>;
  };
  scope?: {
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
  };
  summary?: {
    pass?: number;
    fail?: number;
    warn?: number;
    error?: number;
    skip?: number;
  };
  results?: PolicyReportResultRaw[];
  [key: string]: unknown;
};

/**
 * Kyverno 정책 위반(PolicyReport) 실시간 수집, DB 동기화 및 분석 서비스
 */
@Injectable()
export class ViolationsService {
  private readonly logger = new Logger(ViolationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clusters: ClusterProvider,
    private readonly kyvernoAdapter: KyvernoAdapter,
  ) {}

  /**
   * K8s 연결 상태에서 live PolicyReport 수집을 우선 시도하고, K8s 연결/수집 실패 시
   * PostgreSQL ViolationHistory DB 테이블을 fallback으로 조회합니다.
   *
   * @param user (선택) 인증된 요청자 정보
   * @param query 위반 필터링 및 검색 옵션
   * @returns 정규화된 정책 위반 요약 DTO 배열
   */
  async getViolations(
    user?: AuthenticatedUser,
    query: ListViolationsQueryDto = {},
  ): Promise<ViolationSummaryDto[]> {
    const accessibleClusters = user
      ? this.getAccessibleClusters(user, query.clusterId)
      : this.clusters.list();

    if (user && accessibleClusters.length === 0) {
      return [];
    }

    try {
      // K8s API 커스텀 객체 조회를 통한 라이브 위반 보고서 수집
      const allViolations: ViolationSummaryDto[] = [];
      let successClusterCount = 0;
      let failedClusterCount = 0;

      let exceptionsMap:
        | Map<string, { id: string; status: string }>
        | undefined;
      let savedStatusesMap:
        | Map<string, "open" | "inReview" | "resolved">
        | undefined;

      for (const cluster of accessibleClusters) {
        try {
          const clusterReports =
            await this.kyvernoAdapter.listClusterPolicyReports(cluster.id);
          const namespacedReports =
            await this.kyvernoAdapter.listNamespacedPolicyReports(
              cluster.id,
              query.namespace,
            );

          if (clusterReports.length > 0 || namespacedReports.length > 0) {
            if (!exceptionsMap) {
              exceptionsMap = await this.getExceptionRequestsMap();
            }
            if (!savedStatusesMap) {
              savedStatusesMap = await this.getSavedStatusMap();
            }
          }

          for (const raw of clusterReports) {
            const extracted = this.extractViolationsFromReport(
              raw as PolicyReportRaw,
              cluster,
              exceptionsMap,
              savedStatusesMap,
            );
            for (const item of extracted) {
              if (this.matchesFilter(item, query)) {
                allViolations.push(item);
              }
            }
          }

          for (const raw of namespacedReports) {
            const extracted = this.extractViolationsFromReport(
              raw as PolicyReportRaw,
              cluster,
              exceptionsMap,
              savedStatusesMap,
            );
            for (const item of extracted) {
              if (this.matchesFilter(item, query)) {
                allViolations.push(item);
              }
            }
          }
          successClusterCount++;
        } catch (err) {
          // 단일 클러스터 장애 시 개별 처리 후 실패 카운트 증가
          failedClusterCount++;
          this.logger.warn(
            `Failed to fetch live policy reports for cluster ${cluster.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 모든 대상 클러스터 조회가 실패하였을 경우 PostgreSQL DB Fallback 실행
      if (successClusterCount === 0 && failedClusterCount > 0) {
        this.logger.warn(
          `All K8s cluster connections failed (${failedClusterCount} failed). Falling back to ViolationHistory DB.`,
        );
        return this.getViolationsFromDb(accessibleClusters, query);
      }

      let sorted = allViolations.sort((a, b) => {
        const timeA = new Date(a.detectedAt).getTime();
        const timeB = new Date(b.detectedAt).getTime();
        return query.sortOrder === "asc" ? timeA - timeB : timeB - timeA;
      });

      if (query.page && query.limit) {
        const skip = (query.page - 1) * query.limit;
        sorted = sorted.slice(skip, skip + query.limit);
      }

      return sorted;
    } catch (error) {
      // 예상치 못한 예외 발생 시 회복성 확보를 위한 DB Fallback 실행
      this.logger.warn(
        `Unexpected error fetching live policy reports, falling back to ViolationHistory DB`,
        error instanceof Error ? error.message : String(error),
      );
      return this.getViolationsFromDb(accessibleClusters, query);
    }
  }

  /**
   * 사용자에게 배정된 클러스터에서 실시간 정책 위반 내역을 집계하여 조회합니다.
   *
   * @param user 인증된 요청자 정보
   * @param query 위반 필터링 및 검색 옵션
   * @returns 정책 위반 요약 정보 배열
   */
  async list(
    user: AuthenticatedUser,
    query: ListViolationsQueryDto,
  ): Promise<ViolationSummaryDto[]> {
    return this.getViolations(user, query);
  }

  /**
   * 특정 정책 위반의 상세 정보 및 Bedrock AI 분석용 메타데이터, 감사 이력을 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param id 위반 고유 식별자 (<clusterId>:<namespace>/<reportName>:<resultIndex>)
   * @param user 인증된 요청자 정보
   * @returns 정책 위반 상세 DTO
   * @throws {BusinessException} 클러스터 미배정(VIOLATION_CLUSTER_ACCESS_DENIED) 또는 위반 미존재(VIOLATION_NOT_FOUND_IN_CLUSTER) 시
   */
  async getDetail(
    clusterId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<ViolationDetailDto> {
    const normalizedId = decodeURIComponent(id);

    // 1. ID가 UUID 형식(또는 ':' 미포함)일 경우 DB Fallback (violationHistory) 조회 시도
    if (!normalizedId.includes(":")) {
      const dbRecord = await this.prisma.violationHistory.findUnique({
        where: { id: normalizedId },
      });
      if (dbRecord) {
        const cluster = this.validateClusterAccess(
          user,
          dbRecord.targetClusterId,
        );
        const clusterDisplayName =
          cluster?.displayName ??
          dbRecord.targetClusterDisplayName ??
          dbRecord.targetClusterId;

        let resourceKind = dbRecord.resourceKind ?? "Unknown";
        let resourceName = dbRecord.resourceName ?? "Unknown";
        let message = dbRecord.message;
        let resourceSpec: Record<string, unknown> = {};
        let rawResult: Record<string, unknown> = {};

        // DB에 리소스명이 Unknown인 경우 K8s 라이브 리포트에서 일치하는 실제 리소스 정보 조회 보정
        if (resourceName === "Unknown" || resourceKind === "Unknown") {
          try {
            const liveReports = [
              ...(await this.kyvernoAdapter.listNamespacedPolicyReports(
                dbRecord.targetClusterId,
                dbRecord.namespace !== "cluster-wide"
                  ? dbRecord.namespace
                  : undefined,
              )),
              ...(await this.kyvernoAdapter.listClusterPolicyReports(
                dbRecord.targetClusterId,
              )),
            ];

            for (const rep of liveReports) {
              const repRaw = rep as PolicyReportRaw;
              const matchedResult = repRaw.results?.find(
                (r) =>
                  r.policy === dbRecord.policyName &&
                  (r.rule === dbRecord.ruleName ||
                    r.rule?.includes(dbRecord.ruleName) ||
                    dbRecord.ruleName.includes(r.rule ?? "")),
              );
              if (matchedResult) {
                const targetRes = matchedResult.resources?.[0];
                if (targetRes?.name) resourceName = targetRes.name;
                if (targetRes?.kind) resourceKind = targetRes.kind;
                if (matchedResult.message) message = matchedResult.message;
                rawResult = matchedResult as Record<string, unknown>;
                resourceSpec = (targetRes as Record<string, unknown>) ?? {};
                break;
              }
            }
          } catch {
            // 라이브 보정 실패 시 DB 기본값 유지
          }
        }

        if (resourceKind === "Unknown") resourceKind = "Pod";
        if (resourceName === "Unknown") {
          const matchKindName = message?.match(
            /(?:on|in|target|resource)\s+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i,
          );
          if (matchKindName) {
            resourceKind = matchKindName[1];
            resourceName = matchKindName[2];
          }
        }

        const summary: ViolationSummaryDto = {
          id: dbRecord.id,
          clusterId: dbRecord.targetClusterId,
          clusterDisplayName,
          namespace: dbRecord.namespace ?? "cluster-wide",
          policyName: dbRecord.policyName,
          ruleName: dbRecord.ruleName,
          resourceKind,
          resourceName,
          severity:
            (dbRecord.severity as
              | "critical"
              | "high"
              | "medium"
              | "low"
              | "info") ?? "medium",
          status:
            (dbRecord.status as "open" | "inReview" | "resolved") ?? "open",
          message:
            message ??
            `[DB Fallback] Policy '${dbRecord.policyName}' rule '${dbRecord.ruleName}' violation recorded in cluster '${clusterDisplayName}'.`,
          detectedAt: dbRecord.occurredAt.toISOString(),
          reportName: "db-fallback",
        };
        const events = await this.getViolationAuditEvents(
          normalizedId,
          summary.detectedAt,
          summary.message,
        );
        return {
          ...summary,
          recommendation: this.generateDefaultRecommendation(summary),
          resourceSpec,
          rawResult,
          events,
        };
      }
    }

    const cluster = this.validateClusterAccess(user, clusterId);

    // ID 포맷: clusterId:namespace/reportName:index
    const parts = normalizedId.split(":");
    if (parts.length < 3) {
      const dbRecord = await this.prisma.violationHistory.findUnique({
        where: { id: normalizedId },
      });
      if (dbRecord) {
        this.validateClusterAccess(user, dbRecord.targetClusterId);
        const clusterDisplayName =
          dbRecord.targetClusterDisplayName ?? dbRecord.targetClusterId;
        const summary: ViolationSummaryDto = {
          id: dbRecord.id,
          clusterId: dbRecord.targetClusterId,
          clusterDisplayName,
          namespace: dbRecord.namespace ?? "cluster-wide",
          policyName: dbRecord.policyName,
          ruleName: dbRecord.ruleName,
          resourceKind: dbRecord.resourceKind ?? "Unknown",
          resourceName: dbRecord.resourceName ?? "Unknown",
          severity:
            (dbRecord.severity as
              | "critical"
              | "high"
              | "medium"
              | "low"
              | "info") ?? "medium",
          status:
            (dbRecord.status as "open" | "inReview" | "resolved") ?? "open",
          message:
            dbRecord.message ??
            `[DB Fallback] Policy '${dbRecord.policyName}' rule '${dbRecord.ruleName}' violation recorded in cluster '${clusterDisplayName}'.`,
          detectedAt: dbRecord.occurredAt.toISOString(),
          reportName: "db-fallback",
        };
        const events = await this.getViolationAuditEvents(
          normalizedId,
          summary.detectedAt,
          summary.message,
        );
        return {
          ...summary,
          recommendation: this.generateDefaultRecommendation(summary),
          resourceSpec: {},
          rawResult: {},
          events,
        };
      }
      throw new BusinessException(VIOLATION_ERROR.NOT_FOUND);
    }

    const index = parseInt(parts[parts.length - 1], 10);
    const scopedReportName = parts.slice(1, -1).join(":");

    // 신규 ID 포맷은 `<namespace>/<reportName>` 형태로 네임스페이스를 포함한다.
    // 슬래시가 없는 레거시 ID(네임스페이스 미포함)는 하위 호환으로 처리한다.
    const slashIndex = scopedReportName.indexOf("/");
    const reportNamespace =
      slashIndex >= 0 ? scopedReportName.slice(0, slashIndex) : undefined;
    const reportName =
      slashIndex >= 0
        ? scopedReportName.slice(slashIndex + 1)
        : scopedReportName;

    if (isNaN(index)) {
      throw new BusinessException(VIOLATION_ERROR.NOT_FOUND);
    }

    let report: PolicyReportRaw | null = null;

    // Namespaced PolicyReport 우선 조회 (클러스터 범위 센티널이면 건너뜀).
    // 동일 이름 보고서가 여러 네임스페이스에 있을 때 네임스페이스로 정확히 식별한다.
    if (reportNamespace !== CLUSTER_SCOPE_SENTINEL) {
      const namespaced =
        await this.kyvernoAdapter.listNamespacedPolicyReports(clusterId);
      report =
        (namespaced.find(
          (r) =>
            r.metadata?.name === reportName &&
            (reportNamespace === undefined ||
              r.metadata?.namespace === reportNamespace),
        ) as PolicyReportRaw) ?? null;
    }

    // ClusterPolicyReport 조회 시도
    if (!report) {
      report = (await this.kyvernoAdapter.getClusterPolicyReport(
        clusterId,
        reportName,
      )) as PolicyReportRaw | null;
    }

    if (!report || !report.results || !report.results[index]) {
      throw new BusinessException(VIOLATION_ERROR.NOT_FOUND);
    }

    const rawResult = report.results[index];

    // DB에서 저장된 처리 상태 및 예외 맵 조회
    const [exceptionsMap, savedStatusesMap] = await Promise.all([
      this.getExceptionRequestsMap(),
      this.getSavedStatusMap(),
    ]);

    const summary = this.mapToViolationSummary(
      rawResult,
      report,
      cluster,
      index,
      exceptionsMap,
      savedStatusesMap,
    );

    const recommendation = this.generateDefaultRecommendation(summary);
    const events = await this.getViolationAuditEvents(
      id,
      summary.detectedAt,
      summary.message,
    );

    return {
      ...summary,
      recommendation,
      resourceSpec: (rawResult.resources?.[0] as Record<string, unknown>) ?? {},
      rawResult,
      events,
    };
  }

  /**
   * 정책 위반 처리 상태를 변경하고 PostgreSQL DB에 영속화하며 AuditLog 감사 기록을 생성합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param id 정책 위반 고유 식별자
   * @param dto 상태 변경 요청 데이터
   * @param user 요청자 정보
   * @returns 갱신된 정책 위반 상세 DTO
   */
  async updateStatus(
    clusterId: string,
    id: string,
    dto: UpdateViolationStatusDto,
    user: AuthenticatedUser,
  ): Promise<ViolationDetailDto> {
    const normalizedId = decodeURIComponent(id);
    const currentDetail = await this.getDetail(clusterId, normalizedId, user);
    const previousStatus = currentDetail.status;

    const targetClusterId = currentDetail.clusterId || clusterId;
    const targetClusterDisplayName =
      currentDetail.clusterDisplayName || targetClusterId;

    // 1. ViolationHistory DB 레코드 upsert
    const isNamedResource =
      currentDetail.resourceName && currentDetail.resourceName !== "Unknown";

    const existing = await this.prisma.violationHistory.findFirst({
      where: {
        OR: [
          { id: normalizedId },
          ...(isNamedResource
            ? [
                {
                  targetClusterId,
                  policyName: currentDetail.policyName,
                  ruleName: currentDetail.ruleName,
                  resourceName: currentDetail.resourceName,
                  namespace: currentDetail.namespace,
                },
              ]
            : []),
        ],
      },
    });

    if (existing) {
      await this.prisma.violationHistory.update({
        where: { id: existing.id },
        data: {
          status: dto.status,
          ...(currentDetail.resourceName &&
          currentDetail.resourceName !== "Unknown"
            ? {
                resourceName: currentDetail.resourceName,
                resourceKind: currentDetail.resourceKind,
              }
            : {}),
        },
      });
    } else {
      await this.prisma.violationHistory.create({
        data: {
          id: normalizedId,
          targetClusterId,
          targetClusterDisplayName,
          policyName: currentDetail.policyName,
          ruleName: currentDetail.ruleName,
          namespace: currentDetail.namespace,
          resourceKind: currentDetail.resourceKind,
          resourceName: currentDetail.resourceName,
          severity: currentDetail.severity,
          status: dto.status,
          message: currentDetail.message,
          occurredAt: new Date(currentDetail.detectedAt),
        },
      });
    }

    // 2. AuditLog 감사 로그 생성
    await this.prisma.auditLog.create({
      data: {
        action: "VIOLATION_STATUS_UPDATED",
        entityType: "POLICY_VIOLATION",
        entityId: normalizedId,
        actorType: "USER",
        userId: user.id,
        metadata: {
          previousStatus,
          newStatus: dto.status,
          note: dto.note ?? null,
          clusterId: targetClusterId,
          clusterDisplayName: targetClusterDisplayName,
          policyName: currentDetail.policyName,
          ruleName: currentDetail.ruleName,
          resourceName: currentDetail.resourceName,
          resourceKind: currentDetail.resourceKind,
          namespace: currentDetail.namespace,
        },
      },
    });

    // 3. 최신 감사 이력 타임라인 조회 후 반환
    const updatedEvents = await this.getViolationAuditEvents(
      normalizedId,
      currentDetail.detectedAt,
      currentDetail.message,
    );

    return {
      ...currentDetail,
      status: dto.status,
      events: updatedEvents,
    };
  }

  private async getViolationAuditEvents(
    id: string,
    detectedAt?: string,
    initialMessage?: string,
  ): Promise<Array<{ label: string; at: string; description: string }>> {
    const events: Array<{ label: string; at: string; description: string }> =
      [];

    if (detectedAt) {
      events.push({
        label: "정책 위반 감지",
        at: detectedAt,
        description:
          initialMessage ?? "정책 엔진(Kyverno)에서 위반이 감지되었습니다.",
      });
    }

    try {
      const auditLogs = await this.prisma.auditLog.findMany({
        where: {
          entityType: "POLICY_VIOLATION",
          entityId: id,
        },
        orderBy: { createdAt: "asc" },
        include: {
          user: {
            select: { email: true },
          },
        },
      });

      for (const log of auditLogs) {
        const meta = log.metadata as Record<string, unknown> | null;
        const nextStatus = (meta?.newStatus as string) ?? "inReview";
        const actor = log.user?.email ?? "관리자";
        const label =
          nextStatus === "resolved"
            ? "해결 완료 처리"
            : nextStatus === "inReview"
              ? "검토 중 상태 변경"
              : "초기 상태(미처리)로 변경";
        const noteSuffix = meta?.note ? ` (메모: ${meta.note})` : "";
        const description = `${actor}님이 처리 상태를 '${nextStatus}'(으)로 변경했습니다.${noteSuffix}`;

        events.push({
          label,
          at: log.createdAt.toISOString(),
          description,
        });
      }
    } catch {
      // 감사 로그 조회 실패 시 기본 이벤트 유지
    }

    return events;
  }

  /**
   * Kyverno 자동 생성 규칙 접두사(autogen-, autogen-cronjob-)를 제거하여 정규화된 룰 이름을 반환합니다.
   *
   * @param ruleName 원본 규칙 이름
   * @returns 정규화된 규칙 이름
   */
  private normalizeRuleName(ruleName: string): string {
    return ruleName
      .replace(/^autogen-cronjob-/, "")
      .replace(/^autogen-/, "")
      .trim();
  }

  private async getSavedStatusMap(): Promise<
    Map<string, "open" | "inReview" | "resolved">
  > {
    try {
      const records = await this.prisma.violationHistory.findMany({
        select: {
          id: true,
          targetClusterId: true,
          policyName: true,
          ruleName: true,
          resourceName: true,
          namespace: true,
          status: true,
        },
      });

      const map = new Map<string, "open" | "inReview" | "resolved">();
      for (const rec of records) {
        const validStatus =
          (rec.status as "open" | "inReview" | "resolved") || "open";
        map.set(rec.id, validStatus);

        const rawRule = rec.ruleName;
        const normalizedRule = this.normalizeRuleName(rawRule);
        const ruleVariants = Array.from(
          new Set([rawRule, normalizedRule, `autogen-${normalizedRule}`]),
        );
        const ns = rec.namespace || "cluster-wide";

        // 리소스명이 유효한 경우에만 리소스 단위 복합 키 매핑을 등록하여 타 리소스 상태 오염 방지
        if (rec.resourceName && rec.resourceName !== "Unknown") {
          for (const r of ruleVariants) {
            map.set(
              `${rec.targetClusterId}:${rec.policyName}:${r}:${rec.resourceName}:${ns}`,
              validStatus,
            );
            // 네임스페이스 생략 또는 cluster-wide 호환 키도 함께 등록
            if (ns !== "cluster-wide") {
              map.set(
                `${rec.targetClusterId}:${rec.policyName}:${r}:${rec.resourceName}:cluster-wide`,
                validStatus,
              );
            }
          }
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private validateClusterAccess(
    user: AuthenticatedUser,
    clusterId: string,
  ): ClusterMetadata {
    if (user.role !== "ADMIN" && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(VIOLATION_ERROR.CLUSTER_ACCESS_DENIED);
    }
    const all = this.clusters.list();
    const cluster = all.find((c) => c.id === clusterId);
    if (!cluster) {
      throw new BusinessException(VIOLATION_ERROR.CLUSTER_ACCESS_DENIED);
    }
    return cluster;
  }

  private getAccessibleClusters(
    user: AuthenticatedUser,
    targetClusterId?: string,
  ): ClusterMetadata[] {
    const all = this.clusters.list();
    const userClusters =
      user.role === "ADMIN"
        ? all
        : all.filter((c) => user.clusterIds.includes(c.id));

    if (targetClusterId) {
      return userClusters.filter((c) => c.id === targetClusterId);
    }
    return userClusters;
  }

  private async getExceptionRequestsMap(): Promise<
    Map<string, { id: string; status: string }>
  > {
    try {
      const requests = await this.prisma.policyExceptionRequest.findMany({
        where: {
          status: {
            in: ["PENDING", "APPLYING", "APPROVED", "CANCELLING"],
          },
        },
      });

      const map = new Map<string, { id: string; status: string }>();
      for (const req of requests) {
        const key = `${req.targetClusterId}:${req.policyName}:${req.resourceName}:${req.resourceNamespace ?? "cluster-wide"}`;
        map.set(key, { id: req.id, status: req.status });
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private extractViolationsFromReport(
    report: PolicyReportRaw,
    cluster: ClusterMetadata,
    exceptionsMap?: Map<string, { id: string; status: string }>,
    savedStatusesMap?: Map<string, "open" | "inReview" | "resolved">,
  ): ViolationSummaryDto[] {
    const results = report.results ?? [];
    const violations: ViolationSummaryDto[] = [];

    results.forEach((result, index) => {
      // fail, warn, error 상태의 결과만 위반으로 추출
      const outcome = result.result?.toLowerCase();
      if (outcome === "fail" || outcome === "warn" || outcome === "error") {
        violations.push(
          this.mapToViolationSummary(
            result,
            report,
            cluster,
            index,
            exceptionsMap,
            savedStatusesMap,
          ),
        );
      }
    });

    return violations;
  }

  private mapToViolationSummary(
    result: PolicyReportResultRaw,
    report: PolicyReportRaw,
    cluster: ClusterMetadata,
    index: number,
    exceptionsMap?: Map<string, { id: string; status: string }>,
    savedStatusesMap?: Map<string, "open" | "inReview" | "resolved">,
  ): ViolationSummaryDto {
    const reportName = report.metadata?.name ?? "unknown-report";
    // 서로 다른 네임스페이스에 동일 이름의 PolicyReport가 존재해도 ID가 충돌하지
    // 않도록 네임스페이스를 포함한다. (클러스터 범위 보고서는 센티널로 대체)
    const reportNamespace =
      report.metadata?.namespace ?? CLUSTER_SCOPE_SENTINEL;
    const id = `${cluster.id}:${reportNamespace}/${reportName}:${index}`;
    const policyName = result.policy ?? "unknown-policy";
    const ruleName = result.rule ?? "unknown-rule";

    const scopeResource = report.scope;
    const ownerRef = report.metadata?.ownerReferences?.[0];
    const targetResource = result.resources?.[0];
    const properties = (result.properties as Record<string, string>) ?? {};

    let resourceKind =
      scopeResource?.kind ||
      ownerRef?.kind ||
      targetResource?.kind ||
      properties["resource.kind"] ||
      properties["kind"] ||
      "";
    let resourceName =
      scopeResource?.name ||
      ownerRef?.name ||
      targetResource?.name ||
      properties["resource.name"] ||
      properties["name"] ||
      "";

    const rawMessage = result.message ?? "";
    if (!resourceKind || !resourceName) {
      const matchKindName = rawMessage.match(
        /(?:on|in|target|resource)\s+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i,
      );
      if (matchKindName) {
        if (!resourceKind) resourceKind = matchKindName[1];
        if (!resourceName) resourceName = matchKindName[2];
      }
    }
    if (!resourceKind) resourceKind = "Pod";
    if (!resourceName) resourceName = "Unknown";

    const namespace =
      scopeResource?.namespace ??
      targetResource?.namespace ??
      properties["resource.namespace"] ??
      report.metadata?.namespace ??
      "cluster-wide";

    let severity: "critical" | "high" | "medium" | "low" | "info" = "medium";
    const rawSev = result.severity?.toLowerCase();
    if (rawSev === "critical") severity = "critical";
    else if (rawSev === "high") severity = "high";
    else if (rawSev === "low") severity = "low";
    else if (rawSev === "info") severity = "info";

    let detectedAt =
      report.metadata?.creationTimestamp ?? new Date().toISOString();
    if (result.timestamp?.seconds) {
      detectedAt = new Date(result.timestamp.seconds * 1000).toISOString();
    }

    const message =
      result.message ??
      `Policy '${policyName}' violation detected on ${resourceKind}/${resourceName}.`;

    const isNamedResource = resourceName && resourceName !== "Unknown";
    const normalizedRule = this.normalizeRuleName(ruleName);

    // 1. 해당 위반 고유 ID 매핑 우선 확인
    let savedStatus: ("open" | "inReview" | "resolved") | undefined =
      savedStatusesMap?.get(id);

    // 2. 인덱스 변동 대응을 위해 리소스명이 유효한 경우에만 정확한 복합 키로 매핑
    if (!savedStatus && isNamedResource) {
      savedStatus =
        savedStatusesMap?.get(
          `${cluster.id}:${policyName}:${ruleName}:${resourceName}:${namespace}`,
        ) ??
        savedStatusesMap?.get(
          `${cluster.id}:${policyName}:${normalizedRule}:${resourceName}:${namespace}`,
        ) ??
        savedStatusesMap?.get(
          `${cluster.id}:${policyName}:${ruleName}:${resourceName}:cluster-wide`,
        ) ??
        savedStatusesMap?.get(
          `${cluster.id}:${policyName}:${normalizedRule}:${resourceName}:cluster-wide`,
        );
    }

    // 3. 예외 신청(Exception) 매핑도 해당 특정 리소스에만 엄격하게 매칭
    let exc = isNamedResource
      ? (exceptionsMap?.get(
          `${cluster.id}:${policyName}:${resourceName}:${namespace}`,
        ) ??
        exceptionsMap?.get(
          `${cluster.id}:${policyName}:${resourceName}:cluster-wide`,
        ))
      : undefined;

    // 상위 Controller로 신청된 예외가 하위 Pod에 매칭되는 경우만 안전하게 연결 (예: Deployment unapproved-redis ➡️ Pod unapproved-redis-5d846bd946-flxzj)
    if (!exc && isNamedResource && exceptionsMap) {
      for (const [key, value] of exceptionsMap.entries()) {
        const [eCluster, ePolicy, eResName, eNs] = key.split(":");
        if (
          eCluster === cluster.id &&
          ePolicy === policyName &&
          (eNs === namespace ||
            eNs === "cluster-wide" ||
            namespace === "cluster-wide") &&
          resourceName.startsWith(`${eResName}-`)
        ) {
          exc = value;
          break;
        }
      }
    }

    let status: "open" | "inReview" | "resolved" = savedStatus ?? "open";
    let exceptionStatus: "none" | "requested" | "approved" = "none";
    let relatedExceptionId: string | undefined = undefined;

    if (exc) {
      relatedExceptionId = exc.id;
      if (exc.status === "APPROVED" || exc.status === "APPLYING") {
        exceptionStatus = "approved";
        if (!savedStatus) status = "inReview";
      } else if (exc.status === "PENDING") {
        exceptionStatus = "requested";
        if (!savedStatus) status = "inReview";
      }
    }

    return {
      id,
      clusterId: cluster.id,
      clusterDisplayName: cluster.displayName,
      namespace,
      policyName,
      ruleName,
      resourceKind,
      resourceName,
      severity,
      status,
      message,
      detectedAt,
      reportName,
      exceptionStatus,
      relatedExceptionId,
    };
  }

  private generateDefaultRecommendation(summary: ViolationSummaryDto): string {
    if (summary.policyName.includes("latest-tag")) {
      return `컨테이너 이미지에 고정된 버전 태그(예: v1.2.0 또는 sha256 digest)를 명시하고 ':latest' 태그 사용을 제거하세요.`;
    }
    if (summary.policyName.includes("resource-limits")) {
      return `운영 네임스페이스(${summary.namespace})의 ${summary.resourceKind} 스펙에 CPU 및 Memory requests/limits를 명시하세요.`;
    }
    if (summary.policyName.includes("privileged")) {
      return `보안을 위해 컨테이너의 securityContext.privileged 설정을 false로 변경하세요.`;
    }
    return `정책 '${summary.policyName}'의 요구사항에 맞추어 매니페스트 설정을 수정한 후 다시 배포하거나 예외 신청을 검토하세요.`;
  }

  private matchesFilter(
    item: ViolationSummaryDto,
    query: ListViolationsQueryDto,
  ): boolean {
    if (query.namespace && item.namespace !== query.namespace) {
      return false;
    }
    if (query.policyName && item.policyName !== query.policyName) {
      return false;
    }
    if (query.ruleName && item.ruleName !== query.ruleName) {
      return false;
    }
    if (
      query.resourceKind &&
      item.resourceKind.toLowerCase() !== query.resourceKind.toLowerCase()
    ) {
      return false;
    }
    if (query.severity && item.severity !== (query.severity as string)) {
      return false;
    }
    if (query.status && item.status !== (query.status as string)) {
      return false;
    }
    if (
      query.exceptionStatus &&
      item.exceptionStatus !== query.exceptionStatus
    ) {
      return false;
    }
    if (query.startDate) {
      const start = new Date(query.startDate).getTime();
      if (!isNaN(start) && new Date(item.detectedAt).getTime() < start) {
        return false;
      }
    }
    if (query.endDate) {
      const end = new Date(query.endDate).getTime();
      if (!isNaN(end) && new Date(item.detectedAt).getTime() > end) {
        return false;
      }
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      const matched =
        item.policyName.toLowerCase().includes(term) ||
        item.ruleName.toLowerCase().includes(term) ||
        item.resourceName.toLowerCase().includes(term) ||
        item.resourceKind.toLowerCase().includes(term) ||
        item.message.toLowerCase().includes(term);
      if (!matched) return false;
    }
    return true;
  }

  /**
   * 주기적으로 (30초 간격) K8s 클러스터의 라이브 PolicyReport 위반 내역을
   * PostgreSQL ViolationHistory 모델에 실시간 동기화하는 백그라운드 워커입니다.
   */
  @Interval(30_000)
  async syncLiveViolations(): Promise<void> {
    try {
      const clusterReports =
        await this.kyvernoAdapter.getClusterPolicyReports();
      const namespacedReports = await this.kyvernoAdapter.getPolicyReports();
      const liveViolations = [...clusterReports, ...namespacedReports];

      for (const violation of liveViolations) {
        const occurredAt = new Date(violation.detectedAt);
        const isNamedResource =
          violation.resourceName && violation.resourceName !== "Unknown";

        // 동일 위반 항목의 중복 DB 저장을 방지하기 위한 유니크 조건 확인
        const existing = await this.prisma.violationHistory.findFirst({
          where: {
            targetClusterId: violation.clusterId,
            policyName: violation.policyName,
            ruleName: violation.ruleName,
            ...(isNamedResource
              ? {
                  resourceName: violation.resourceName,
                  namespace: violation.namespace,
                }
              : {
                  occurredAt,
                }),
          },
        });

        if (existing) {
          // 기존 레코드가 있는 경우 관리자가 수정한 상태(inReview, resolved 등)를 보존하며 메타데이터만 갱신
          await this.prisma.violationHistory.update({
            where: { id: existing.id },
            data: {
              targetClusterDisplayName: violation.clusterDisplayName,
              resourceKind: violation.resourceKind,
              severity: violation.severity,
              message: violation.message,
              occurredAt,
            },
          });
        } else {
          await this.prisma.violationHistory.create({
            data: {
              targetClusterId: violation.clusterId,
              targetClusterDisplayName: violation.clusterDisplayName,
              policyName: violation.policyName,
              ruleName: violation.ruleName,
              namespace: violation.namespace,
              resourceKind: violation.resourceKind,
              resourceName: violation.resourceName,
              severity: violation.severity,
              status: violation.status || "open",
              message: violation.message,
              occurredAt,
            },
          });
        }
      }
    } catch (error) {
      // 백그라운드 동기화 실패 시 캡처 후 지속 실행 수명주기 유지
      this.logger.error(
        `Failed to sync live violations to ViolationHistory DB`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * PostgreSQL ViolationHistory 테이블에서 정책 위반 이력을 조회하여 정규화 DTO로 변환합니다.
   *
   * @param accessibleClusters 권한이 있는 클러스터 목록
   * @param query 필터 쿼리
   * @returns DB 기반 위반 요약 DTO 배열
   */
  private async getViolationsFromDb(
    accessibleClusters: ClusterMetadata[],
    query: ListViolationsQueryDto,
  ): Promise<ViolationSummaryDto[]> {
    const clusterIds = accessibleClusters.map((c) => c.id);
    const clusterMap = new Map(
      accessibleClusters.map((c) => [c.id, c.displayName]),
    );

    const whereClause: Record<string, unknown> = {};
    if (clusterIds.length > 0) {
      whereClause.targetClusterId = { in: clusterIds };
    }
    if (query.namespace) {
      whereClause.namespace = query.namespace;
    }
    if (query.policyName) {
      whereClause.policyName = query.policyName;
    }
    if (query.ruleName) {
      whereClause.ruleName = query.ruleName;
    }
    if (query.severity) {
      whereClause.severity = query.severity;
    }
    if (query.status) {
      whereClause.status = query.status;
    }
    if (query.startDate || query.endDate) {
      const occurredAtFilter: Record<string, Date> = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (!isNaN(start.getTime())) occurredAtFilter.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (!isNaN(end.getTime())) occurredAtFilter.lte = end;
      }
      if (Object.keys(occurredAtFilter).length > 0) {
        whereClause.occurredAt = occurredAtFilter;
      }
    }

    const dbRecords = await this.prisma.violationHistory.findMany({
      where: whereClause,
      orderBy: { occurredAt: query.sortOrder === "asc" ? "asc" : "desc" },
    });

    const exceptionsMap = await this.getExceptionRequestsMap();

    const mapped = dbRecords.map((record) => {
      const clusterDisplayName =
        clusterMap.get(record.targetClusterId) ??
        record.targetClusterDisplayName ??
        record.targetClusterId;

      const key = `${record.targetClusterId}:${record.policyName}:${record.resourceName}:${record.namespace}`;
      const exc = exceptionsMap.get(key);

      const recordStatus =
        (record.status as "open" | "inReview" | "resolved") || "open";
      let status: "open" | "inReview" | "resolved" = recordStatus;
      let exceptionStatus: "none" | "requested" | "approved" = "none";
      let relatedExceptionId: string | undefined = undefined;

      if (exc) {
        relatedExceptionId = exc.id;
        if (exc.status === "APPROVED" || exc.status === "APPLYING") {
          exceptionStatus = "approved";
          if (recordStatus !== "resolved") {
            status = "inReview";
          }
        } else if (exc.status === "PENDING") {
          exceptionStatus = "requested";
          if (recordStatus !== "resolved") {
            status = "inReview";
          }
        }
      }

      const item: ViolationSummaryDto = {
        id: record.id,
        clusterId: record.targetClusterId,
        clusterDisplayName,
        namespace: record.namespace ?? "cluster-wide",
        policyName: record.policyName,
        ruleName: record.ruleName,
        resourceKind: record.resourceKind ?? "Unknown",
        resourceName: record.resourceName ?? "Unknown",
        severity:
          (record.severity as
            | "critical"
            | "high"
            | "medium"
            | "low"
            | "info") ?? "medium",
        status,
        message:
          record.message ??
          `[DB Fallback] Policy '${record.policyName}' rule '${record.ruleName}' violation recorded in cluster '${clusterDisplayName}'.`,
        detectedAt: record.occurredAt.toISOString(),
        reportName: "db-fallback",
        exceptionStatus,
        relatedExceptionId,
      };
      return item;
    });

    let filtered = mapped.filter((item) => this.matchesFilter(item, query));

    if (query.page && query.limit) {
      const skip = (query.page - 1) * query.limit;
      filtered = filtered.slice(skip, skip + query.limit);
    }

    return filtered;
  }
}
