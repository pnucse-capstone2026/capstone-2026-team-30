import { Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";
import {
  NotificationItemDto,
  NotificationSeverity,
  NotificationType,
} from "./dto/notification-item.dto";

/**
 * 알림 서비스
 *
 * 플랫폼 내 실시간 엔티티(예외 신청, 정책 위반, 감사 로그)와 DB 저장된 알림을 조합하여
 * 로그인 사용자의 역할(Role) 및 계정(Email) 기반 맞춤 실시간 알림을 제공합니다.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 로그인 사용자의 역할과 계정에 맞춘 알림 목록을 조회합니다.
   *
   * @param user 인증된 요청 사용자 컨텍스트
   * @param query 검색 및 필터 파라미터 DTO
   * @returns 알림 목록
   */
  async getNotifications(
    user: AuthenticatedUser,
    query?: ListNotificationsQueryDto,
  ): Promise<NotificationItemDto[]> {
    // 1. 사용자 개별 읽음 기록 조회
    const readRecords = await this.prisma.notificationRead.findMany({
      where: { userId: user.id },
      select: { notificationId: true },
    });
    const readSet = new Set(readRecords.map((r) => r.notificationId));

    const notifications: NotificationItemDto[] = [];

    // 2. DB 저장 알림 조회 (Prisma Notification 엔티티)
    const dbNotifications = await this.prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    for (const item of dbNotifications) {
      notifications.push({
        id: item.id,
        title: item.title,
        message: item.message,
        type: item.type as NotificationType,
        severity: item.severity as NotificationSeverity,
        read: readSet.has(item.id),
        createdAt: this.formatDate(item.createdAt),
        href: item.href,
        targetRoles: item.targetRoles,
        targetUserEmails: item.targetUserEmails,
      });
    }

    // 3. 실시간 승인 대기 예외 신청 (ADMIN, APPROVER 대상)
    if (user.role === Role.ADMIN || user.role === Role.APPROVER) {
      const pendingRequests = await this.prisma.policyExceptionRequest.findMany(
        {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      );

      for (const req of pendingRequests) {
        const id = `noti-exc-${req.id}`;
        notifications.push({
          id,
          title: "승인 대기 예외가 있습니다",
          message: `${req.policyName} 예외 신청 (${req.k8sExceptionName}) 검토가 필요합니다.`,
          type: "exception",
          severity: "warning",
          read: readSet.has(id),
          createdAt: this.formatDate(req.createdAt),
          href: `/admin/exceptions/${req.id}`,
          targetRoles: [Role.ADMIN, Role.APPROVER],
        });
      }
    }

    // 4. 내 예외 신청 상태 변경 알림 (REQUESTER 대상)
    const myRequests = await this.prisma.policyExceptionRequest.findMany({
      where: {
        requestUserId: user.id,
        status: { in: ["APPROVED", "REJECTED", "EXPIRED", "EXPIRING"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    for (const req of myRequests) {
      const id = `noti-my-exc-${req.id}-${req.status.toLowerCase()}`;
      let title = "예외 신청 상태 알림";
      let severity: NotificationSeverity = "info";

      if (req.status === "APPROVED") {
        title = "내 예외 신청이 승인되었습니다";
        severity = "success";
      } else if (req.status === "REJECTED") {
        title = "내 예외 신청이 반려되었습니다";
        severity = "critical";
      } else if (req.status === "EXPIRING" || req.status === "EXPIRED") {
        title = "예외 만료일이 가까워졌습니다";
        severity = "warning";
      }

      notifications.push({
        id,
        title,
        message: `${req.policyName} 예외 신청이 ${this.getStatusLabel(
          req.status,
        )} 처리되었습니다.`,
        type: "exception",
        severity,
        read: readSet.has(id),
        createdAt: this.formatDate(req.updatedAt),
        href: "/exceptions",
        targetRoles: [Role.REQUESTER],
        targetUserEmails: [user.email],
      });
    }

    // 5. 최근 정책 위반 이력 (Violations)
    const recentViolations = await this.prisma.violationHistory.findMany({
      orderBy: { occurredAt: "desc" },
      take: 10,
    });

    for (const vio of recentViolations) {
      const id = `noti-vio-${vio.id}`;
      const rawSev = (vio.severity ?? "medium").toLowerCase();
      let notiSeverity: NotificationSeverity = "warning";
      let title = "정책 오류가 감지되었습니다";

      if (rawSev === "critical") {
        notiSeverity = "critical";
        title = "긴급 정책 오류가 발생했습니다";
      } else if (rawSev === "high") {
        notiSeverity = "warning";
        title = "높은 위험도의 정책 오류가 감지되었습니다";
      } else if (rawSev === "medium") {
        notiSeverity = "warning";
        title = "정책 오류가 감지되었습니다";
      } else {
        notiSeverity = "info";
        title = "경미한 정책 오류가 감지되었습니다";
      }

      notifications.push({
        id,
        title,
        message: `${vio.targetClusterDisplayName} 클러스터에서 ${vio.policyName} (${vio.ruleName}) 정책 오류가 감지되었습니다.`,
        type: "violation",
        severity: notiSeverity,
        read: readSet.has(id),
        createdAt: this.formatDate(vio.occurredAt),
        href: `/admin/violations/${vio.id}`,
        targetRoles: [Role.ADMIN, Role.APPROVER],
      });
    }

    // 6. 최근 감사 로그 (AuditLogs)
    const recentAuditLogs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    for (const log of recentAuditLogs) {
      const id = `noti-audit-${log.id}`;
      notifications.push({
        id,
        title: "정책 변경 이력이 기록되었습니다",
        message: `${log.action} 작업이 기록되었습니다. (대상: ${log.entityType})`,
        type: "audit",
        severity: "info",
        read: readSet.has(id),
        createdAt: this.formatDate(log.createdAt),
        href: "/admin/audit-logs",
        targetRoles: [Role.ADMIN, Role.APPROVER],
      });
    }

    // 7. 사용자 대상 및 역할 필터링
    let filtered = notifications.filter((item) =>
      this.isNotificationVisibleToUser(item, user),
    );

    // 8. 쿼리 파라미터 조건 적용 (type, severity, read, search)
    if (query?.type && query.type !== "all") {
      filtered = filtered.filter((item) => item.type === query.type);
    }

    if (query?.severity && query.severity !== "all") {
      filtered = filtered.filter((item) => item.severity === query.severity);
    }

    if (query?.read !== undefined) {
      filtered = filtered.filter((item) => item.read === query.read);
    }

    if (query?.search) {
      const term = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(term) ||
          item.message.toLowerCase().includes(term) ||
          item.type.toLowerCase().includes(term),
      );
    }

    // 최신 순 정렬 후 반환
    return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * 특정 알림을 읽음 처리합니다.
   *
   * @param id 알림 식별자
   * @param user 인증된 요청 사용자 컨텍스트
   */
  async markAsRead(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    await this.prisma.notificationRead.upsert({
      where: {
        userId_notificationId: {
          userId: user.id,
          notificationId: id,
        },
      },
      update: { readAt: new Date() },
      create: {
        userId: user.id,
        notificationId: id,
      },
    });

    return { success: true };
  }

  /**
   * 가용 가능한 모든 알림을 읽음 처리합니다.
   *
   * @param user 인증된 요청 사용자 컨텍스트
   */
  async markAllAsRead(user: AuthenticatedUser): Promise<{ success: boolean }> {
    const notifications = await this.getNotifications(user);

    for (const item of notifications) {
      await this.markAsRead(item.id, user);
    }

    return { success: true };
  }

  private isNotificationVisibleToUser(
    item: NotificationItemDto,
    user: AuthenticatedUser,
  ): boolean {
    if (!item.targetRoles && !item.targetUserEmails) {
      return true;
    }

    const roleMatched = item.targetRoles?.includes(user.role) ?? false;
    const emailMatched = item.targetUserEmails?.includes(user.email) ?? false;

    return roleMatched || emailMatched;
  }

  private formatDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());

    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  private getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      PENDING: "검토 대기중",
      APPROVED: "승인",
      REJECTED: "반려",
      EXPIRING: "만료 임박",
      EXPIRED: "만료됨",
      CANCELLED: "취소됨",
    };
    return map[status] ?? status;
  }
}
