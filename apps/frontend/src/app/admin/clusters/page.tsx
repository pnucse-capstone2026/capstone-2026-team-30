"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  clusters,
  clusterEnvironmentLabel,
  clusterStatusClassName,
  clusterStatusLabel,
  kyvernoStatusClassName,
  kyvernoStatusLabel,
  listClusterCatalog,
  listClusters,
  type ClusterEnvironment,
  type ClusterMetadata,
  type ClusterStatus,
  type KyvernoStatus,
  type ManagedCluster,
} from "@/lib/clusters";
import {
  getPolicies,
  kyvernoPolicies,
  type KyvernoPolicy,
} from "@/lib/policies";
import {
  getViolations,
  policyViolations,
  type PolicyViolation,
} from "@/lib/policy-violations";

type EnvironmentFilter = "all" | ClusterEnvironment;
type StatusFilter = "all" | ClusterStatus;
type KyvernoFilter = "all" | KyvernoStatus;

const environmentOptions: ClusterEnvironment[] = [
  "production",
  "staging",
  "development",
  "sandbox",
];
const statusOptions: ClusterStatus[] = ["healthy", "syncing", "warning"];
const kyvernoOptions: KyvernoStatus[] = ["ready", "syncing", "degraded"];

/**
 * 관리자용 클러스터 관리 목록 페이지 컴포넌트입니다.
 * 등록된 전체 클러스터의 연결 상태, Kyverno 엔진 상태, 바인딩된 정책 및 위반 현황을 종합 제공합니다.
 */
