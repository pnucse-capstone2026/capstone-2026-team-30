import { requestWithAuth } from "@/lib/api-client";

export type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType?: "USER" | "SYSTEM";
  actorEmail: string;
  actorRole: "ADMIN" | "APPROVER" | "REQUESTER" | "VIEWER" | "SYSTEM";
  createdAt: string;
  summary: string;
  metadata: string;
  rawMetadata?: Record<string, unknown> | null;
};

export type AuditLogListFilter = {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorType?: "USER" | "SYSTEM";
  userId?: string;
  from?: string;
  to?: string;
  search?: string;
};

export type PaginatedAuditLogs = {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/**
 * 백엔드에서 실시간 감사 로그 목록을 페이징/필터링하여 조회합니다.
 */
export async function getAuditLogs(
  filter: AuditLogListFilter = {},
): Promise<PaginatedAuditLogs> {
  const params = new URLSearchParams();
  if (filter.page) params.append("page", String(filter.page));
  if (filter.limit) params.append("limit", String(filter.limit));
  if (filter.action) params.append("action", filter.action);
  if (filter.entityType) params.append("entityType", filter.entityType);
  if (filter.entityId) params.append("entityId", filter.entityId);
  if (filter.actorType) params.append("actorType", filter.actorType);
  if (filter.userId) params.append("userId", filter.userId);
  if (filter.from) params.append("from", filter.from);
  if (filter.to) params.append("to", filter.to);
  if (filter.search) params.append("search", filter.search);

  const queryStr = params.toString();
  const path = `/audit-logs${queryStr ? `?${queryStr}` : ""}`;

  try {
    const data = await requestWithAuth<{
      items: Array<{
        id: string;
        action: string;
        entityType: string;
        entityId: string;
        actorType: "USER" | "SYSTEM";
        actorEmail: string | null;
        actorRole: string | null;
        beforeStatus: string | null;
        afterStatus: string | null;
        metadata: Record<string, unknown> | null;
        summary: string;
        createdAt: string;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(path);

    return {
      total: data.total,
      page: data.page,
      limit: data.limit,
      totalPages: data.totalPages,
      items: data.items.map((item) => ({
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        actorType: item.actorType,
        actorEmail:
          item.actorEmail ??
          (item.actorType === "SYSTEM" ? "시스템" : "알 수 없음"),
        actorRole: (item.actorRole as any) ?? "SYSTEM",
        createdAt: item.createdAt
          ? new Date(item.createdAt).toLocaleString("ko-KR")
          : "최근",
        summary: item.summary,
        metadata: item.metadata ? JSON.stringify(item.metadata) : "-",
        rawMetadata: item.metadata,
      })),
    };
  } catch {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };
  }
}

export const auditLogs: AuditLog[] = [];

export const entityTypeLabel: Record<AuditLog["entityType"], string> = {
  USER: "사용자",
  POLICY_EXCEPTION_REQUEST: "예외 신청",
  VIOLATION_HISTORY: "정책 오류",
  POLICY: "정책",
  CLUSTER: "클러스터",
};

export const entityTypeClassName: Record<AuditLog["entityType"], string> = {
  USER: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  POLICY_EXCEPTION_REQUEST:
    "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
  VIOLATION_HISTORY: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  POLICY: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  CLUSTER: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100",
};
