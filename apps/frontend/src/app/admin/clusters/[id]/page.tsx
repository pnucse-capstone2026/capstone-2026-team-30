import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wifi,
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
  clusters,
  clusterEnvironmentLabel,
  clusterStatusClassName,
  clusterStatusLabel,
  kyvernoStatusClassName,
  kyvernoStatusLabel,
} from "@/lib/clusters";
import {
  kyvernoPolicies,
  policyModeLabel,
  policyStatusClassName,
  policyStatusLabel,
  policyTypeClassName,
  policyTypeLabel,
} from "@/lib/policies";
import {
  policyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
} from "@/lib/policy-violations";

type AdminClusterDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export function generateStaticParams() {
  return clusters.map((cluster) => ({
    id: cluster.id,
  }));
}

export default async function AdminClusterDetailPage({
  params,
}: AdminClusterDetailPageProps) {
  const { id } = await params;
  const cluster = clusters.find((item) => item.id === id);

  if (!cluster) {
    notFound();
  }

  const relatedPolicies = kyvernoPolicies.filter(
    (policy) => policy.clusterName === cluster.name,
  );
  const relatedViolations = policyViolations.filter(
    (violation) => violation.clusterName === cluster.name,
  );
  const relatedAuditLogs = auditLogs.filter(
    (log) =>
      log.entityId === cluster.name ||
      log.metadata.includes(`cluster=${cluster.name}`),
  );
  const unresolvedViolations = relatedViolations.filter(
    (violation) => violation.status !== "resolved",
  );

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/clusters"
      title="클러스터 상세"
      description={cluster.name}
      actions={
        <>
          <Button
            asChild
            variant="outline"
            className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
          >
            <Link href="/admin/clusters">
              <ArrowLeft className="size-4" />
              목록
            </Link>
          </Button>
          <Button
            variant="outline"
            className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
          >
            <RefreshCw className="size-4" />
            동기화
          </Button>
        </>
      }
    >
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className={clusterStatusClassName[cluster.status]}>
              {clusterStatusLabel[cluster.status]}
            </Badge>
            <Badge className={kyvernoStatusClassName[cluster.kyvernoStatus]}>
              Kyverno {kyvernoStatusLabel[cluster.kyvernoStatus]}
            </Badge>
            <Badge className="bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              {clusterEnvironmentLabel[cluster.environment]}
            </Badge>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {cluster.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            {cluster.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link href="/admin/policies">
              <ShieldCheck className="size-4" />
              정책 보기
            </Link>
          </Button>
          <Button asChild className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]">
            <Link href="/admin/violations">
              <ShieldAlert className="size-4" />
              오류 보기
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="노드"
          value={String(cluster.nodeCount)}
          detail={`Namespace ${cluster.namespaceCount}`}
          icon={Server}
          className="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="적용 정책"
          value={String(relatedPolicies.length)}
          detail={`목록 기준 ${cluster.policyCount}개`}
          icon={ShieldCheck}
          className="bg-emerald-50 text-emerald-600"
        />
        <SummaryCard
          label="미해결 오류"
          value={String(unresolvedViolations.length)}
          detail={`전체 ${relatedViolations.length}건`}
          icon={ShieldAlert}
          className="bg-amber-50 text-amber-600"
        />
        <SummaryCard
          label="최근 동기화"
          value={cluster.lastSyncedAt.split(" ")[1] ?? cluster.lastSyncedAt}
          detail={cluster.lastSyncedAt}
          icon={Clock3}
          className="bg-cyan-50 text-cyan-600"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Wifi className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">연결 정보</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Kubernetes/EKS API 연결 전 목업 기준 정보입니다.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["클러스터 이름", cluster.name],
                ["환경", clusterEnvironmentLabel[cluster.environment]],
                ["Provider", cluster.provider],
                ["Region", cluster.region],
                ["연결 상태", clusterStatusLabel[cluster.status]],
                ["Kyverno 상태", kyvernoStatusLabel[cluster.kyvernoStatus]],
                ["담당 팀", cluster.owner],
                ["최근 동기화", cluster.lastSyncedAt],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <dt className="text-[11px] font-medium text-slate-400">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium text-slate-800">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </article>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <SectionHeader
              title="적용 정책"
              description="이 클러스터에 연결된 정책입니다."
              href="/admin/policies"
            />
            <div className="divide-y divide-slate-100">
              {relatedPolicies.length > 0 ? (
                relatedPolicies.map((policy) => (
                  <Link
                    key={policy.id}
                    href={`/admin/policies/${policy.id}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                  >
                    <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 sm:flex">
                      <ShieldCheck className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-medium">
                          {policy.name}
                        </p>
                        <Badge className={policyTypeClassName[policy.type]}>
                          {policyTypeLabel[policy.type]}
                        </Badge>
                        <Badge className={policyStatusClassName[policy.status]}>
                          {policyStatusLabel[policy.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {policy.scope} · {policyModeLabel[policy.mode]} · 규칙 {policy.ruleCount}
                      </p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  연결된 정책이 없습니다.
                </div>
              )}
            </div>
          </article>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <SectionHeader
              title="정책 오류"
              description="이 클러스터에서 감지된 위반 이력입니다."
              href="/admin/violations"
            />
            <div className="divide-y divide-slate-100">
              {relatedViolations.length > 0 ? (
                relatedViolations.map((violation) => (
                  <Link
                    key={violation.id}
                    href={`/admin/violations/${violation.id}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                  >
                    <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 sm:flex">
                      <ShieldAlert className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-medium">
                          {violation.policyName}
                        </p>
                        <Badge className={severityClassName[violation.severity]}>
                          {severityLabel[violation.severity]}
                        </Badge>
                        <Badge className={statusClassName[violation.status]}>
                          {statusLabel[violation.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {violation.resourceKind} / {violation.resourceName} · {violation.detectedAt}
                      </p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  감지된 정책 오류가 없습니다.
                </div>
              )}
            </div>
          </article>
        </div>

        <aside className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold">운영 상태</h3>
            <div className="mt-5 space-y-3">
              <StatusRow
                label="클러스터"
                value={clusterStatusLabel[cluster.status]}
                className={clusterStatusClassName[cluster.status]}
              />
              <StatusRow
                label="Kyverno"
                value={kyvernoStatusLabel[cluster.kyvernoStatus]}
                className={kyvernoStatusClassName[cluster.kyvernoStatus]}
              />
              <StatusRow
                label="정책 오류"
                value={`${relatedViolations.length}건`}
                className={
                  relatedViolations.length > 0
                    ? "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
                    : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                }
              />
            </div>
          </article>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <SectionHeader
              title="최근 활동"
              description="클러스터 관련 감사 로그입니다."
              href="/admin/audit-logs"
            />
            <div className="divide-y divide-slate-100">
              {relatedAuditLogs.length > 0 ? (
                relatedAuditLogs.map((log) => (
                  <div key={log.id} className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <History className="size-4 text-slate-400" />
                      <p className="font-mono text-xs font-medium text-slate-900">
                        {log.action}
                      </p>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {log.summary}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge className={entityTypeClassName[log.entityType]}>
                        {entityTypeLabel[log.entityType]}
                      </Badge>
                      <span className="text-[11px] text-slate-400">
                        {log.createdAt}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-5 py-8 text-center text-sm text-slate-500">
                  관련 활동이 없습니다.
                </div>
              )}
            </div>
          </article>
        </aside>
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
  icon: typeof Server;
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
      <p className="mt-1 truncate text-3xl font-semibold tracking-tight">
        {value}
      </p>
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </article>
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
        <Button
          asChild
          variant="outline"
          size="sm"
          className="rounded-lg border-slate-200 bg-white"
        >
          <Link href={href}>전체 보기</Link>
        </Button>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      <Badge className={className}>{value}</Badge>
    </div>
  );
}
