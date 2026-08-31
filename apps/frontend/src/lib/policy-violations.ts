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
  const targetClusterId = clusterId || "default";
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
    }>(`/violations/${targetClusterId}/${encodeURIComponent(id)}`);

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
  const targetClusterId =
    clusterId || (id.includes(":") ? id.split(":")[0] : "default");
  const path = `/violations/${targetClusterId}/${encodeURIComponent(id)}/status`;

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

export const policyViolations: PolicyViolation[] = [
  {
    id: "vio-001",
    policyName: "require-resource-limits",
    policyType: "validate",
    clusterName: "production",
    namespace: "payments",
    resourceKind: "Deployment",
    resourceName: "payment-api",
    severity: "critical",
    status: "open",
    exceptionStatus: "none",
    detectedAt: "2026-07-08 10:30",
    assignee: "플랫폼팀",
    message:
      "컨테이너 payment-api에 CPU와 memory limits가 설정되어 있지 않습니다.",
    ruleName: "validate-resource-limits",
    engineResponse: "fail",
    admissionReviewId: "ar-5b71e0d8",
    resourcePath: "spec.template.spec.containers[0].resources.limits",
    recommendation:
      "운영 네임스페이스의 모든 컨테이너에 requests와 limits를 명시하고 배포를 다시 제출하세요.",
    manifest: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments
spec:
  template:
    spec:
      containers:
        - name: payment-api
          image: registry.example.com/payment-api:1.8.2
          resources:
            requests:
              cpu: 250m
              memory: 512Mi`,
    events: [
      {
        label: "정책 위반 감지",
        at: "2026-07-08 10:30",
        description:
          "AdmissionReview에서 validate-resource-limits 규칙이 실패했습니다.",
      },
      {
        label: "담당자 배정",
        at: "2026-07-08 10:34",
        description: "플랫폼팀에 조치 요청이 생성되었습니다.",
      },
    ],
  },
  {
    id: "vio-002",
    policyName: "disallow-latest-tag",
    policyType: "validate",
    clusterName: "staging",
    namespace: "batch",
    resourceKind: "Pod",
    resourceName: "worker-7f86c",
    severity: "high",
    status: "inReview",
    exceptionStatus: "requested",
    relatedExceptionId: "EXC-2026-0011",
    detectedAt: "2026-07-08 10:17",
    assignee: "배치팀",
    message: "이미지 태그 latest 사용이 제한되어 있습니다.",
    ruleName: "require-fixed-image-tag",
    engineResponse: "fail",
    admissionReviewId: "ar-c2f8a010",
    resourcePath: "spec.containers[0].image",
    recommendation:
      "재현 가능한 배포를 위해 빌드 번호 또는 SemVer 기반의 고정 태그를 사용하세요.",
    manifest: `apiVersion: v1
kind: Pod
metadata:
  name: worker-7f86c
  namespace: batch
spec:
  containers:
    - name: worker
      image: registry.example.com/batch-worker:latest`,
    events: [
      {
        label: "정책 위반 감지",
        at: "2026-07-08 10:17",
        description: "latest 태그가 감지되어 배포 검토 상태로 전환되었습니다.",
      },
      {
        label: "예외 신청",
        at: "2026-07-08 10:22",
        description: "배치팀에서 임시 예외를 요청했습니다.",
      },
    ],
  },
  {
    id: "vio-003",
    policyName: "require-team-label",
    policyType: "validate",
    clusterName: "development",
    namespace: "users",
    resourceKind: "Service",
    resourceName: "user-service",
    severity: "medium",
    status: "open",
    exceptionStatus: "none",
    detectedAt: "2026-07-08 09:53",
    assignee: "사용자서비스팀",
    message: "리소스에 team 라벨이 없습니다.",
    ruleName: "require-owner-labels",
    engineResponse: "fail",
    admissionReviewId: "ar-2b4a9d20",
    resourcePath: "metadata.labels.team",
    recommendation:
      "서비스 소유 팀을 추적할 수 있도록 metadata.labels.team 값을 추가하세요.",
    manifest: `apiVersion: v1
kind: Service
metadata:
  name: user-service
  namespace: users
  labels:
    app: user-service
spec:
  selector:
    app: user-service`,
    events: [
      {
        label: "정책 위반 감지",
        at: "2026-07-08 09:53",
        description: "소유 팀 라벨 누락으로 정책 검사를 통과하지 못했습니다.",
      },
    ],
  },
  {
    id: "vio-004",
    policyName: "restrict-host-path",
    policyType: "validate",
    clusterName: "production",
    namespace: "monitoring",
    resourceKind: "DaemonSet",
    resourceName: "node-exporter",
    severity: "high",
    status: "inReview",
    exceptionStatus: "approved",
    relatedExceptionId: "EXC-2026-0009",
    detectedAt: "2026-07-08 09:21",
    assignee: "SRE팀",
    message: "hostPath 볼륨 사용은 승인된 워크로드로 제한됩니다.",
    ruleName: "block-host-path",
    engineResponse: "warn",
    admissionReviewId: "ar-f59b2d41",
    resourcePath: "spec.template.spec.volumes[0].hostPath",
    recommendation:
      "승인된 모니터링 에이전트인지 확인하고 예외 만료일 전에 대체 구성을 검토하세요.",
    manifest: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
  namespace: monitoring
spec:
  template:
    spec:
      volumes:
        - name: proc
          hostPath:
            path: /proc`,
    events: [
      {
        label: "정책 위반 감지",
        at: "2026-07-08 09:21",
        description: "hostPath 사용이 감지되어 검토 상태가 생성되었습니다.",
      },
      {
        label: "예외 승인",
        at: "2026-07-08 09:45",
        description: "SRE팀 운영 목적의 임시 예외가 승인되었습니다.",
      },
    ],
  },
  {
    id: "vio-005",
    policyName: "require-image-registry",
    policyType: "mutate",
    clusterName: "sandbox",
    namespace: "default",
    resourceKind: "Deployment",
    resourceName: "demo-web",
    severity: "low",
    status: "resolved",
    exceptionStatus: "none",
    detectedAt: "2026-07-08 08:48",
    assignee: "교육지원팀",
    message: "허용된 이미지 레지스트리 접두어가 누락되어 자동 보정되었습니다.",
    ruleName: "prepend-approved-registry",
    engineResponse: "pass",
    admissionReviewId: "ar-87ff0d91",
    resourcePath: "spec.template.spec.containers[0].image",
    recommendation:
      "샌드박스 템플릿의 기본 이미지 경로를 승인 레지스트리 기준으로 업데이트하세요.",
    manifest: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-web
  namespace: default
spec:
  template:
    spec:
      containers:
        - name: web
          image: registry.example.com/demo-web:0.4.1`,
    events: [
      {
        label: "정책 위반 감지",
        at: "2026-07-08 08:48",
        description: "허용 레지스트리 규칙의 자동 보정 정책이 실행되었습니다.",
      },
      {
        label: "해결 완료",
        at: "2026-07-08 08:49",
        description: "보정된 매니페스트가 정책 검사를 통과했습니다.",
      },
    ],
  },
];

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
