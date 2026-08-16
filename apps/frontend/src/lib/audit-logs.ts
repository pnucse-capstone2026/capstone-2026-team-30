export type AuditLog = {
  id: string;
  action: string;
  entityType: "USER" | "POLICY_EXCEPTION_REQUEST" | "VIOLATION_HISTORY" | "POLICY" | "CLUSTER";
  entityId: string;
  actorEmail: string;
  actorRole: "ADMIN" | "APPROVER" | "REQUESTER" | "VIEWER";
  createdAt: string;
  summary: string;
  metadata: string;
};

export const auditLogs: AuditLog[] = [
  {
    id: "audit-001",
    action: "USER_ROLE_UPDATED",
    entityType: "USER",
    entityId: "14bce360-2d2d-40fc-a7a8",
    actorEmail: "admin@example.com",
    actorRole: "ADMIN",
    createdAt: "2026-07-08 11:42",
    summary: "사용자 역할이 REQUESTER에서 APPROVER로 변경되었습니다.",
    metadata: "target=ops-reviewer@example.com",
  },
  {
    id: "audit-002",
    action: "EXCEPTION_APPROVED",
    entityType: "POLICY_EXCEPTION_REQUEST",
    entityId: "EXC-2026-0011",
    actorEmail: "approver@example.com",
    actorRole: "APPROVER",
    createdAt: "2026-07-08 11:18",
    summary: "정책 예외 신청이 승인되었습니다.",
    metadata: "policy=disallow-latest-tag expiresAt=2026-07-15",
  },
  {
    id: "audit-003",
    action: "VIOLATION_STATUS_UPDATED",
    entityType: "VIOLATION_HISTORY",
    entityId: "vio-002",
    actorEmail: "admin@example.com",
    actorRole: "ADMIN",
    createdAt: "2026-07-08 10:55",
    summary: "정책 위반 상태가 검토 중으로 변경되었습니다.",
    metadata: "policy=disallow-latest-tag rule=require-fixed-image-tag",
  },
  {
    id: "audit-004",
    action: "USER_DISABLED",
    entityType: "USER",
    entityId: "6f2f4c8d-9e54-4e21",
    actorEmail: "admin@example.com",
    actorRole: "ADMIN",
    createdAt: "2026-07-08 10:21",
    summary: "사용자 계정이 비활성화되었습니다.",
    metadata: "target=former-user@example.com",
  },
  {
    id: "audit-005",
    action: "POLICY_SYNC_REQUESTED",
    entityType: "POLICY",
    entityId: "require-resource-limits",
    actorEmail: "admin@example.com",
    actorRole: "ADMIN",
    createdAt: "2026-07-08 09:48",
    summary: "정책 동기화가 요청되었습니다.",
    metadata: "cluster=production namespace=payments",
  },
  {
    id: "audit-006",
    action: "CLUSTER_HEALTH_CHECKED",
    entityType: "CLUSTER",
    entityId: "production",
    actorEmail: "system@example.com",
    actorRole: "ADMIN",
    createdAt: "2026-07-08 09:00",
    summary: "클러스터 상태 점검이 기록되었습니다.",
    metadata: "status=healthy source=scheduler",
  },
];

export const entityTypeLabel: Record<AuditLog["entityType"], string> = {
  USER: "사용자",
  POLICY_EXCEPTION_REQUEST: "예외 신청",
  VIOLATION_HISTORY: "정책 오류",
  POLICY: "정책",
  CLUSTER: "클러스터",
};

export const entityTypeClassName: Record<AuditLog["entityType"], string> = {
  USER: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  POLICY_EXCEPTION_REQUEST: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
  VIOLATION_HISTORY: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  POLICY: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  CLUSTER: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100",
};
