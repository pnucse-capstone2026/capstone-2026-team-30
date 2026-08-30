"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileClock,
  History,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  auditLogs as mockAuditLogs,
  entityTypeClassName,
  entityTypeLabel,
  getAuditLogs,
  type AuditLog,
} from "@/lib/audit-logs";
import {
  listClusterCatalog,
  listClusters,
  type ClusterMetadata,
} from "@/lib/clusters";
import {
  exceptionRequests as mockExceptionRequests,
  exceptionRiskClassName,
  exceptionRiskLabel,
  type ExceptionRequest,
} from "@/lib/exception-requests";
import { listExceptionRequests } from "@/lib/exception-requests-api";
import {
  getViolations,
  policyViolations as mockPolicyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
  type PolicyViolation,
} from "@/lib/policy-violations";

const quickActions = [
  {
    label: "예외 관리",
    description: "승인 대기 요청 검토",
    href: "/admin/exceptions",
    icon: FileClock,
  },
  {
    label: "정책 오류 관리",
    description: "위반 이력과 조치 상태 확인",
    href: "/admin/violations",
    icon: ShieldAlert,
  },
  {
    label: "사용자 관리",
    description: "계정과 역할 관리",
    href: "/admin/users",
    icon: Users,
  },
  {
    label: "감사 로그",
    description: "관리 작업 추적",
    href: "/admin/audit-logs",
    icon: History,
  },
  {
    label: "정책 목록",
    description: "정책 운영 상태 확인",
    href: "/admin/policies",
    icon: ShieldCheck,
  },
  {
    label: "클러스터 관리",
    description: "연결 상태와 동기화 확인",
    href: "/admin/clusters",
    icon: Server,
  },
];

