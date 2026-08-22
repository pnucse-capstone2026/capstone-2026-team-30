import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BusinessException } from "../common/errors/business.exception";
import { PrismaService } from "../prisma/prisma.service";
import { AUDIT_LOG_ERROR } from "./audit-logs.errors";
import { AuditLogItemDto } from "./dto/audit-log-item.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs-query.dto";
import { PaginatedAuditLogsDto } from "./dto/paginated-audit-logs.dto";

type AuditLogWithUser = Prisma.AuditLogGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        email: true;
        role: true;
      };
    };
  };
}>;

/**
 * 플랫폼 감사 로그(AuditLog) 조회 및 페이징 서비스
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 필터 및 페이징 조건에 따라 시스템 감사 로그 목록을 조회합니다.
   *
   * @param query 감사 로그 조회 및 페이징 쿼리 DTO
   * @returns 페이징 처리된 감사 로그 목록
   * @throws {BusinessException} 시작일이 종료일보다 미래인 경우 (AUDIT_LOG_INVALID_DATE_RANGE)
   */
  async list(query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.action) {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.entityId) {
      where.entityId = query.entityId;
    }

    if (query.actorType) {
      where.actorType = query.actorType;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.from || query.to) {
      const fromDate = query.from ? new Date(query.from) : undefined;
      const toDate = query.to ? new Date(query.to) : undefined;

      if (fromDate && toDate && fromDate > toDate) {
        throw new BusinessException(AUDIT_LOG_ERROR.INVALID_DATE_RANGE);
      }

      where.createdAt = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    if (query.search) {
      const term = query.search;
      where.OR = [
        { action: { contains: term, mode: "insensitive" } },
        { entityId: { contains: term, mode: "insensitive" } },
        { user: { email: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    const items = logs.map((log) => this.mapToItemDto(log as AuditLogWithUser));
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * 특정 감사 로그 항목 단건을 조회합니다.
   *
   * @param id 감사 로그 식별자 (UUID)
   * @returns 감사 로그 항목 DTO
   * @throws {BusinessException} 존재하지 않을 경우 (AUDIT_LOG_NOT_FOUND)
   */
  async get(id: string): Promise<AuditLogItemDto> {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!log) {
      throw new BusinessException(AUDIT_LOG_ERROR.NOT_FOUND);
    }

    return this.mapToItemDto(log as AuditLogWithUser);
  }

  private mapToItemDto(log: AuditLogWithUser): AuditLogItemDto {
    const actorEmail =
      log.user?.email ?? (log.actorType === "SYSTEM" ? "SYSTEM" : null);
    const actorRole = log.user?.role ?? null;
    const summary = this.generateSummary(log, actorEmail);

    return {
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      actorType: log.actorType,
      actorEmail,
      actorRole,
      beforeStatus: log.beforeStatus,
      afterStatus: log.afterStatus,
      metadata: (log.metadata as Record<string, unknown>) ?? null,
      summary,
      createdAt: log.createdAt.toISOString(),
    };
  }

  private generateSummary(
    log: AuditLogWithUser,
    actorEmail: string | null,
  ): string {
    const actor = actorEmail ?? "익명 사용자";
    const entity = `${log.entityType} (${log.entityId})`;

    switch (log.action) {
      case "EXCEPTION_REQUEST_CREATED":
        return `${actor}님이 정책 예외를 신청했습니다. (${entity})`;
      case "EXCEPTION_REQUEST_APPROVED":
        return `${actor}님이 정책 예외를 승인했습니다. (${entity})`;
      case "EXCEPTION_REQUEST_REJECTED":
        return `${actor}님이 정책 예외를 반려했습니다. (${entity})`;
      case "EXCEPTION_REQUEST_CANCELLED":
        return `${actor}님이 정책 예외 신청을 취소했습니다. (${entity})`;
      case "EXCEPTION_REQUEST_EXPIRED":
        return `시스템에 의해 정책 예외가 만료되었습니다. (${entity})`;
      case "EXCEPTION_APPLY_SUCCESS":
        return `Kyverno 클러스터에 PolicyException CRD가 성공적으로 적용되었습니다. (${entity})`;
      case "USER_CLUSTERS_UPDATED":
        return `${actor}님이 사용자의 클러스터 접근 권한을 갱신했습니다.`;
      case "USER_ROLE_UPDATED":
        return `${actor}님이 사용자의 역할을 변경했습니다.`;
      case "USER_DISABLED":
        return `${actor}님이 사용자를 비활성화했습니다.`;
      case "USER_ENABLED":
        return `${actor}님이 사용자를 활성화했습니다.`;
      default:
        if (log.beforeStatus && log.afterStatus) {
          return `${actor}님이 상태를 ${log.beforeStatus}에서 ${log.afterStatus}(으)로 변경했습니다. (${log.action})`;
        }
        return `${actor}님이 ${log.action} 작업을 수행했습니다. (${entity})`;
    }
  }
}
