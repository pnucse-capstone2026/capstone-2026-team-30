import { requestWithAuth } from "@/lib/api-client";
import { AppNotification } from "@/lib/notifications";

export type ListNotificationsQuery = {
  type?: string;
  severity?: string;
  read?: boolean;
  search?: string;
};

/**
 * 실시간 알림 목록을 API에서 조회합니다.
 */
export async function getNotificationsApi(
  query?: ListNotificationsQuery,
): Promise<AppNotification[]> {
  const searchParams = new URLSearchParams();

  if (query?.type && query.type !== "all") {
    searchParams.set("type", query.type);
  }
  if (query?.severity && query.severity !== "all") {
    searchParams.set("severity", query.severity);
  }
  if (query?.read !== undefined) {
    searchParams.set("read", String(query.read));
  }
  if (query?.search) {
    searchParams.set("search", query.search);
  }

  const queryString = searchParams.toString();
  const path = `/notifications${queryString ? `?${queryString}` : ""}`;

  return requestWithAuth<AppNotification[]>(path);
}

/**
 * 특정 알림을 읽음 상태로 업데이트합니다.
 */
export async function markNotificationAsReadApi(
  id: string,
): Promise<{ success: boolean }> {
  return requestWithAuth<{ success: boolean }>(`/notifications/${id}/read`, {
    method: "POST",
  });
}

/**
 * 전체 알림을 읽음 상태로 업데이트합니다.
 */
export async function markAllNotificationsAsReadApi(): Promise<{
  success: boolean;
}> {
  return requestWithAuth<{ success: boolean }>("/notifications/read-all", {
    method: "POST",
  });
}
