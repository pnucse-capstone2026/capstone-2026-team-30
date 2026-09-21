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
  team?: string;
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

export const exceptionRequests: ExceptionRequest[] = [];

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
