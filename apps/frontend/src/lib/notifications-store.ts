"use client";

import { create } from "zustand";
import { type UserRole } from "@/lib/auth-api";
import {
  getNotificationsApi,
  markAllNotificationsAsReadApi,
  markNotificationAsReadApi,
} from "@/lib/notifications-api";
import {
  isNotificationVisibleToUser,
  type AppNotification,
} from "@/lib/notifications";

/**
 * 알림 전역 상태 인터페이스
 */
export type NotificationState = {
  notifications: AppNotification[];
  loading: boolean;
  error: string | null;

  fetchNotifications: (force?: boolean) => Promise<AppNotification[]>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  getUnreadCount: (user?: { email: string; role: UserRole } | null) => number;
};

let fetchNotificationsPromise: Promise<AppNotification[]> | null = null;

/**
 * 알림 상태 전역 스토어
 *
 * 헤더 알림 드롭다운과 알림 전체 페이지 간의 실시간 읽음 상태 및 뱃지 카운트 동기화를 담당합니다.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  loading: false,
  error: null,

  /**
   * 알림 목록을 API로부터 가져옵니다.
   *
   * @param force 캐시를 무시하고 강제로 새로고침할지 여부
   * @returns 알림 목록
   */
  async fetchNotifications(force = false) {
    const { notifications } = get();

    if (notifications.length > 0 && !force) {
      // 배경 재검증 (Stale-While-Revalidate)
      void (async () => {
        try {
          const fresh = await getNotificationsApi();
          if (Array.isArray(fresh)) {
            set({ notifications: fresh, error: null });
          }
        } catch {
          // 백그라운드 갱신 에러 무시
        }
      })();
      return notifications;
    }

    if (fetchNotificationsPromise) {
      return fetchNotificationsPromise;
    }

    set({ loading: notifications.length === 0 });

    fetchNotificationsPromise = (async () => {
      try {
        const fresh = await getNotificationsApi();
        if (Array.isArray(fresh)) {
          set({ notifications: fresh, error: null });
          return fresh;
        }
        return get().notifications;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "알림 목록을 불러오는데 실패했습니다.";
        set({ error: message });
        return get().notifications;
      } finally {
        set({ loading: false });
      }
    })().finally(() => {
      fetchNotificationsPromise = null;
    });

    return fetchNotificationsPromise;
  },

  /**
   * 특정 알림을 읽음 처리하고 전역 상태를 즉시 갱신합니다.
   *
   * @param id 알림 식별자
   */
  async markAsRead(id: string) {
    // 낙관적 업데이트: UI에 즉시 반영
    set((state) => ({
      notifications: state.notifications.map((item) =>
        item.id === id ? { ...item, read: true } : item,
      ),
    }));

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("notifications-read", { detail: { id } }),
      );
    }

    try {
      await markNotificationAsReadApi(id);
    } catch {
      // 백엔드 오류 시에도 사용자 경험을 위해 UI 상태 유지
    }
  },

  /**
   * 모든 알림을 읽음 처리하고 전역 상태를 즉시 갱신합니다.
   */
  async markAllAsRead() {
    // 낙관적 업데이트: UI에 즉시 반영하여 헤더 뱃지 즉각 소멸
    set((state) => ({
      notifications: state.notifications.map((item) => ({
        ...item,
        read: true,
      })),
    }));

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("notifications-read-all"));
    }

    try {
      await markAllNotificationsAsReadApi();
    } catch {
      // 백엔드 오류 시에도 사용자 경험을 위해 UI 상태 유지
    }
  },

  /**
   * 현재 사용자 기준으로 읽지 않은 알림 수를 계산합니다.
   *
   * @param user 현재 로그인된 사용자 정보
   * @returns 읽지 않은 알림 개수
   */
  getUnreadCount(user) {
    const { notifications } = get();
    const visible = user
      ? notifications.filter((item) => isNotificationVisibleToUser(item, user))
      : notifications;
    return visible.filter((item) => !item.read).length;
  },
}));
