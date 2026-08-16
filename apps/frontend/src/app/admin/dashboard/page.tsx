import Link from "next/link";
import {
  AlertTriangle,
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
  type LucideIcon,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  auditLogs,
  entityTypeClassName,
  entityTypeLabel,
} from "@/lib/audit-logs";
import {
  exceptionRequests,
  exceptionRiskClassName,
  exceptionRiskLabel,
} from "@/lib/exception-requests";
import {
  policyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
} from "@/lib/policy-violations";

const clusterStatus = [
  { name: "production", status: "정상", violations: 2 },
  { name: "staging", status: "정상", violations: 1 },
  { name: "development", status: "정상", violations: 1 },
  { name: "sandbox", status: "동기화 중", violations: 0 },
];

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
  const pendingExceptions = exceptionRequests.filter(
    (request) => request.status === "pending",
  );
  const urgentViolations = policyViolations.filter(
    (violation) =>
      violation.status !== "resolved" &&
      (violation.severity === "critical" || violation.severity === "high"),
  );
  const unresolvedViolations = policyViolations.filter(
    (violation) => violation.status !== "resolved",
  );
  const recentAuditLogs = auditLogs.slice(0, 4);
  const healthyClusters = clusterStatus.filter(
    (cluster) => cluster.status === "정상",
  ).length;

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
      detail: `${urgentViolations.length}건 긴급 처리`,
      icon: ShieldAlert,
      className: "bg-rose-50 text-rose-600",
      href: "/admin/violations",
    },
    {
      label: "클러스터 상태",
      value: `${healthyClusters}/${clusterStatus.length}`,
      detail: "정상 클러스터",
      icon: Server,
      className: "bg-blue-50 text-blue-600",
      href: "/admin/clusters",
    },
    {
      label: "최근 감사 로그",
      value: String(auditLogs.length),
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
              관리자 홈
            </Badge>
            <span className="text-xs text-slate-400">
              목업 데이터를 조합한 운영 요약
            </span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            오늘 확인할 운영 항목
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            예외 검토, 정책 오류, 감사 로그, 클러스터 상태를 한 화면에서 확인하고 필요한 관리 화면으로 이동합니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          화면 데이터 준비 완료
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, value, detail, icon: Icon, className, href }) => (
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
            <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="우선 처리 정책 오류"
            description="긴급 또는 높은 심각도의 미해결 항목입니다."
            href="/admin/violations"
          />
          <div className="divide-y divide-slate-100">
            {urgentViolations.map((violation) => (
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
                    {violation.ruleName} · {violation.resourceKind} / {violation.resourceName}
                  </p>
                </div>
                <Badge className={statusClassName[violation.status]}>
                  {statusLabel[violation.status]}
                </Badge>
                <ChevronRight className="size-4 text-slate-300" />
              </Link>
            ))}
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <SectionHeader
            title="예외 검토 대기"
            description="관리자 판단이 필요한 신청입니다."
            href="/admin/exceptions"
          />
          <div className="divide-y divide-slate-100">
            {pendingExceptions.map((request) => (
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
                    <Badge className={exceptionRiskClassName[request.riskLevel]}>
                      {exceptionRiskLabel[request.riskLevel]}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-slate-400">
                    {request.requester} · 만료 {request.expiresAt}
                  </p>
                </div>
                <ChevronRight className="size-4 text-slate-300" />
              </Link>
            ))}
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
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
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
            {recentAuditLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-4 px-5 py-4 sm:px-6">
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
        {clusterStatus.map((cluster) => (
          <Link
            key={cluster.name}
            href={`/admin/clusters/${cluster.name}`}
            className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-200 hover:bg-blue-50/30"
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex size-9 items-center justify-center rounded-xl ${
                  cluster.status === "정상"
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-blue-50 text-blue-600"
                }`}
              >
                {cluster.status === "정상" ? (
                  <CheckCircle2 className="size-4.5" />
                ) : (
                  <Server className="size-4.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{cluster.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  정책 오류 {cluster.violations}건
                </p>
              </div>
            </div>
            <p
              className={`mt-4 text-xs font-medium ${
                cluster.status === "정상" ? "text-emerald-600" : "text-blue-600"
              }`}
            >
              {cluster.status}
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
