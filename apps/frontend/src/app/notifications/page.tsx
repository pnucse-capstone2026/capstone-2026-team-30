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
import { useNotificationStore } from "@/lib/notifications-store";
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
  "incident",
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

  const notificationsList = useNotificationStore(
    (state) => state.notifications,
  );
  const loading = useNotificationStore((state) => state.loading);
  const fetchNotifications = useNotificationStore(
    (state) => state.fetchNotifications,
  );
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");

  const loadNotifications = useCallback(async () => {
    try {
      await initializeAuth();
      await fetchNotifications(true);
    } catch {
      // Graceful fallback
    }
  }, [initializeAuth, fetchNotifications]);

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
    await markAllAsRead();
  }

  async function handleNotificationClick(id: string) {
    await markAsRead(id);
  }

  return (
    <DashboardPageShell
      variant={sidebarVariant}
      activeHref="/notifications"
      title="알림"
      description="내 역할과 계정에 해당하는 조치 알림을 확인합니다."
    >
      <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
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

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="border-b border-slate-100 px-5 py-3.5 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 text-[10px]">
                  {user ? "계정 맞춤 알림" : "알림 메인"}
                </Badge>
                <span className="text-xs text-slate-400 font-mono">
                  {user?.email ?? "실시간 필터링"}
                </span>
              </div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                알림 센터 ({visibleNotifications.length}건)
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="제목, 내용 검색"
                  className="h-8.5 w-48 rounded-xl border-slate-200 bg-slate-50 pr-3 pl-8 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8.5 rounded-xl border-slate-200 text-xs text-slate-700 gap-1 px-2.5"
                onClick={resetFilters}
              >
                <Filter className="size-3" />
                초기화
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8.5 rounded-xl border-slate-200 text-xs text-slate-700 gap-1 px-2.5"
                onClick={handleMarkAllAsRead}
                disabled={unreadCount === 0}
              >
                <CheckCircle2 className="size-3 text-emerald-600" />
                모두 읽음
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
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

        {/* 수직 스크롤 컨테이너: 상단 헤더와 필터는 고정되고 알림 목록만 독립 스크롤 */}
        <div className="max-h-[calc(100vh-350px)] min-h-[400px] overflow-y-auto divide-y divide-slate-100 pr-0.5">
          {loading ? (
            [1, 2, 3].map((key) => (
              <div key={key} className="flex gap-3 px-5 py-3.5 sm:px-6">
                <Skeleton className="mt-1 size-9 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-44 rounded" />
                  <Skeleton className="h-3.5 w-full rounded" />
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
                  className="flex gap-3 px-5 py-3 hover:bg-slate-50/70 sm:px-6 transition-colors"
                  onClick={() => handleNotificationClick(notification.id)}
                >
                  <div
                    className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${
                      read
                        ? "bg-slate-100 text-slate-400"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    <BellRing className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className={`text-xs font-semibold ${read ? "text-slate-700" : "text-slate-950"}`}>
                        {notification.title}
                      </p>
                      {!read ? (
                        <span className="size-1.5 rounded-full bg-blue-500" />
                      ) : null}
                      <Badge
                        className={`${notificationSeverityClassName[notification.severity]} text-[10px] px-1.5 py-0`}
                      >
                        {notificationSeverityLabel[notification.severity]}
                      </Badge>
                      <Badge className="bg-slate-100 text-slate-600 ring-1 ring-slate-200 text-[10px] px-1.5 py-0">
                        {notificationTypeLabel[notification.type]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">
                      {notification.message}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                      <Clock3 className="size-3" />
                      {notification.createdAt}
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="px-5 py-12 text-center text-xs text-slate-400">
              조건에 맞는 알림이 없습니다.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {visibleNotifications.length}개 알림 표시 중 (미읽음 {unreadCount}건)
          </span>
          <span>실시간 알림 및 조치 추적</span>
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
    <article className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-7 w-16 rounded" />
        ) : (
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        )}
        <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
      </div>
      <div
        className={`flex size-9 items-center justify-center rounded-xl ${className} shrink-0`}
      >
        <Icon className="size-4.5" />
      </div>
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