export default function AdminClustersPage() {
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kyvernoStatus, setKyvernoStatus] = useState<KyvernoFilter>("all");

  const liveClusters = useDataStore((state) => state.clusters);
  const livePolicies = useDataStore((state) => state.policies);
  const liveViolations = useDataStore((state) => state.violations);
  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const fetchPolicies = useDataStore((state) => state.fetchPolicies);
  const fetchViolations = useDataStore((state) => state.fetchViolations);
  const clustersLoading = useDataStore((state) => state.clustersLoading);

  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  /**
   * 클러스터 관리 대시보드에 필요한 데이터들을 백엔드 API로부터 병렬 로드합니다.
   */
  const loadDashboardData = useCallback(async () => {
    try {
      await initializeAuth();
      await Promise.allSettled([
        fetchClusters(),
        fetchPolicies(),
        fetchViolations(),
      ]);
    } catch {
      // 라이브 API 연동 실패 시 기본 상태 유지
    }
  }, [fetchClusters, fetchPolicies, fetchViolations, initializeAuth]);

  useEffect(() => {
    void loadDashboardData();
  }, [authStatus, loadDashboardData]);

  const policyList = livePolicies ?? kyvernoPolicies;
  const violationList = liveViolations ?? policyViolations;

  const activeClusters: ManagedCluster[] = useMemo(() => {
    const baseList =
      liveClusters && liveClusters.length > 0
        ? liveClusters.map((item) => {
            const existing = clusters.find(
              (c) =>
                c.id === item.id ||
                c.name === item.id ||
                c.name === item.displayName,
            );
            if (existing) {
              return {
                ...existing,
                id: item.id,
                name: item.displayName || existing.name,
              };
            }
            return {
              id: item.id,
              name: item.displayName || item.id,
              environment: (item.id.includes("stage")
                ? "staging"
                : item.id.includes("dev")
                  ? "development"
                  : item.id.includes("sand")
                    ? "sandbox"
                    : "production") as ClusterEnvironment,
              region: "us-east-1",
              provider: "EKS" as const,
              status: "healthy" as const,
              kyvernoStatus: "ready" as const,
              nodeCount: 3,
              namespaceCount: 8,
              policyCount: 0,
              violationCount: 0,
              lastSyncedAt: new Date()
                .toISOString()
                .slice(0, 16)
                .replace("T", " "),
              owner: "플랫폼팀",
              description: `${item.displayName || item.id} 클러스터입니다.`,
            };
          })
        : liveClusters && liveClusters.length === 0
          ? []
          : clusters;

    return baseList.map((cluster) => {
      const relPolicies = policyList.filter(
        (p) =>
          p.clusterId === cluster.id ||
          p.clusterName === cluster.name ||
          p.clusterDisplayName === cluster.name ||
          p.clusterDisplayName === cluster.id,
      );
      const relViolations = violationList.filter(
        (v) =>
          v.clusterId === cluster.id ||
          v.clusterName === cluster.name ||
          v.clusterDisplayName === cluster.name ||
          v.clusterDisplayName === cluster.id,
      );
      return {
        ...cluster,
        policyCount: relPolicies.length,
        violationCount: relViolations.length,
      };
    });
  }, [liveClusters, policyList, violationList]);

  const filteredClusters = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return activeClusters.filter((cluster) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          cluster.name,
          cluster.environment,
          cluster.region,
          cluster.owner,
          cluster.description,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (environment === "all" || cluster.environment === environment) &&
        (status === "all" || cluster.status === status) &&
        (kyvernoStatus === "all" || cluster.kyvernoStatus === kyvernoStatus)
      );
    });
  }, [activeClusters, environment, kyvernoStatus, query, status]);

  const healthyClusters = activeClusters.filter(
    (cluster) => cluster.status === "healthy",
  ).length;
  const totalPolicies = activeClusters.reduce(
    (sum, cluster) => sum + cluster.policyCount,
    0,
  );
  const totalViolations = activeClusters.reduce(
    (sum, cluster) => sum + cluster.violationCount,
    0,
  );

  function resetFilters() {
    setQuery("");
    setEnvironment("all");
    setStatus("all");
    setKyvernoStatus("all");
  }

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/clusters"
      title="클러스터 관리"
      description="등록된 클러스터의 연결 상태와 정책 동기화 상태를 관리합니다."
      actions={
        <Button
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
          onClick={() => void loadDashboardData()}
          disabled={clustersLoading}
        >
          <RefreshCw
            className={`size-4 ${clustersLoading ? "animate-spin" : ""}`}
          />
          새로고침
        </Button>
      }
    >
      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="등록 클러스터"
          value={String(activeClusters.length)}
          detail="EKS 기반 환경"
          icon={Server}
          className="bg-blue-50 text-blue-600"
          loading={liveClusters === null}
        />
        <SummaryCard
          label="정상 상태"
          value={`${healthyClusters}/${activeClusters.length}`}
          detail="연결 정상"
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
          loading={liveClusters === null}
        />
        <SummaryCard
          label="적용 정책"
          value={String(totalPolicies)}
          detail="클러스터별 정책 합계"
          icon={ShieldCheck}
          className="bg-cyan-50 text-cyan-600"
          loading={liveClusters === null}
        />
        <SummaryCard
          label="정책 오류"
          value={String(totalViolations)}
          detail="미해결 포함"
          icon={ShieldAlert}
          className="bg-amber-50 text-amber-600"
          loading={liveClusters === null}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                클러스터 연결 현황
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                환경, 연결 상태, Kyverno 상태를 기준으로 정책 적용 대상
                클러스터를 확인합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="클러스터, 담당자, 리전 검색"
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
              value={environment}
              onChange={(value) => setEnvironment(value as EnvironmentFilter)}
            >
              <option value="all">전체 환경</option>
              {environmentOptions.map((option) => (
                <option key={option} value={option}>
                  {clusterEnvironmentLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="연결 상태"
              value={status}
              onChange={(value) => setStatus(value as StatusFilter)}
            >
              <option value="all">전체 상태</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {clusterStatusLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Kyverno"
              value={kyvernoStatus}
              onChange={(value) => setKyvernoStatus(value as KyvernoFilter)}
            >
              <option value="all">전체 Kyverno 상태</option>
              {kyvernoOptions.map((option) => (
                <option key={option} value={option}>
                  {kyvernoStatusLabel[option]}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className="w-[280px] px-5 text-xs text-slate-500 sm:px-6">
                클러스터
              </TableHead>
              <TableHead className="text-xs text-slate-500">환경</TableHead>
              <TableHead className="text-xs text-slate-500">
                연결 상태
              </TableHead>
              <TableHead className="text-xs text-slate-500">Kyverno</TableHead>
              <TableHead className="text-xs text-slate-500">리소스</TableHead>
              <TableHead className="text-xs text-slate-500">
                정책/오류
              </TableHead>
              <TableHead className="text-xs text-slate-500">
                최근 동기화
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {liveClusters === null
              ? [1, 2].map((key) => (
                  <TableRow key={key}>
                    <TableCell className="px-5 py-4 sm:px-6">
                      <Skeleton className="h-5 w-48 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-24 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-16 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-16 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-20 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-16 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-28 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4 pr-5 sm:pr-6" />
                  </TableRow>
                ))
              : filteredClusters.map((cluster) => (
                  <TableRow key={cluster.id} className="hover:bg-slate-50/70">
                    <TableCell className="px-5 py-4 sm:px-6">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                          <Server className="size-4.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-slate-950">
                            {cluster.name}
                          </p>
                          <p className="mt-1 line-clamp-1 text-[11px] text-slate-400">
                            {cluster.description}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <div>
                        <p className="text-xs font-medium text-slate-800">
                          {clusterEnvironmentLabel[cluster.environment]}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {cluster.provider} · {cluster.region}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <Badge className={clusterStatusClassName[cluster.status]}>
                        {clusterStatusLabel[cluster.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-4">
                      <Badge
                        className={
                          kyvernoStatusClassName[cluster.kyvernoStatus]
                        }
                      >
                        {kyvernoStatusLabel[cluster.kyvernoStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-xs font-medium text-slate-800">
                        노드 {cluster.nodeCount}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Namespace {cluster.namespaceCount}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-xs font-medium text-slate-800">
                        정책 {cluster.policyCount}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        오류 {cluster.violationCount}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-xs text-slate-600">
                        {cluster.lastSyncedAt}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {cluster.owner}
                      </p>
                    </TableCell>
                    <TableCell className="py-4 pr-5 sm:pr-6">
                      <Link
                        href={`/admin/clusters/${cluster.id}`}
                        aria-label={`${cluster.name} 상세 보기`}
                        className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {filteredClusters.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 클러스터가 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredClusters.length} / {activeClusters.length}개 클러스터 표시
          </span>
          <span>연결된 클러스터 상태 및 노드 현황</span>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <StatusNote
          title="정책 동기화"
          description="클러스터별 정책 적용 상태를 확인합니다."
          href="/admin/policies"
          icon={ShieldCheck}
        />
        <StatusNote
          title="정책 오류"
          description="클러스터에서 감지된 위반 이력을 확인합니다."
          href="/admin/violations"
          icon={ShieldAlert}
        />
        <StatusNote
          title="연결 상태"
          description="Kubernetes API와 Kyverno 상태를 점검합니다."
          href="/admin/audit-logs"
          icon={Wifi}
        />
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
  icon: typeof Server;
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

function StatusNote({
  title,
  description,
  href,
  icon: Icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: typeof Server;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-200 hover:bg-blue-50/30"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>
      </div>
    </Link>
  );
}
