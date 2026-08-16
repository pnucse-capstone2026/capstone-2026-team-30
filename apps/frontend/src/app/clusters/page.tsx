"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Layers3,
  Search,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clusters,
  clusterEnvironmentLabel,
  clusterStatusClassName,
  clusterStatusLabel,
  kyvernoStatusClassName,
  kyvernoStatusLabel,
  type ClusterEnvironment,
  type ClusterStatus,
  type KyvernoStatus,
} from "@/lib/clusters";
import { kyvernoPolicies } from "@/lib/policies";
import { policyViolations } from "@/lib/policy-violations";

type EnvironmentFilter = "all" | ClusterEnvironment;
type ClusterStatusFilter = "all" | ClusterStatus;
type KyvernoStatusFilter = "all" | KyvernoStatus;

const environmentOptions: ClusterEnvironment[] = [
  "production",
  "staging",
  "development",
  "sandbox",
];
const clusterStatusOptions: ClusterStatus[] = ["healthy", "syncing", "warning"];
const kyvernoStatusOptions: KyvernoStatus[] = ["ready", "syncing", "degraded"];

export default function ClustersPage() {
  const [query, setQuery] = useState("");
  const [environmentFilter, setEnvironmentFilter] =
    useState<EnvironmentFilter>("all");
  const [clusterStatusFilter, setClusterStatusFilter] =
    useState<ClusterStatusFilter>("all");
  const [kyvernoStatusFilter, setKyvernoStatusFilter] =
    useState<KyvernoStatusFilter>("all");

  const clusterRows = useMemo(
    () =>
      clusters.map((cluster) => {
        const policies = kyvernoPolicies.filter(
          (policy) =>
            policy.clusterName === cluster.name && policy.status !== "draft",
        );
        const violations = policyViolations.filter(
          (violation) => violation.clusterName === cluster.name,
        );
        const unresolvedViolations = violations.filter(
          (violation) => violation.status !== "resolved",
        );

        return {
          ...cluster,
          policies,
          violations,
          unresolvedViolations,
        };
      }),
    [],
  );

  const filteredClusters = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return clusterRows.filter((cluster) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          cluster.name,
          cluster.region,
          cluster.owner,
          cluster.description,
          cluster.policies.map((policy) => policy.name).join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (environmentFilter === "all" ||
          cluster.environment === environmentFilter) &&
        (clusterStatusFilter === "all" ||
          cluster.status === clusterStatusFilter) &&
        (kyvernoStatusFilter === "all" ||
          cluster.kyvernoStatus === kyvernoStatusFilter)
      );
    });
  }, [
    clusterRows,
    clusterStatusFilter,
    environmentFilter,
    kyvernoStatusFilter,
    query,
  ]);

  const readyClusters = clusterRows.filter(
    (cluster) => cluster.status === "healthy" && cluster.kyvernoStatus === "ready",
  ).length;
  const syncingClusters = clusterRows.filter(
    (cluster) =>
      cluster.status === "syncing" || cluster.kyvernoStatus === "syncing",
  ).length;
  const totalUnresolvedViolations = clusterRows.reduce(
    (sum, cluster) => sum + cluster.unresolvedViolations.length,
    0,
  );

  function resetFilters() {
    setQuery("");
    setEnvironmentFilter("all");
    setClusterStatusFilter("all");
    setKyvernoStatusFilter("all");
  }

  return (
    <DashboardPageShell
      activeHref="/clusters"
      title="클러스터"
      description="내가 접근 가능한 클러스터와 정책 적용 상태를 확인합니다."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="접근 가능"
          value={String(clusterRows.length)}
          detail="조회 가능한 클러스터"
          icon={Server}
          className="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="정상 운영"
          value={String(readyClusters)}
          detail="Kyverno 준비 완료"
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
        />
        <SummaryCard
          label="동기화 중"
          value={String(syncingClusters)}
          detail="상태 갱신 진행"
          icon={Wifi}
          className="bg-cyan-50 text-cyan-600"
        />
        <SummaryCard
          label="미해결 위반"
          value={String(totalUnresolvedViolations)}
          detail="정책 확인 필요"
          icon={AlertTriangle}
          className="bg-amber-50 text-amber-600"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  사용자
                </Badge>
                <span className="text-xs text-slate-400">
                  운영 설정 변경 없이 클러스터 상태와 정책 조회 중심
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                클러스터 상태
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                배포 대상 클러스터의 상태, 적용 정책, 미해결 정책 위반을
                확인합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="클러스터, 정책, 담당 팀 검색"
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
              label="환경"
              value={environmentFilter}
              onChange={(value) =>
                setEnvironmentFilter(value as EnvironmentFilter)
              }
            >
              <option value="all">전체 환경</option>
              {environmentOptions.map((option) => (
                <option key={option} value={option}>
                  {clusterEnvironmentLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="클러스터 상태"
              value={clusterStatusFilter}
              onChange={(value) =>
                setClusterStatusFilter(value as ClusterStatusFilter)
              }
            >
              <option value="all">전체 상태</option>
              {clusterStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {clusterStatusLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Kyverno 상태"
              value={kyvernoStatusFilter}
              onChange={(value) =>
                setKyvernoStatusFilter(value as KyvernoStatusFilter)
              }
            >
              <option value="all">전체 상태</option>
              {kyvernoStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {kyvernoStatusLabel[option]}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-2 xl:grid-cols-3 sm:p-6">
          {filteredClusters.map((cluster) => (
            <article
              key={cluster.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                      {clusterEnvironmentLabel[cluster.environment]}
                    </Badge>
                    <Badge className={clusterStatusClassName[cluster.status]}>
                      {clusterStatusLabel[cluster.status]}
                    </Badge>
                    <Badge className={kyvernoStatusClassName[cluster.kyvernoStatus]}>
                      Kyverno {kyvernoStatusLabel[cluster.kyvernoStatus]}
                    </Badge>
                  </div>
                  <h3 className="mt-4 truncate text-base font-semibold text-slate-950">
                    {cluster.name}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                    {cluster.description}
                  </p>
                </div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <Server className="size-5" />
                </div>
              </div>

              <dl className="mt-5 grid gap-3 text-xs">
                <InfoRow label="리전" value={cluster.region} />
                <InfoRow label="노드/네임스페이스" value={`${cluster.nodeCount} / ${cluster.namespaceCount}`} />
                <InfoRow label="적용 정책" value={`${cluster.policies.length}개`} />
                <InfoRow
                  label="미해결 위반"
                  value={`${cluster.unresolvedViolations.length}건`}
                />
                <InfoRow label="최근 동기화" value={cluster.lastSyncedAt} />
              </dl>

              {cluster.policies.length > 0 ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-medium text-slate-500">
                    주요 적용 정책
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cluster.policies.slice(0, 3).map((policy) => (
                      <Badge
                        key={policy.id}
                        className="bg-white text-slate-700 ring-1 ring-slate-200"
                      >
                        {policy.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  className="h-9 rounded-xl border-slate-200 bg-white"
                >
                  <Link href="/policies">
                    <ShieldCheck className="size-4" />
                    정책 보기
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>

        {filteredClusters.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 클러스터가 없습니다.
          </div>
        ) : null}
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
        <Layers3 className="size-4 text-slate-300" />
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
  children: ReactNode;
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}
