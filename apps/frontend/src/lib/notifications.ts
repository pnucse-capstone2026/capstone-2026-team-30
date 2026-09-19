import { type UserRole } from "@/lib/auth-api";

export type NotificationType =
  | "incident"
  | "exception"
  | "violation"
  | "cluster"
  | "audit"
  | "policy";
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

export const notifications: AppNotification[] = [];

export const notificationTypeLabel: Record<NotificationType, string> = {
  incident: "배포 차단",
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

export const notificationSeverityClassName: Record<
  NotificationSeverity,
  string
> = {
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
