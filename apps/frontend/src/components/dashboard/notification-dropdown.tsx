"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Info,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/lib/auth-store";
import { useNotificationStore } from "@/lib/notifications-store";
import {
  isNotificationVisibleToUser,
  notificationSeverityClassName,
  type AppNotification,
  type NotificationSeverity,
} from "@/lib/notifications";

const severityIcons: Record<NotificationSeverity, React.ElementType> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

/**
 * 상단 글로벌 네비게이션 헤더의 알림 드롭다운 컴포넌트
 *
 * 전역 useNotificationStore와 연동되어 실시간 미읽음 뱃지 카운트 및 알림 목록을 표시합니다.
 */
export function NotificationDropdown() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const notificationList = useNotificationStore((state) => state.notifications);
  const fetchNotifications = useNotificationStore(
    (state) => state.fetchNotifications,
  );
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);

  useEffect(() => {
    if (user) {
      void fetchNotifications();
    }
  }, [user, fetchNotifications]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      void fetchNotifications(true);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, fetchNotifications]);

  const visibleNotifications = user
    ? notificationList.filter((item) => isNotificationVisibleToUser(item, user))
    : notificationList;

  const unreadCount = visibleNotifications.filter((item) => !item.read).length;

  const handleNotificationClick = (item: AppNotification) => {
    markAsRead(item.id);
    setIsOpen(false);
    router.push(item.href);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
        aria-label="알림 보기"
        aria-expanded={isOpen}
      >
        <Bell className="size-4.5" />
        {unreadCount > 0 ? (
          <span className="absolute top-2 right-2 size-2 rounded-full bg-rose-500 ring-2 ring-white" />
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                알림 센터
              </h3>
              {unreadCount > 0 ? (
                <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50">
                  {unreadCount}건 미읽음
                </Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                  모두 읽음
                </Badge>
              )}
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-blue-600"
              >
                <CheckCheck className="size-3.5" />
                모두 읽음
              </button>
            ) : null}
          </div>

          <div className="my-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {visibleNotifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                수신된 알림이 없습니다.
              </div>
            ) : (
              visibleNotifications.slice(0, 5).map((item) => {
                const IconComponent = severityIcons[item.severity] || Info;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className={`group flex cursor-pointer items-start gap-3 rounded-xl p-2.5 transition-colors ${
                      item.read
                        ? "bg-white hover:bg-slate-50 text-slate-600"
                        : "bg-slate-50/90 hover:bg-slate-100 text-slate-900 font-medium"
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${
                        notificationSeverityClassName[item.severity]
                      }`}
                    >
                      <IconComponent className="size-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {item.title}
                        </p>
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {item.createdAt.split(" ")[1] || item.createdAt}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                        {item.message}
                      </p>
                    </div>

                    {!item.read ? (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-600" />
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-100 pt-3">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center justify-center gap-1 rounded-xl bg-slate-50 py-2 text-center text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              전체 알림 목록 보기
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
