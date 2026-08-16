import { type UserRole } from "@/lib/auth-api";

export type NotificationType = "exception" | "violation" | "cluster" | "audit" | "policy";
export type NotificationSeverity = "info" | "warning" | "critical" | "success";

export type AppNotification = {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  severity: NotificationSeverity;
  read: boolean;
  createdAt: string;
  href: string;
  targetRoles?: UserRole[];
  targetUserEmails?: string[];
};

export const notifications: AppNotification[] = [
  {
    id: "noti-001",
    title: "승인 대기 예외가 있습니다",
    message: "require-resource-limits 예외 신청 검토가 필요합니다.",
    type: "exception",
    severity: "warning",
    read: false,
    createdAt: "2026-07-08 11:50",
    href: "/admin/exceptions/EXC-2026-0012",
    targetRoles: ["ADMIN", "APPROVER"],
  },
  {
    id: "noti-002",
    title: "긴급 정책 오류가 발생했습니다",
    message: "production 클러스터에서 require-resource-limits 정책 오류가 감지되었습니다.",
    type: "violation",
    severity: "critical",
    read: false,
    createdAt: "2026-07-08 10:30",
    href: "/admin/violations/vio-001",
    targetRoles: ["ADMIN", "APPROVER"],
  },
  {
    id: "noti-003",
    title: "클러스터 동기화가 진행 중입니다",
    message: "sandbox 클러스터의 Kyverno 정책 상태를 동기화하고 있습니다.",
    type: "cluster",
    severity: "info",
    read: true,
    createdAt: "2026-07-08 10:58",
    href: "/admin/clusters/sandbox",
    targetRoles: ["ADMIN"],
  },
  {
    id: "noti-004",
    title: "내 예외 신청이 승인되었습니다",
    message: "disallow-latest-tag 예외 신청이 승인되었습니다.",
    type: "exception",
    severity: "success",
    read: false,
    createdAt: "2026-07-08 11:18",
    href: "/exceptions",
    targetRoles: ["REQUESTER"],
    targetUserEmails: ["requester-auth-check-20260712035640@example.com"],
  },
  {
    id: "noti-005",
    title: "예외 만료일이 가까워졌습니다",
    message: "승인된 예외가 곧 만료됩니다. 필요한 경우 새 예외를 신청하세요.",
    type: "exception",
    severity: "warning",
    read: false,
    createdAt: "2026-07-08 09:30",
    href: "/exceptions",
    targetRoles: ["REQUESTER"],
  },
  {
    id: "noti-006",
    title: "정책 변경 이력이 기록되었습니다",
    message: "정책 동기화 요청이 감사 로그에 기록되었습니다.",
    type: "audit",
    severity: "info",
    read: true,
    createdAt: "2026-07-08 09:48",
    href: "/admin/audit-logs",
    targetRoles: ["ADMIN", "APPROVER"],
  },
];

export const notificationTypeLabel: Record<NotificationType, string> = {
  exception: "예외",
  violation: "정책 오류",
  cluster: "클러스터",
  audit: "감사",
  policy: "정책",
};

export const notificationSeverityLabel: Record<NotificationSeverity, string> = {
  info: "정보",
  warning: "주의",
  critical: "긴급",
  success: "완료",
};

export const notificationSeverityClassName: Record<NotificationSeverity, string> = {
  info: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  critical: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
};

export function isNotificationVisibleToUser(
  notification: AppNotification,
  user: { email: string; role: UserRole },
) {
  const roleMatched = notification.targetRoles?.includes(user.role) ?? false;
  const userMatched =
    notification.targetUserEmails?.includes(user.email) ?? false;

  return roleMatched || userMatched;
}
