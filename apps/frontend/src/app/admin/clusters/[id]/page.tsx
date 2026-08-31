"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  auditLogs as fallbackAuditLogs,
  entityTypeClassName,
  entityTypeLabel,
  type AuditLog,
} from "@/lib/audit-logs";
import { useAuthStore } from "@/lib/auth-store";
import {
  clusters as fallbackClusters,
  clusterEnvironmentLabel,
  clusterStatusClassName,
  clusterStatusLabel,
  getCluster,
  kyvernoStatusClassName,
  kyvernoStatusLabel,
  type ClusterEnvironment,
  type ClusterMetadata,
  type ManagedCluster,
} from "@/lib/clusters";
import { useDataStore } from "@/lib/data-store";
import {
  kyvernoPolicies as fallbackPolicies,
  policyModeLabel,
  policyStatusClassName,
  policyStatusLabel,
  policyTypeClassName,
  policyTypeLabel,
  type KyvernoPolicy,
} from "@/lib/policies";
import {
  policyViolations as fallbackViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
  type PolicyViolation,
} from "@/lib/policy-violations";

/**
 * 관리자용 클러스터 세부 정보 페이지 컴포넌트입니다.
 * 실시간 API 및 DataStore를 통해 개별 클러스터의 연결 메타데이터, 바인딩된 Kyverno 정책, 위반 건수, 감사 로그를 표출합니다.
 */
