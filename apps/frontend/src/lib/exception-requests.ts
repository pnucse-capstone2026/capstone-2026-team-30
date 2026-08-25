export type ExceptionRequestStatus =
  | "pending"
  | "applying"
  | "approved"
  | "rejected"
  | "cancelling"
  | "expiring"
  | "expired"
  | "cancelled"
  | "failed";

export type ExceptionRiskLevel = "critical" | "high" | "medium" | "low";

export type ExceptionRequest = {
  id: string;
  policyName: string;
  ruleNames?: string[];
  appliedRuleNames?: string[];
  resourceKind: string;
  resourceName: string;
  namespace: string;
  targetClusterId?: string;
  targetClusterDisplayName?: string;
  clusterName: string;
  k8sExceptionName?: string;
  requester: string;
  team: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
  status: ExceptionRequestStatus;
  reviewer: string;
  decisionNote?: string | null;
  decidedAt?: string | null;
  activatedAt?: string | null;
  applyAttempts?: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  riskLevel: ExceptionRiskLevel;
  compensatingControl: string;
  relatedViolationId?: string;
};

export const exceptionRequests: ExceptionRequest[] = [
  {
    id: "EXC-2026-0012",
    policyName: "require-resource-limits",
    resourceKind: "Deployment",
    resourceName: "payment-api",
    namespace: "payments",
    clusterName: "production",
    requester: "김민준",
    team: "결제플랫폼팀",
    reason: "긴급 배포 일정으로 limits 적용을 다음 릴리스에 포함해야 합니다.",
    requestedAt: "2026-07-09",
    expiresAt: "2026-07-16",
    status: "pending",
    reviewer: "관리자",
    riskLevel: "high",
    relatedViolationId: "vio-001",
    compensatingControl:
      "예외 기간 동안 HPA 지표와 노드 메모리 사용률을 매일 확인합니다.",
  },
  {
    id: "EXC-2026-0011",
    policyName: "disallow-latest-tag",
    resourceKind: "Pod",
    resourceName: "worker-7f86c",
    namespace: "batch",
    clusterName: "staging",
    requester: "이서연",
    team: "배치서비스팀",
    reason: "배치 앱 검증 중 임시 이미지 태그를 사용해야 합니다.",
    requestedAt: "2026-07-08",
    expiresAt: "2026-07-12",
    status: "approved",
    reviewer: "관리자",
    riskLevel: "medium",
    relatedViolationId: "vio-002",
    compensatingControl:
      "스테이징 네임스페이스에서만 허용하고 운영 반영 전 고정 태그로 교체합니다.",
  },
  {
    id: "EXC-2026-0009",
    policyName: "restrict-host-path",
    resourceKind: "DaemonSet",
    resourceName: "node-exporter",
    namespace: "monitoring",
    clusterName: "production",
    requester: "박지훈",
    team: "SRE팀",
    reason: "노드 메트릭 수집을 위해 승인된 hostPath 접근이 필요합니다.",
    requestedAt: "2026-07-05",
    expiresAt: "2026-07-20",
    status: "approved",
    reviewer: "SRE팀",
    riskLevel: "critical",
    relatedViolationId: "vio-004",
    compensatingControl:
      "읽기 전용 마운트와 전용 서비스 계정을 사용하고 감사 로그를 보관합니다.",
  },
  {
    id: "EXC-2026-0007",
    policyName: "require-team-label",
    resourceKind: "Service",
    resourceName: "user-service",
    namespace: "users",
    clusterName: "development",
    requester: "최유진",
    team: "사용자경험팀",
    reason: "소유 팀 라벨 정리 전까지 개발 환경 예외를 요청했습니다.",
    requestedAt: "2026-07-03",
    expiresAt: "2026-07-10",
    status: "rejected",
    reviewer: "관리자",
    relatedViolationId: "vio-003",
    riskLevel: "low",
    compensatingControl:
      "개발 리소스라도 팀 라벨은 즉시 적용 가능하므로 예외 없이 수정합니다.",
  },
  {
    id: "EXC-2026-0004",
    policyName: "require-image-registry",
    resourceKind: "Deployment",
    resourceName: "demo-web",
    namespace: "default",
    clusterName: "sandbox",
    requester: "정다은",
    team: "교육지원팀",
    reason: "교육 실습을 위해 외부 이미지를 임시로 사용했습니다.",
    requestedAt: "2026-06-28",
    expiresAt: "2026-07-05",
    status: "expired",
    reviewer: "교육지원팀",
    relatedViolationId: "vio-005",
    riskLevel: "medium",
    compensatingControl:
      "샌드박스 클러스터에서만 허용하고 실습 종료 후 리소스를 삭제합니다.",
  },
];

export const exceptionStatusLabel: Record<ExceptionRequestStatus, string> = {
  pending: "승인 대기",
  applying: "예외 적용 중",
  approved: "승인",
  rejected: "거절",
  cancelling: "취소 처리 중",
  expiring: "만료 처리 중",
  expired: "만료",
  cancelled: "취소됨",
  failed: "적용 실패",
};

export const exceptionStatusClassName: Record<ExceptionRequestStatus, string> =
  {
    pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
    applying: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
    approved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    rejected: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
    cancelling: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
    expiring: "bg-orange-50 text-orange-700 ring-1 ring-orange-100",
    expired: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    cancelled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    failed: "bg-red-50 text-red-700 ring-1 ring-red-100",
  };

export const exceptionRiskLabel: Record<ExceptionRiskLevel, string> = {
  critical: "긴급",
  high: "높음",
  medium: "중간",
  low: "낮음",
};

export const exceptionRiskClassName: Record<ExceptionRiskLevel, string> = {
  critical: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  high: "bg-orange-50 text-orange-700 ring-1 ring-orange-100",
  medium: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  low: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};
