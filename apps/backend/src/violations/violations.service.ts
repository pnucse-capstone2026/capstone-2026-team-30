import { Injectable } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { ClusterMetadata, ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { ListViolationsQueryDto } from "./dto/list-violations-query.dto";
import { ViolationDetailDto } from "./dto/violation-detail.dto";
import { ViolationSummaryDto } from "./dto/violation-summary.dto";
import { VIOLATION_ERROR } from "./violation.errors";

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
 * Kyverno 정책 위반(PolicyReport) 실시간 수집 및 분석 서비스
 */
@Injectable()
export class ViolationsService {
  constructor(
    private readonly clusters: ClusterProvider,
    private readonly kyvernoAdapter: KyvernoAdapter,
  ) {}

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
    const accessibleClusters = this.getAccessibleClusters(user, query.clusterId);
    if (accessibleClusters.length === 0) {
      return [];
    }

    const allViolations: ViolationSummaryDto[] = [];

    for (const cluster of accessibleClusters) {
      try {
        const clusterReports =
          await this.kyvernoAdapter.listClusterPolicyReports(cluster.id);
        const namespacedReports =
          await this.kyvernoAdapter.listNamespacedPolicyReports(
            cluster.id,
            query.namespace,
          );

        for (const raw of clusterReports) {
          const extracted = this.extractViolationsFromReport(
            raw as PolicyReportRaw,
            cluster,
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
          );
          for (const item of extracted) {
            if (this.matchesFilter(item, query)) {
              allViolations.push(item);
            }
          }
        }
      } catch {
        // 단일 클러스터 조회 실패가 전체 위반 목록 조회를 중단시키지 않도록 격리
        continue;
      }
    }

    return allViolations.sort(
      (a, b) =>
        new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );
  }

  /**
   * 특정 정책 위반의 상세 정보 및 Bedrock AI 분석용 메타데이터를 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param id 위반 고유 식별자 (<clusterId>:<reportName>:<resultIndex>)
   * @param user 인증된 요청자 정보
   * @returns 정책 위반 상세 DTO
   * @throws {BusinessException} 클러스터 미배정(VIOLATION_CLUSTER_ACCESS_DENIED) 또는 위반 미존재(VIOLATION_NOT_FOUND_IN_CLUSTER) 시
   */
  async getDetail(
    clusterId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<ViolationDetailDto> {
    const cluster = this.validateClusterAccess(user, clusterId);

    // ID 포맷: clusterId:reportName:index
    const parts = id.split(":");
    if (parts.length < 3) {
      throw new BusinessException(VIOLATION_ERROR.NOT_FOUND);
    }
    const reportName = parts[1];
    const index = parseInt(parts[2], 10);

    if (isNaN(index)) {
      throw new BusinessException(VIOLATION_ERROR.NOT_FOUND);
    }

    let report: PolicyReportRaw | null = null;

    // Namespaced PolicyReport 우선 조회
    const namespaced = await this.kyvernoAdapter.listNamespacedPolicyReports(clusterId);
    report = (namespaced.find(
      (r) => r.metadata?.name === reportName,
    ) as PolicyReportRaw) ?? null;

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
    const summary = this.mapToViolationSummary(
      rawResult,
      report,
      cluster,
      index,
    );

    const recommendation = this.generateDefaultRecommendation(summary);

    return {
      ...summary,
      recommendation,
      resourceSpec: (rawResult.resources?.[0] as Record<string, unknown>) ?? {},
      rawResult,
    };
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

  private extractViolationsFromReport(
    report: PolicyReportRaw,
    cluster: ClusterMetadata,
  ): ViolationSummaryDto[] {
    const results = report.results ?? [];
    const violations: ViolationSummaryDto[] = [];

    results.forEach((result, index) => {
      // fail, warn, error 상태의 결과만 위반으로 추출
      const outcome = result.result?.toLowerCase();
      if (outcome === "fail" || outcome === "warn" || outcome === "error") {
        violations.push(
          this.mapToViolationSummary(result, report, cluster, index),
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
  ): ViolationSummaryDto {
    const reportName = report.metadata?.name ?? "unknown-report";
    const id = `${cluster.id}:${reportName}:${index}`;
    const policyName = result.policy ?? "unknown-policy";
    const ruleName = result.rule ?? "unknown-rule";

    const targetResource = result.resources?.[0];
    const resourceKind = targetResource?.kind ?? "Unknown";
    const resourceName = targetResource?.name ?? "Unknown";
    const namespace =
      targetResource?.namespace ?? report.metadata?.namespace ?? "cluster-wide";

    let severity: "critical" | "high" | "medium" | "low" | "info" = "medium";
    const rawSev = result.severity?.toLowerCase();
    if (rawSev === "critical") severity = "critical";
    else if (rawSev === "high") severity = "high";
    else if (rawSev === "low") severity = "low";
    else if (rawSev === "info") severity = "info";

    let detectedAt = report.metadata?.creationTimestamp ?? new Date().toISOString();
    if (result.timestamp?.seconds) {
      detectedAt = new Date(result.timestamp.seconds * 1000).toISOString();
    }

    const message =
      result.message ??
      `Policy '${policyName}' violation detected on ${resourceKind}/${resourceName}.`;

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
      status: "open",
      message,
      detectedAt,
      reportName,
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
    if (query.severity && item.severity !== (query.severity as string)) {
      return false;
    }
    if (query.status && item.status !== (query.status as string)) {
      return false;
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      const matched =
        item.policyName.toLowerCase().includes(term) ||
        item.ruleName.toLowerCase().includes(term) ||
        item.resourceName.toLowerCase().includes(term) ||
        item.message.toLowerCase().includes(term);
      if (!matched) return false;
    }
    return true;
  }
}