export default function AdminClusterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id;
  const clusterId = Array.isArray(rawId) ? rawId[0] : (rawId ?? "");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [directCluster, setDirectCluster] = useState<ClusterMetadata | null>(
    null,
  );

  const liveClusters = useDataStore((state) => state.clusters);
  const livePolicies = useDataStore((state) => state.policies);
  const liveViolations = useDataStore((state) => state.violations);
  const liveAuditLogs = useDataStore((state) => state.auditLogs);

  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const fetchPolicies = useDataStore((state) => state.fetchPolicies);
  const fetchViolations = useDataStore((state) => state.fetchViolations);
  const fetchAuditLogs = useDataStore((state) => state.fetchAuditLogs);

  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  /**
   * 해당 클러스터와 관련된 실시간 데이터들을 병렬 패칭합니다.
   */
  const loadClusterData = useCallback(
    async (force = false) => {
      if (!clusterId) return;

      try {
        await initializeAuth();

        const promises: Promise<unknown>[] = [
          fetchClusters(force),
          fetchPolicies(force),
          fetchViolations(force),
          fetchAuditLogs(force),
        ];

        // 개별 클러스터 상세 API 호출 병행
        promises.push(
          getCluster(clusterId)
            .then((data) => {
              if (data) setDirectCluster(data);
            })
            .catch(() => {
              // catalog나 목록에서 찾기 시도
            }),
        );

        await Promise.allSettled(promises);
      } catch {
        // 네트워크 또는 백엔드 예외 시 fallback 처리
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      clusterId,
      fetchAuditLogs,
      fetchClusters,
      fetchPolicies,
      fetchViolations,
      initializeAuth,
    ],
  );

  useEffect(() => {
    void loadClusterData();
  }, [authStatus, loadClusterData]);

  /** 새로고침 버튼 핸들러 */
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadClusterData(true);
  };

  const currentCluster: ManagedCluster | null = useMemo(() => {
    if (!clusterId) return null;

    const foundInStore = liveClusters?.find(
      (c) => c.id === clusterId || c.displayName === clusterId,
    );

    const targetMeta = directCluster ?? foundInStore;

    const foundInFallback = fallbackClusters.find(
      (c) => c.id === clusterId || c.name === clusterId,
    );

    if (targetMeta) {
      if (foundInFallback) {
        return {
          ...foundInFallback,
          id: targetMeta.id,
          name: targetMeta.displayName || foundInFallback.name,
        };
      }

      const env: ClusterEnvironment = clusterId.includes("stage")
        ? "staging"
        : clusterId.includes("dev")
          ? "development"
          : clusterId.includes("sand")
            ? "sandbox"
            : "production";

      return {
        id: targetMeta.id,
        name: targetMeta.displayName || targetMeta.id,
        environment: env,
        region: "us-east-1",
        provider: "EKS",
        status: "healthy",
        kyvernoStatus: "ready",
        nodeCount: 3,
        namespaceCount: 8,
        policyCount: 0,
        violationCount: 0,
        lastSyncedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
        owner: "플랫폼팀",
        description: `${targetMeta.displayName || targetMeta.id} 클러스터입니다.`,
      };
    }

    if (foundInFallback) {
      return foundInFallback;
    }

    return null;
  }, [clusterId, directCluster, liveClusters]);

  const policyList: KyvernoPolicy[] = livePolicies ?? fallbackPolicies;
  const violationList: PolicyViolation[] = liveViolations ?? fallbackViolations;
  const auditLogList: AuditLog[] = liveAuditLogs ?? fallbackAuditLogs;

  const relatedPolicies = useMemo(() => {
    if (!currentCluster) return [];
    return policyList.filter(
      (policy) =>
        policy.clusterId === currentCluster.id ||
        policy.clusterName === currentCluster.name ||
        policy.clusterDisplayName === currentCluster.name ||
        policy.clusterDisplayName === currentCluster.id,
    );
  }, [currentCluster, policyList]);

  const relatedViolations = useMemo(() => {
    if (!currentCluster) return [];
    return violationList.filter(
      (violation) =>
        violation.clusterId === currentCluster.id ||
        violation.clusterName === currentCluster.name ||
        violation.clusterDisplayName === currentCluster.name ||
        violation.clusterDisplayName === currentCluster.id,
    );
  }, [currentCluster, violationList]);

  const relatedAuditLogs = useMemo(() => {
    if (!currentCluster) return [];
    return auditLogList.filter(
      (log) =>
        log.entityId === currentCluster.name ||
        log.entityId === currentCluster.id ||
        log.metadata?.includes(`cluster=${currentCluster.name}`) ||
        log.metadata?.includes(`cluster=${currentCluster.id}`),
    );
  }, [auditLogList, currentCluster]);

  const unresolvedViolations = useMemo(
    () =>
      relatedViolations.filter((violation) => violation.status !== "resolved"),
    [relatedViolations],
  );

  if (loading && !currentCluster) {
    return (
      <DashboardPageShell
        variant="admin"
        activeHref="/admin/clusters"
        title="클러스터 상세"
        description="클러스터 정보를 불러오는 중입니다..."
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-10 w-48 rounded-xl" />
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </DashboardPageShell>
    );
  }

  if (!currentCluster && !loading) {
    return (
      <DashboardPageShell
        variant="admin"
        activeHref="/admin/clusters"
        title="클러스터를 찾을 수 없습니다"
        description={`요청하신 클러스터 ID (${clusterId})가 존재하지 않거나 권한이 없습니다.`}
        actions={
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link href="/admin/clusters">
              <ArrowLeft className="size-4" />
              클러스터 목록으로 이동
            </Link>
          </Button>
        }
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <ShieldAlert className="size-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900">
            클러스터 정보를 확인할 수 없습니다.
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            요청하신 식별자({clusterId})에 해당하는 클러스터가 등록되어 있지
            않거나, 현재 계정에 접근 권한이 부여되지 않았습니다.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              onClick={() => router.push("/admin/clusters")}
              className="rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            >
              목록으로 돌아가기
            </Button>
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="rounded-xl border-slate-200"
            >
              <RefreshCw className="mr-1.5 size-4" />
              다시 시도
            </Button>
          </div>
        </div>
      </DashboardPageShell>
    );
  }

  const cluster = currentCluster!;

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
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            />
            새로고침
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
          <Button
            asChild
            className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
          >
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
                  클러스터 연결 및 상태 정보입니다.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["클러스터 ID", cluster.id],
                ["표시 이름", cluster.name],
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
                        {policy.scope} · {policyModeLabel[policy.mode]} · 규칙{" "}
                        {policy.ruleCount}
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
                        <Badge
                          className={severityClassName[violation.severity]}
                        >
                          {severityLabel[violation.severity]}
                        </Badge>
                        <Badge className={statusClassName[violation.status]}>
                          {statusLabel[violation.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {violation.resourceKind} / {violation.resourceName} ·{" "}
                        {violation.detectedAt}
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
        <div
          className={`flex size-10 items-center justify-center rounded-xl ${className}`}
        >
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
