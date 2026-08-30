"use client";

import Link from "next/link";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Filter,
  Search,
  ShieldAlert,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import {
  getNotificationsApi,
  markAllNotificationsAsReadApi,
  markNotificationAsReadApi,
} from "@/lib/notifications-api";
import {
  isNotificationVisibleToUser,
  notificationSeverityClassName,
  notificationSeverityLabel,
  notificationTypeLabel,
  type AppNotification,
  type NotificationSeverity,
  type NotificationType,
} from "@/lib/notifications";
import { useCallback, useEffect, useMemo, useState } from "react";

type TypeFilter = "all" | NotificationType;
type SeverityFilter = "all" | NotificationSeverity;
type ReadFilter = "all" | "unread" | "read";

const typeOptions: NotificationType[] = [
  "exception",
  "violation",
  "cluster",
  "audit",
  "policy",
];
const severityOptions: NotificationSeverity[] = [
  "critical",
  "warning",
  "info",
  "success",
];

export default function NotificationsPage() {
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [notificationsList, setNotificationsList] = useState<AppNotification[]>(
    [],
  );

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      await initializeAuth();
      const liveData = await getNotificationsApi();
      setNotificationsList(liveData);
    } catch {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  }, [initializeAuth]);

  useEffect(() => {
    void loadNotifications();
  }, [authStatus, loadNotifications]);

  const sidebarVariant =
    user?.role === "ADMIN" || user?.role === "APPROVER" ? "admin" : "user";

  const visibleNotifications = useMemo(() => {
    if (!user) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();

    return notificationsList
      .filter((notification) => isNotificationVisibleToUser(notification, user))
      .filter((notification) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [notification.title, notification.message, notification.type]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);

        return (
          matchesQuery &&
          (typeFilter === "all" || notification.type === typeFilter) &&
          (severityFilter === "all" ||
            notification.severity === severityFilter) &&
          (readFilter === "all" ||
            (readFilter === "read" && notification.read) ||
            (readFilter === "unread" && !notification.read))
        );
      });
  }, [notificationsList, query, readFilter, severityFilter, typeFilter, user]);

  const unreadCount = visibleNotifications.filter(
    (notification) => !notification.read,
  ).length;

  function resetFilters() {
    setQuery("");
    setTypeFilter("all");
    setSeverityFilter("all");
    setReadFilter("all");
  }

  async function handleMarkAllAsRead() {
    setNotificationsList((prev) =>
      prev.map((item) => ({ ...item, read: true })),
    );
    try {
      await markAllNotificationsAsReadApi();
    } catch {
      // Graceful fallback
    }
  }

  async function handleNotificationClick(id: string) {
    setNotificationsList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
    try {
      await markNotificationAsReadApi(id);
    } catch {
      // Graceful fallback
    }
  }

  return (
    <DashboardPageShell
      variant={sidebarVariant}
      activeHref="/notifications"
      title="알림"
      description="내 역할과 계정에 해당하는 조치 알림을 확인합니다."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="전체 알림"
          value={String(visibleNotifications.length)}
          detail="현재 계정 기준"
          icon={BellRing}
          className="bg-blue-50 text-blue-600"
          loading={loading}
        />
        <SummaryCard
          label="읽지 않음"
          value={String(unreadCount)}
          detail="확인 필요"
          icon={ShieldAlert}
          className="bg-amber-50 text-amber-600"
          loading={loading}
        />
        <SummaryCard
          label="긴급"
          value={String(
            visibleNotifications.filter(
              (notification) => notification.severity === "critical",
            ).length,
          )}
          detail="우선 조치"
          icon={ShieldAlert}
          className="bg-rose-50 text-rose-600"
          loading={loading}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  {user ? "계정 맞춤 알림" : "알림 메인"}
                </Badge>
                <span className="text-xs text-slate-400">
                  {user?.email ?? "계정 권한 기반 실시간 필터링"}
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                알림 목록
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                역할 기반 알림과 개인 대상 알림을 현재 로그인 계정 기준으로
                표시합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="제목, 내용, 유형 검색"
                  className="h-10 w-full rounded-xl border-slate-200 bg-slate-50 pr-3 pl-9 text-xs lg:w-72"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                onClick={resetFilters}
              >
                <Filter className="size-4" />
                필터 초기화
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                onClick={handleMarkAllAsRead}
              >
                <CheckCircle2 className="size-4" />
                모두 읽음
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <FilterSelect
              label="유형"
              value={typeFilter}
              onChange={(value) => setTypeFilter(value as TypeFilter)}
            >
              <option value="all">전체 유형</option>
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {notificationTypeLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="중요도"
              value={severityFilter}
              onChange={(value) => setSeverityFilter(value as SeverityFilter)}
            >
              <option value="all">전체 중요도</option>
              {severityOptions.map((option) => (
                <option key={option} value={option}>
                  {notificationSeverityLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="읽음 상태"
              value={readFilter}
              onChange={(value) => setReadFilter(value as ReadFilter)}
            >
              <option value="all">전체 상태</option>
              <option value="unread">읽지 않음</option>
              <option value="read">읽음</option>
            </FilterSelect>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? (
            [1, 2, 3].map((key) => (
              <div key={key} className="flex gap-4 px-5 py-4 sm:px-6">
                <Skeleton className="mt-1 size-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-48 rounded-lg" />
                  <Skeleton className="h-4 w-full rounded-lg" />
                </div>
              </div>
            ))
          ) : visibleNotifications.length > 0 ? (
            visibleNotifications.map((notification) => {
              const read = notification.read;

              return (
                <Link
                  key={notification.id}
                  href={notification.href}
                  className="flex gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                  onClick={() => handleNotificationClick(notification.id)}
                >
                  <div
                    className={`mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl ${
                      read
                        ? "bg-slate-100 text-slate-500"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    <BellRing className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">
                        {notification.title}
                      </p>
                      {!read ? (
                        <span className="size-2 rounded-full bg-blue-500" />
                      ) : null}
                      <Badge
                        className={
                          notificationSeverityClassName[notification.severity]
                        }
                      >
                        {notificationSeverityLabel[notification.severity]}
                      </Badge>
                      <Badge className="bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                        {notificationTypeLabel[notification.type]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {notification.message}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                      <Clock3 className="size-3.5" />
                      {notification.createdAt}
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              조건에 맞는 알림이 없습니다.
            </div>
          )}
        </div>
      </section>
    </DashboardPageShell>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  className,
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BellRing;
  className: string;
  loading?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div
          className={`flex size-10 items-center justify-center rounded-xl ${className}`}
        >
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-9 w-20 rounded-lg" />
      ) : (
        <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </article>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
      >
        {children}
      </select>
    </label>
  );
}
