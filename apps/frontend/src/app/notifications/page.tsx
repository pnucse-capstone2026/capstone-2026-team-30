"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { useAuthStore } from "@/lib/auth-store";
import {
  isNotificationVisibleToUser,
  notifications,
  notificationSeverityClassName,
  notificationSeverityLabel,
  notificationTypeLabel,
  type NotificationSeverity,
  type NotificationType,
} from "@/lib/notifications";

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
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [readIds, setReadIds] = useState<Set<string>>(() =>
    new Set(notifications.filter((notification) => notification.read).map((item) => item.id)),
  );

  const sidebarVariant =
    user?.role === "ADMIN" || user?.role === "APPROVER" ? "admin" : "user";
  const visibleNotifications = useMemo(() => {
    if (!user) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();

    return notifications
      .filter((notification) => isNotificationVisibleToUser(notification, user))
      .filter((notification) => {
        const read = readIds.has(notification.id);
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
            (readFilter === "read" && read) ||
            (readFilter === "unread" && !read))
        );
      });
  }, [query, readFilter, readIds, severityFilter, typeFilter, user]);
  const unreadCount = visibleNotifications.filter(
    (notification) => !readIds.has(notification.id),
  ).length;

  function resetFilters() {
    setQuery("");
    setTypeFilter("all");
    setSeverityFilter("all");
    setReadFilter("all");
  }

  function markAllAsRead() {
    setReadIds(
      new Set([
        ...Array.from(readIds),
        ...visibleNotifications.map((notification) => notification.id),
      ]),
    );
  }

  return (
    <DashboardPageShell
      variant={sidebarVariant}
      activeHref="/notifications"
      title="알림"
      description="내 역할과 계정에 해당하는 조치 알림을 확인합니다."
      actions={
        <Button
          type="button"
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
          onClick={markAllAsRead}
        >
          <CheckCircle2 className="size-4" />
          모두 읽음
        </Button>
      }
    >
      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="전체 알림"
          value={String(visibleNotifications.length)}
          detail="현재 계정 기준"
          icon={BellRing}
          className="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="읽지 않음"
          value={String(unreadCount)}
          detail="확인 필요"
          icon={ShieldAlert}
          className="bg-amber-50 text-amber-600"
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
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">알림 목록</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                역할 기반 알림과 개인 대상 알림을 현재 로그인 계정 기준으로 표시합니다.
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
          {visibleNotifications.length > 0 ? (
            visibleNotifications.map((notification) => {
              const read = readIds.has(notification.id);

              return (
                <Link
                  key={notification.id}
                  href={notification.href}
                  className="flex gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                  onClick={() =>
                    setReadIds((current) => new Set([...current, notification.id]))
                  }
                >
                  <div
                    className={`mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl ${
                      read ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-blue-600"
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
                      <Badge className={notificationSeverityClassName[notification.severity]}>
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
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BellRing;
  className: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div className={`flex size-10 items-center justify-center rounded-xl ${className}`}>
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
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