export default function AdminDashboardPage() {
  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  const liveClusters = useDataStore((state) => state.clusters);
  const liveViolations = useDataStore((state) => state.violations);
  const liveExceptions = useDataStore((state) => state.exceptions);
  const liveAuditLogs = useDataStore((state) => state.auditLogs);

  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const fetchViolations = useDataStore((state) => state.fetchViolations);
  const fetchExceptions = useDataStore((state) => state.fetchExceptions);
  const fetchAuditLogs = useDataStore((state) => state.fetchAuditLogs);

  const loadDashboardData = useCallback(async () => {
    try {
      await initializeAuth();
      await Promise.allSettled([
        fetchClusters(),
        fetchViolations(),
        fetchExceptions(),
        fetchAuditLogs(),
      ]);
    } catch {
      // Graceful fallback
    }
  }, [
    fetchAuditLogs,
    fetchClusters,
    fetchExceptions,
    fetchViolations,
    initializeAuth,
  ]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const isLoading =
    liveClusters === null &&
    liveViolations === null &&
    liveExceptions === null &&
    liveAuditLogs === null;

  const violations = liveViolations ?? mockPolicyViolations;
  const exceptions = liveExceptions ?? mockExceptionRequests;
  const auditLogsList = liveAuditLogs ?? mockAuditLogs;
  const clusterList = liveClusters ?? [
    { id: "kyverno-eks-hub", displayName: "Primary Hub Cluster (us-east-1)" },
    {
      id: "kyverno-eks-spoke-01",
      displayName: "Remote Spoke Cluster 01 (us-east-1)",
    },
  ];

  const pendingExceptions = exceptions.filter(
    (request) => request.status === "pending",
  );
  const urgentViolations = violations.filter(
    (violation) =>
      violation.status !== "resolved" &&
      (violation.severity === "critical" ||
        violation.severity === "high" ||
        violation.severity === "medium"),
  );
  const unresolvedViolations = violations.filter(
    (violation) => violation.status !== "resolved",
  );
  const recentAuditLogs = auditLogsList.slice(0, 4);

  const summaryCards = [
    {
      label: "검토 대기 예외",
      value: String(pendingExceptions.length),
      detail: "승인 또는 거절 필요",
      icon: FileClock,
      className: "bg-amber-50 text-amber-600",
      href: "/admin/exceptions",
    },
    {
      label: "미해결 정책 오류",
      value: String(unresolvedViolations.length),
      detail: `${urgentViolations.length}건 처리 필요`,
      icon: ShieldAlert,
      className: "bg-rose-50 text-rose-600",
      href: "/admin/violations",
    },
    {
      label: "클러스터 상태",
      value: `${clusterList.length}/${clusterList.length}`,
      detail: "연결된 클러스터",
      icon: Server,
      className: "bg-blue-50 text-blue-600",
      href: "/admin/clusters",
    },
    {
      label: "최근 감사 로그",
      value: String(auditLogsList.length),
      detail: "관리 작업 이력",
      icon: History,
      className: "bg-emerald-50 text-emerald-600",
      href: "/admin/audit-logs",
    },
  ];

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/dashboard"
      title="관리자 대시보드"
      description="주요 운영 상태와 관리 화면 진입점을 확인합니다."
      actions={
        <Button
          asChild
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
        >
          <Link href="/admin/audit-logs">
            <History className="size-4" />
            최근 작업
          </Link>
        </Button>
      }
    >
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            오늘 확인할 운영 항목
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            예외 검토, 정책 오류, 감사 로그, 클러스터 상태를 한 화면에서
            확인하고 필요한 관리 화면으로 이동합니다.
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(
          ({ label, value, detail, icon: Icon, className, href }) => (
            <Link
              key={label}
              href={href}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-blue-200 hover:bg-blue-50/30"
            >
              <div className="flex items-start justify-between">
                <div
                  className={`flex size-10 items-center justify-center rounded-xl ${className}`}
                >
                  <Icon className="size-5" />
                </div>
                <ChevronRight className="size-4 text-slate-300" />
              </div>
              <p className="mt-5 text-[13px] text-slate-500">{label}</p>
              {isLoading ? (
                <Skeleton className="mt-1 h-9 w-20 rounded-lg" />
              ) : (
                <p className="mt-1 text-3xl font-semibold tracking-tight">
                  {value}
                </p>
              )}
              <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
            </Link>
          ),
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="우선 처리 정책 오류"
            description="미해결 또는 조치 필요 항목입니다."
            href="/admin/violations"
          />
          <div className="divide-y divide-slate-100">
            {isLoading ? (
              [1, 2, 3].map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-4 px-5 py-4 sm:px-6"
                >
                  <Skeleton className="size-9 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-40 rounded-lg" />
                    <Skeleton className="h-3 w-56 rounded-lg" />
                  </div>
                </div>
              ))
            ) : urgentViolations.length > 0 ? (
              urgentViolations.slice(0, 4).map((violation) => (
                <Link
                  key={violation.id}
                  href={`/admin/violations/${violation.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                >
                  <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 sm:flex">
                    <ShieldAlert className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-medium">
                        {violation.policyName}
                      </p>
                      <Badge className={severityClassName[violation.severity]}>
                        {severityLabel[violation.severity]}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {violation.ruleName} · {violation.resourceKind} /{" "}
                      {violation.resourceName}
                    </p>
                  </div>
                  <Badge className={statusClassName[violation.status]}>
                    {statusLabel[violation.status]}
                  </Badge>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-xs text-slate-400">
                미해결 정책 오류가 없습니다.
              </div>
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="예외 검토 대기"
            description="관리자 판단이 필요한 신청입니다."
            href="/admin/exceptions"
          />
          <div className="divide-y divide-slate-100">
            {isLoading ? (
              [1, 2, 3].map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-4 px-5 py-4 sm:px-6"
                >
                  <Skeleton className="size-9 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-40 rounded-lg" />
                    <Skeleton className="h-3 w-48 rounded-lg" />
                  </div>
                </div>
              ))
            ) : pendingExceptions.length > 0 ? (
              pendingExceptions.slice(0, 4).map((request) => (
                <Link
                  key={request.id}
                  href={`/admin/exceptions/${request.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <FileClock className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-medium">
                        {request.policyName}
                      </p>
                      <Badge
                        className={exceptionRiskClassName[request.riskLevel]}
                      >
                        {exceptionRiskLabel[request.riskLevel]}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {request.requester} · 만료 {request.expiresAt}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-xs text-slate-400">
                승인 대기 중인 예외 신청이 없습니다.
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <article className="rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="빠른 관리"
            description="자주 쓰는 관리 화면으로 이동합니다."
          />
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
            {quickActions.map(({ label, description, href, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/40"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {label}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="최근 감사 로그"
            description="최근 관리자 작업과 시스템 기록입니다."
            href="/admin/audit-logs"
          />
          <div className="divide-y divide-slate-100">
            {isLoading
              ? [1, 2, 3].map((key) => (
                  <div
                    key={key}
                    className="flex items-start gap-4 px-5 py-4 sm:px-6"
                  >
                    <Skeleton className="size-9 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-32 rounded-lg" />
                      <Skeleton className="h-3 w-56 rounded-lg" />
                    </div>
                  </div>
                ))
              : recentAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-4 px-5 py-4 sm:px-6"
                  >
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <History className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs font-medium text-slate-900">
                          {log.action}
                        </p>
                        <Badge className={entityTypeClassName[log.entityType]}>
                          {entityTypeLabel[log.entityType]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {log.summary}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {log.actorEmail} · {log.createdAt}
                      </p>
                    </div>
                  </div>
                ))}
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        {isLoading
          ? [1, 2, 3, 4].map((key) => (
              <div
                key={key}
                className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"
              >
                <Skeleton className="h-5 w-32 rounded-lg" />
                <Skeleton className="h-4 w-24 rounded-lg" />
              </div>
            ))
          : clusterList.map((cluster) => (
              <Link
                key={cluster.id}
                href={`/admin/clusters`}
                className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-200 hover:bg-blue-50/30"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {cluster.displayName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      연결됨 ({cluster.id})
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs font-medium text-emerald-600">
                  정상 연결
                </p>
              </Link>
            ))}
      </section>
    </DashboardPageShell>
  );
}

function SectionHeader({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      </div>
      {href ? (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
        >
          전체 보기
          <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
