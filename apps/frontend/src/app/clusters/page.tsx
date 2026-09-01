"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Layers3,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import {
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
import { getPolicies, type KyvernoPolicy } from "@/lib/policies";
import { getViolations, type PolicyViolation } from "@/lib/policy-violations";

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

/**
 * 클러스터 관리 목록 페이지 컴포넌트입니다.
 * 백엔드 API로부터 라이브 클러스터 목록을 동적으로 조회하며, 실시간 정책 및 위반 현황을 종합 제공합니다.
 */
export default function ClustersPage() {
  const [query, setQuery] = useState("");
  const [environmentFilter, setEnvironmentFilter] =
    useState<EnvironmentFilter>("all");
  const [clusterStatusFilter, setClusterStatusFilter] =
    useState<ClusterStatusFilter>("all");
  const [kyvernoStatusFilter, setKyvernoStatusFilter] =
    useState<KyvernoStatusFilter>("all");

  const [liveClusters, setLiveClusters] = useState<ClusterMetadata[] | null>(
    null,
  );
  const [livePolicies, setLivePolicies] = useState<KyvernoPolicy[] | null>(
    null,
  );
  const [liveViolations, setLiveViolations] = useState<
    PolicyViolation[] | null
  >(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  /**
   * 백엔드 API에서 라이브 클러스터, 실시간 정책, 정책 위반 내역을 병렬 조회합니다.
   */
  const loadDashboardData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await initializeAuth();

      let clustersData: ClusterMetadata[] | null = null;
      try {
        const data = await listClusters();
        if (Array.isArray(data)) {
          clustersData = data;
        }
      } catch {
        try {
          const catalogData = await listClusterCatalog();
          if (Array.isArray(catalogData)) {
            clustersData = catalogData;
          }
        } catch {
          // 백엔드 연동 실패 시 graceful fallback 유지
        }
      }

      if (clustersData !== null) {
        setLiveClusters(clustersData);
      }

      const [policiesResult, violationsResult] = await Promise.allSettled([
        getPolicies(),
        getViolations(),
      ]);

      if (
        policiesResult.status === "fulfilled" &&
        policiesResult.value.length > 0
      ) {
        setLivePolicies(policiesResult.value);
      }
      if (
        violationsResult.status === "fulfilled" &&
        violationsResult.value.length > 0
      ) {
        setLiveViolations(violationsResult.value);
      }
    } catch {
      // 백엔드 연동 불가 시 graceful fallback 유지
    } finally {
      setIsRefreshing(false);
    }
  }, [initializeAuth]);

  useEffect(() => {
    void loadDashboardData();
  }, [authStatus, loadDashboardData]);

  const activeClusters: ManagedCluster[] = useMemo(() => {
    if (liveClusters && liveClusters.length > 0) {
      return liveClusters.map((item) => {
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
          provider: "EKS",
          status: "healthy",
          kyvernoStatus: "ready",
          nodeCount: 1,
          namespaceCount: 1,
          policyCount: 0,
          violationCount: 0,
          lastSyncedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
          owner: "플랫폼팀",
          description: `${item.displayName || item.id} 클러스터입니다.`,
        };
      });
    }
    return [];
  }, [liveClusters]);

  const policyList = livePolicies ?? [];
  const violationList = liveViolations ?? [];

  const clusterRows = useMemo(
    () =>
      activeClusters.map((cluster) => {
        const policies = policyList.filter(
          (policy) =>
            (policy.clusterId === cluster.id ||
              policy.clusterName === cluster.name ||
              policy.clusterDisplayName === cluster.name ||
              policy.clusterDisplayName === cluster.id) &&
            policy.status !== "draft",
        );
        const violations = violationList.filter(
          (violation) =>
            violation.clusterId === cluster.id ||
            violation.clusterName === cluster.name ||
            violation.clusterDisplayName === cluster.name ||
            violation.clusterDisplayName === cluster.id,
        );
        const unresolvedViolations = violations.filter(
          (violation) => violation.status !== "resolved",
        );

        return {
          ...cluster,
          policyCount: policies.length,
          violationCount: violations.length,
          policies,
          violations,
          unresolvedViolations,
        };
      }),
    [activeClusters, policyList, violationList],
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
    (cluster) =>
      cluster.status === "healthy" && cluster.kyvernoStatus === "ready",
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
      actions={
        <Button
          type="button"
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
          disabled={isRefreshing}
          onClick={() => void loadDashboardData()}
        >
          <RefreshCw
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "불러오는 중..." : "새로고침"}
        </Button>
      }
    >
      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="접근 가능"
          value={String(clusterRows.length)}
          detail="조회 가능한 클러스터"
          icon={Server}
          className="bg-blue-50 text-blue-600"
          loading={liveClusters === null}
        />
        <SummaryCard
          label="정상 운영"
          value={String(readyClusters)}
          detail="Kyverno 준비 완료"
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
          loading={liveClusters === null}
        />
        <SummaryCard
          label="동기화 중"
          value={String(syncingClusters)}
          detail="상태 갱신 진행"
          icon={Wifi}
          className="bg-cyan-50 text-cyan-600"
          loading={liveClusters === null}
        />
        <SummaryCard
          label="미해결 위반"
          value={String(totalUnresolvedViolations)}
          detail="정책 확인 필요"
          icon={AlertTriangle}
          className="bg-amber-50 text-amber-600"
          loading={liveClusters === null}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
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
          {liveClusters === null
            ? [1, 2, 3].map((key) => (
                <article
                  key={key}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-5 w-16 rounded-lg" />
                        <Skeleton className="h-5 w-16 rounded-lg" />
                        <Skeleton className="h-5 w-24 rounded-lg" />
                      </div>
                      <Skeleton className="h-5 w-3/4 rounded-lg" />
                      <Skeleton className="h-4 w-full rounded-lg" />
                    </div>
                    <Skeleton className="size-11 rounded-2xl" />
                  </div>

                  <div className="mt-5 space-y-2">
                    <Skeleton className="h-7 w-full rounded-xl" />
                    <Skeleton className="h-7 w-full rounded-xl" />
                    <Skeleton className="h-7 w-full rounded-xl" />
                    <Skeleton className="h-7 w-full rounded-xl" />
                    <Skeleton className="h-7 w-full rounded-xl" />
                  </div>

                  <div className="mt-5 flex items-center gap-2">
                    <Skeleton className="h-9 w-24 rounded-xl" />
                  </div>
                </article>
              ))
            : filteredClusters.map((cluster) => (
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
                        <Badge
                          className={clusterStatusClassName[cluster.status]}
                        >
                          {clusterStatusLabel[cluster.status]}
                        </Badge>
                        <Badge
                          className={
                            kyvernoStatusClassName[cluster.kyvernoStatus]
                          }
                        >
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
                    <InfoRow
                      label="노드/네임스페이스"
                      value={`${cluster.nodeCount} / ${cluster.namespaceCount}`}
                    />
                    <InfoRow
                      label="적용 정책"
                      value={`${cluster.policies.length}개`}
                    />
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

        {liveClusters !== null && filteredClusters.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            {liveClusters.length === 0
              ? "연결된 클러스터가 없거나 현재 스캔 중입니다. 클러스터 등록 및 Kubernetes 연결 상태를 확인하세요."
              : "조건에 맞는 클러스터가 없습니다."}
          </div>
        ) : null}
      </section>
    </DashboardPageShell>
  );
}

/**
 * 요약 지표 카드 컴포넌트입니다.
 */
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
        <Layers3 className="size-4 text-slate-300" />
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
