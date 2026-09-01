import { requestWithAuth } from "@/lib/api-client";

export type ViolationSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ViolationStatus = "open" | "inReview" | "resolved";
export type ExceptionStatus = "none" | "requested" | "approved";

export type PolicyViolation = {
  id: string;
  clusterId?: string;
  clusterDisplayName?: string;
  policyName: string;
  policyType: "validate" | "mutate" | "generate";
  clusterName: string;
  namespace: string;
  resourceKind: string;
  resourceName: string;
  severity: ViolationSeverity;
  status: ViolationStatus;
  exceptionStatus: ExceptionStatus;
  detectedAt: string;
  assignee: string;
  message: string;
  ruleName: string;
  engineResponse: string;
  admissionReviewId: string;
  resourcePath: string;
  recommendation: string;
  relatedExceptionId?: string;
  manifest: string;
  events: {
    label: string;
    at: string;
    description: string;
  }[];
  rawResult?: Record<string, unknown>;
  resourceSpec?: Record<string, unknown>;
};

export type ViolationListFilter = {
  clusterId?: string;
  namespace?: string;
  policyName?: string;
  ruleName?: string;
  resourceKind?: string;
  severity?: string;
  status?: string;
  exceptionStatus?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

/**
 * 백엔드에서 실시간 PolicyReport 기반 정책 위반 목록을 조회합니다.
 */
export async function getViolations(
  filter: ViolationListFilter = {},
): Promise<PolicyViolation[]> {
  const params = new URLSearchParams();
  if (filter.clusterId) params.append("clusterId", filter.clusterId);
  if (filter.namespace) params.append("namespace", filter.namespace);
  if (filter.policyName) params.append("policyName", filter.policyName);
  if (filter.ruleName) params.append("ruleName", filter.ruleName);
  if (filter.resourceKind) params.append("resourceKind", filter.resourceKind);
  if (filter.severity) params.append("severity", filter.severity);
  if (filter.status) params.append("status", filter.status);
  if (filter.exceptionStatus)
    params.append("exceptionStatus", filter.exceptionStatus);
  if (filter.startDate) params.append("startDate", filter.startDate);
  if (filter.endDate) params.append("endDate", filter.endDate);
  if (filter.search) params.append("search", filter.search);
  if (filter.page) params.append("page", String(filter.page));
  if (filter.limit) params.append("limit", String(filter.limit));
  if (filter.sortBy) params.append("sortBy", filter.sortBy);
  if (filter.sortOrder) params.append("sortOrder", filter.sortOrder);

  const queryStr = params.toString();
  const path = `/violations${queryStr ? `?${queryStr}` : ""}`;

  try {
    const data = await requestWithAuth<
      Array<{
        id: string;
        clusterId: string;
        clusterDisplayName: string;
        namespace: string;
        policyName: string;
        ruleName: string;
        resourceKind: string;
        resourceName: string;
        severity: ViolationSeverity;
        status: ViolationStatus;
        exceptionStatus?: ExceptionStatus;
        relatedExceptionId?: string;
        message: string;
        detectedAt: string;
        reportName: string;
      }>
    >(path);

    return data.map((item) => ({
      id: item.id,
      clusterId: item.clusterId,
      clusterDisplayName: item.clusterDisplayName,
      policyName: item.policyName,
      policyType: "validate",
      clusterName: item.clusterDisplayName || item.clusterId,
      namespace: item.namespace,
      resourceKind: item.resourceKind,
      resourceName: item.resourceName,
      severity: item.severity,
      status: item.status,
      exceptionStatus: item.exceptionStatus || "none",
      relatedExceptionId: item.relatedExceptionId,
      detectedAt: item.detectedAt
        ? new Date(item.detectedAt).toLocaleString("ko-KR")
        : "최근",
      assignee: "담당 보안팀",
      message: item.message,
      ruleName: item.ruleName,
      engineResponse: "fail",
      admissionReviewId: item.id,
      resourcePath: `spec.template.spec`,
      recommendation: `정책 '${item.policyName}' 규칙 위반이 감지되었습니다.`,
      manifest: `apiVersion: v1\nkind: ${item.resourceKind}\nmetadata:\n  name: ${item.resourceName}\n  namespace: ${item.namespace}`,
      events: [
        {
          label: "탐지됨",
          at: item.detectedAt
            ? new Date(item.detectedAt).toLocaleString("ko-KR")
            : "최근",
          description: item.message,
        },
      ],
    }));
  } catch {
    return [];
  }
}

/**
 * 특정 위반 항목의 상세 정보 및 원본 K8s PolicyReport 결과를 조회합니다.
 */
export async function getViolationDetail(
  clusterId: string,
  id: string,
): Promise<PolicyViolation | null> {
  const normalizedId = decodeURIComponent(id);
  const targetClusterId =
    clusterId ||
    (normalizedId.includes(":") ? normalizedId.split(":")[0] : "default");
  try {
    const item = await requestWithAuth<{
      id: string;
      clusterId: string;
      clusterDisplayName: string;
      namespace: string;
      policyName: string;
      ruleName: string;
      resourceKind: string;
      resourceName: string;
      severity: ViolationSeverity;
      status: ViolationStatus;
      message: string;
      detectedAt: string;
      reportName: string;
      recommendation: string;
      resourceSpec: Record<string, unknown>;
      rawResult: Record<string, unknown>;
      events?: Array<{
        label: string;
        at: string;
        description: string;
      }>;
    }>(`/violations/${targetClusterId}/${encodeURIComponent(normalizedId)}`);

    const formattedEvents =
      item.events && item.events.length > 0
        ? item.events.map((e) => ({
            label: e.label,
            at: e.at ? new Date(e.at).toLocaleString("ko-KR") : "최근",
            description: e.description,
          }))
        : [
            {
              label: "탐지됨",
              at: item.detectedAt
                ? new Date(item.detectedAt).toLocaleString("ko-KR")
                : "최근",
              description: item.message,
            },
          ];

    return {
      id: item.id,
      clusterId: item.clusterId,
      clusterDisplayName: item.clusterDisplayName,
      policyName: item.policyName,
      policyType: "validate",
      clusterName: item.clusterDisplayName || item.clusterId,
      namespace: item.namespace,
      resourceKind: item.resourceKind,
      resourceName: item.resourceName,
      severity: item.severity,
      status: item.status,
      exceptionStatus: "none",
      detectedAt: item.detectedAt
        ? new Date(item.detectedAt).toLocaleString("ko-KR")
        : "최근",
      assignee: "담당 보안팀",
      message: item.message,
      ruleName: item.ruleName,
      engineResponse: "fail",
      admissionReviewId: item.id,
      resourcePath: `spec.template.spec`,
      recommendation: item.recommendation,
      manifest:
        Object.keys(item.resourceSpec ?? {}).length > 0
          ? JSON.stringify(item.resourceSpec, null, 2)
          : `apiVersion: v1\nkind: ${item.resourceKind || "Unknown"}\nmetadata:\n  name: ${item.resourceName || "Unknown"}\n  namespace: ${item.namespace || "default"}`,
      events: formattedEvents,
      rawResult: item.rawResult,
      resourceSpec: item.resourceSpec,
    };
  } catch {
    return null;
  }
}

/**
 * 백엔드 API를 호출하여 정책 위반의 처리 상태를 변경하고 감사 로그를 기록합니다.
 *
 * @param id 위반 고유 식별자
 * @param status 변경할 상태 ("open" | "inReview" | "resolved")
 * @param note 상태 변경 사유 메모 (선택)
 * @param clusterId 클러스터 식별자 (선택)
 * @returns 갱신된 정책 위반 상세 객체
 */
export async function updateViolationStatus(
  id: string,
  status: ViolationStatus,
  note?: string,
  clusterId?: string,
): Promise<PolicyViolation> {
  const normalizedId = decodeURIComponent(id);
  const targetClusterId =
    clusterId ||
    (normalizedId.includes(":") ? normalizedId.split(":")[0] : "default");
  const path = `/violations/${targetClusterId}/${encodeURIComponent(normalizedId)}/status`;

  const item = await requestWithAuth<{
    id: string;
    clusterId: string;
    clusterDisplayName: string;
    namespace: string;
    policyName: string;
    ruleName: string;
    resourceKind: string;
    resourceName: string;
    severity: ViolationSeverity;
    status: ViolationStatus;
    message: string;
    detectedAt: string;
    reportName: string;
    recommendation: string;
    resourceSpec: Record<string, unknown>;
    rawResult: Record<string, unknown>;
    events?: Array<{
      label: string;
      at: string;
      description: string;
    }>;
  }>(path, {
    method: "PATCH",
    body: { status, note },
  });

  const formattedEvents =
    item.events && item.events.length > 0
      ? item.events.map((e) => ({
          label: e.label,
          at: e.at ? new Date(e.at).toLocaleString("ko-KR") : "최근",
          description: e.description,
        }))
      : [
          {
            label: "탐지됨",
            at: item.detectedAt
              ? new Date(item.detectedAt).toLocaleString("ko-KR")
              : "최근",
            description: item.message,
          },
        ];

  return {
    id: item.id,
    clusterId: item.clusterId,
    clusterDisplayName: item.clusterDisplayName,
    policyName: item.policyName,
    policyType: "validate",
    clusterName: item.clusterDisplayName || item.clusterId,
    namespace: item.namespace,
    resourceKind: item.resourceKind,
    resourceName: item.resourceName,
    severity: item.severity,
    status: item.status,
    exceptionStatus: "none",
    detectedAt: item.detectedAt
      ? new Date(item.detectedAt).toLocaleString("ko-KR")
      : "최근",
    assignee: "담당 보안팀",
    message: item.message,
    ruleName: item.ruleName,
    engineResponse: "fail",
    admissionReviewId: item.id,
    resourcePath: `spec.template.spec`,
    recommendation: item.recommendation,
    manifest:
      Object.keys(item.resourceSpec ?? {}).length > 0
        ? JSON.stringify(item.resourceSpec, null, 2)
        : `apiVersion: v1\nkind: ${item.resourceKind || "Unknown"}\nmetadata:\n  name: ${item.resourceName || "Unknown"}\n  namespace: ${item.namespace || "default"}`,
    events: formattedEvents,
    rawResult: item.rawResult,
    resourceSpec: item.resourceSpec,
  };
}

export const policyViolations: PolicyViolation[] = [];

export const severityLabel: Record<ViolationSeverity, string> = {
  critical: "긴급",
  high: "높음",
  medium: "중간",
  low: "낮음",
  info: "정보",
};

export const severityClassName: Record<ViolationSeverity, string> = {
  critical: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  high: "bg-orange-50 text-orange-700 ring-1 ring-orange-100",
  medium: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  low: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  info: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
};

export const statusLabel: Record<ViolationStatus, string> = {
  open: "미처리",
  inReview: "검토 중",
  resolved: "완료",
};

export const statusClassName: Record<ViolationStatus, string> = {
  open: "bg-rose-50 text-rose-700",
  inReview: "bg-blue-50 text-blue-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

export const exceptionLabel: Record<ExceptionStatus, string> = {
  none: "없음",
  requested: "신청됨",
  approved: "승인됨",
};

export const exceptionClassName: Record<ExceptionStatus, string> = {
  none: "bg-slate-100 text-slate-500",
  requested: "bg-violet-50 text-violet-700",
  approved: "bg-cyan-50 text-cyan-700",
};
