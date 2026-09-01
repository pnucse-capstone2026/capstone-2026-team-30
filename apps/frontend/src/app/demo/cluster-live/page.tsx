"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Box,
  CheckCircle2,
  Cpu,
  Eye,
  FileCode2,
  Filter,
  Flame,
  GitBranch,
  GitPullRequest,
  HardDrive,
  Layers,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getLiveClusterOverview,
  type LiveClusterOverview,
  type LiveNodeInfo,
  type LivePodInfo,
  type LivePolicySummary,
  type LivePolicyExceptionSummary,
} from "@/lib/cluster-overview-api";
import { useAuthStore } from "@/lib/auth-store";

/**
 * 실시간 Kubernetes 클러스터 관제 및 토폴로지 시각화 페이지
 * 사용자가 새로고침을 누를 때마다 실제 kubectl 조회 결과 기반의 파드, 노드, 정책, 위반 및 정책 예외 현황을 정밀 렌더링합니다.
 */
export default function LiveClusterTopologyPage() {
  const [data, setData] = useState<LiveClusterOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPod, setSelectedPod] = useState<LivePodInfo | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // 0 = off, 5 = 5s, 10 = 10s
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastRefreshedTime, setLastRefreshedTime] = useState<string>("");

  const initializeAuth = useAuthStore((state) => state.initialize);

  /**
   * 백엔드 API로부터 최신 Kubernetes 클러스터 팩트 데이터를 조회합니다.
   */
  const fetchData = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      }
      try {
        await initializeAuth();
        const overview = await getLiveClusterOverview();
        setData(overview);
        const now = new Date();
        setLastRefreshedTime(
          now.toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );
      } catch (err) {
        console.error("Failed to fetch live cluster overview:", err);
      } finally {
        setLoading(false);
        if (isManualRefresh) {
          setTimeout(() => setRefreshing(false), 300);
        }
      }
    },
    [initializeAuth],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 자동 새로고침 타이머
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      void fetchData(false);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, fetchData]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // 필터링된 파드 목록
  const filteredPods = useMemo(() => {
    if (!data) return [];
    return data.pods.filter((pod) => {
      const matchNs =
        selectedNamespace === "all" || pod.namespace === selectedNamespace;
      const matchQuery =
        searchQuery.trim().length === 0 ||
        pod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pod.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pod.containers.some((c) =>
          c.image.toLowerCase().includes(searchQuery.toLowerCase()),
        );
      return matchNs && matchQuery;
    });
  }, [data, selectedNamespace, searchQuery]);

  // 네임스페이스별 그룹화
  const groupedPods = useMemo(() => {
    const map = new Map<string, LivePodInfo[]>();
    for (const pod of filteredPods) {
      const list = map.get(pod.namespace) ?? [];
      list.push(pod);
      map.set(pod.namespace, list);
    }
    return map;
  }, [filteredPods]);

  const namespacesList = useMemo(() => {
    if (!data) return [];
    return data.namespaces;
  }, [data]);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
      {/* 1. 상단 글로벌 관제 네비게이션 헤더 */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800/80 bg-[#070b14]/90 px-4 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 text-xs text-slate-400 hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <Link href="/admin/dashboard">
              <ArrowLeft className="size-3.5" />
              대시보드
            </Link>
          </Button>

          <div className="h-4 w-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/30">
              <Activity className="size-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-white">
                  {data?.cluster.displayName ?? "Kubernetes Live Topology"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/30">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Live Sync
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                k8s {data?.serverVersion ?? "v1.36.1"} · Kyverno Engine v1.12.0
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* 최근 갱신 시각 */}
          {lastRefreshedTime && (
            <span className="hidden text-xs text-slate-500 md:inline-block">
              최근 갱신:{" "}
              <span className="font-mono text-slate-300">
                {lastRefreshedTime}
              </span>
            </span>
          )}

          {/* 자동 새로고침 간격 선택 */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 text-xs">
            <span className="px-2 text-[11px] text-slate-400">자동</span>
            {[
              { label: "Off", val: 0 },
              { label: "5s", val: 5 },
              { label: "10s", val: 10 },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setAutoRefreshInterval(opt.val)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  autoRefreshInterval === opt.val
                    ? "bg-cyan-500 text-black shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 수동 새로고침 버튼 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchData(true)}
            disabled={refreshing}
            className="h-8 gap-1.5 rounded-lg border-cyan-500/30 bg-cyan-500/10 text-xs font-semibold text-cyan-300 transition-all hover:border-cyan-400 hover:bg-cyan-500/20 active:scale-95"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin text-cyan-400" : ""}`}
            />
            <span>{refreshing ? "조회 중..." : "새로고침"}</span>
          </Button>

          {/* 전체화면 버튼 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            className="size-8 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white"
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
        {/* 2. 클러스터 핵심 Fact 지표 카드 5종 */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* 노드 현황 */}
          <article className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">클러스터 노드</span>
              <Server className="size-4 text-cyan-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              {loading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <>
                  <span className="text-2xl font-bold tracking-tight text-white">
                    {data?.summary.readyNodes ?? 0}
                  </span>
                  <span className="text-xs text-slate-500">
                    / {data?.summary.totalNodes ?? 0} Ready
                  </span>
                </>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-400 truncate">
              {data?.nodes[0]?.name ?? "k8s-lab-control-plane"}
            </p>
          </article>

          {/* 파드 가동 현황 */}
          <article className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">실행 중인 파드</span>
              <Box className="size-4 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              {loading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <>
                  <span className="text-2xl font-bold tracking-tight text-emerald-400">
                    {data?.summary.runningPods ?? 0}
                  </span>
                  <span className="text-xs text-slate-500">
                    / {data?.summary.totalPods ?? 0} Total
                  </span>
                </>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              대기: {data?.summary.pendingPods ?? 0}건 · 오류:{" "}
              {data?.summary.failedPods ?? 0}건
            </p>
          </article>

          {/* 활성 Kyverno 정책 */}
          <article className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">활성 Kyverno 정책</span>
              <ShieldCheck className="size-4 text-blue-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              {loading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <>
                  <span className="text-2xl font-bold tracking-tight text-blue-400">
                    {data?.summary.totalPolicies ?? 0}
                  </span>
                  <span className="text-xs text-slate-500">Policies</span>
                </>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Audit {data?.summary.auditPolicies ?? 0}개 · Enforce{" "}
              {data?.summary.enforcePolicies ?? 0}개
            </p>
          </article>

          {/* 감지된 정책 위반 */}
          <article className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">감지된 정책 위반</span>
              <ShieldAlert
                className={`size-4 ${
                  (data?.summary.totalViolations ?? 0) > 0
                    ? "text-rose-400"
                    : "text-emerald-400"
                }`}
              />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              {loading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <>
                  <span
                    className={`text-2xl font-bold tracking-tight ${
                      (data?.summary.totalViolations ?? 0) > 0
                        ? "text-rose-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {data?.summary.totalViolations ?? 0}
                  </span>
                  <span className="text-xs text-slate-500">
                    건 ({data?.summary.violatingPodsCount ?? 0} 파드)
                  </span>
                </>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {(data?.summary.totalViolations ?? 0) === 0
                ? "현재 클린 상태 (위반 없음 🟢)"
                : "위반 조치 필요 🔴"}
            </p>
          </article>

          {/* 승인된 정책 예외 (PolicyException) */}
          <article className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-4 backdrop-blur-sm col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-purple-300">
              <span className="text-xs font-medium">승인된 정책 예외</span>
              <Shield className="size-4 text-purple-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              {loading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <>
                  <span className="text-2xl font-bold tracking-tight text-purple-300">
                    {data?.summary.activeExceptionsCount ?? 0}
                  </span>
                  <span className="text-xs text-purple-400/80">Exceptions</span>
                </>
              )}
            </div>
            <p className="mt-1 text-[11px] text-purple-300/80">
              {(data?.summary.activeExceptionsCount ?? 0) > 0
                ? "K8s PolicyException CRD 면제 활성"
                : "면제된 예외 없음"}
            </p>
          </article>
        </section>

        {/* 3. 검색 및 네임스페이스 필터 탭 바 */}
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* 네임스페이스 탭 목록 */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
            <button
              type="button"
              onClick={() => setSelectedNamespace("all")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedNamespace === "all"
                  ? "bg-cyan-500 text-black shadow-sm font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              전체 ({data?.summary.totalPods ?? 0})
            </button>

            {namespacesList.map((ns) => {
              const isSelected = selectedNamespace === ns.name;
              return (
                <button
                  key={ns.name}
                  type="button"
                  onClick={() => setSelectedNamespace(ns.name)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-cyan-500 text-black shadow-sm font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <span>{ns.name}</span>
                  <span
                    className={`rounded px-1 text-[10px] ${
                      isSelected
                        ? "bg-black/20 text-black"
                        : ns.violationPodCount > 0
                          ? "bg-rose-500/20 text-rose-300"
                          : ns.exceptionPodCount > 0
                            ? "bg-purple-500/20 text-purple-300"
                            : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {ns.podCount}
                  </span>
                  {ns.violationPodCount > 0 && (
                    <span className="size-1.5 rounded-full bg-rose-500 animate-ping" />
                  )}
                  {ns.exceptionPodCount > 0 && ns.violationPodCount === 0 && (
                    <span className="size-1.5 rounded-full bg-purple-400" />
                  )}
                </button>
              );
            })}
          </div>

          {/* 파드 검색창 */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              type="search"
              placeholder="파드 이름 또는 이미지 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-xl border-slate-800 bg-slate-900/80 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-cyan-500"
            />
          </div>
        </section>

        {/* 4. 실시간 네임스페이스별 파드 토폴로지 캔버스 */}
        <section className="space-y-4">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-36 w-full rounded-2xl bg-slate-900/60" />
              <Skeleton className="h-36 w-full rounded-2xl bg-slate-900/60" />
            </div>
          ) : Array.from(groupedPods.entries()).length === 0 ? (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-12 text-center text-slate-400">
              <Box className="mx-auto size-10 text-slate-600 mb-3" />
              <p className="text-sm font-semibold text-slate-300">
                선택된 조건에 해당하는 파드가 없습니다.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {selectedNamespace !== "all"
                  ? `'${selectedNamespace}' 네임스페이스에 배포된 워크로드가 없습니다.`
                  : "클러스터에 배포된 파드가 없습니다."}
              </p>
            </div>
          ) : (
            Array.from(groupedPods.entries()).map(([nsName, pods]) => {
              const nsMeta = namespacesList.find((n) => n.name === nsName);
              const hasViolation = pods.some((p) => p.violations.length > 0);
              const hasException = pods.some(
                (p) => p.activeExceptions.length > 0,
              );

              return (
                <article
                  key={nsName}
                  className={`rounded-2xl border p-5 backdrop-blur-sm transition-all ${
                    hasViolation
                      ? "border-rose-500/30 bg-rose-950/10"
                      : hasException
                        ? "border-purple-500/30 bg-purple-950/10"
                        : "border-slate-800/80 bg-slate-900/40"
                  }`}
                >
                  {/* 네임스페이스 헤더 바 */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60 pb-3.5">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex size-6 items-center justify-center rounded-md ${
                          hasViolation
                            ? "bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40"
                            : hasException
                              ? "bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40"
                              : "bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20"
                        }`}
                      >
                        <Layers className="size-3.5" />
                      </div>
                      <span className="text-sm font-semibold tracking-tight text-white">
                        namespace / {nsName}
                      </span>
                      {nsMeta?.isSystem ? (
                        <Badge className="bg-slate-800 text-[10px] text-slate-400 border-0">
                          System
                        </Badge>
                      ) : (
                        <Badge className="bg-cyan-950 text-cyan-400 border border-cyan-800 text-[10px]">
                          Target
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>총 {pods.length}개 파드</span>
                      {hasViolation && (
                        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-400 ring-1 ring-rose-500/40">
                          ⚠️ 정책 위반 파드 감지
                        </span>
                      )}
                      {hasException && (
                        <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[11px] font-semibold text-purple-300 ring-1 ring-purple-500/40">
                          🛡️ 정책 예외 적용됨
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 파드 그리드 캔버스 */}
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {pods.map((pod) => {
                      const isSelected = selectedPod?.id === pod.id;
                      const hasPodViolation = pod.violations.length > 0;
                      const hasPodException = pod.activeExceptions.length > 0;
                      const isRunning = pod.status === "Running";

                      return (
                        <div
                          key={pod.id}
                          onClick={() => setSelectedPod(pod)}
                          className={`group relative cursor-pointer rounded-xl border p-3.5 transition-all hover:translate-y-[-2px] hover:shadow-lg ${
                            isSelected
                              ? "border-cyan-400 bg-cyan-950/30 ring-2 ring-cyan-400/30"
                              : hasPodViolation
                                ? "border-rose-500/40 bg-rose-950/20 hover:border-rose-400"
                                : hasPodException
                                  ? "border-purple-500/40 bg-purple-950/20 hover:border-purple-400"
                                  : isRunning
                                    ? "border-slate-800 bg-slate-900/80 hover:border-slate-700"
                                    : "border-amber-500/30 bg-amber-950/10 hover:border-amber-400"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`size-2.5 rounded-full shrink-0 ${
                                  hasPodViolation
                                    ? "bg-rose-500 animate-pulse"
                                    : hasPodException
                                      ? "bg-purple-400"
                                      : isRunning
                                        ? "bg-emerald-400"
                                        : "bg-amber-400"
                                }`}
                              />
                              <h4
                                className="truncate text-xs font-semibold text-white group-hover:text-cyan-300"
                                title={pod.name}
                              >
                                {pod.name}
                              </h4>
                            </div>

                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium ${
                                isRunning
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-amber-500/10 text-amber-400"
                              }`}
                            >
                              {pod.status}
                            </span>
                          </div>

                          {/* 파드 스펙 요약 */}
                          <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Ready</span>
                              <span className="font-mono text-slate-300">
                                {pod.ready}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">IP / Node</span>
                              <span className="font-mono text-slate-300 truncate max-w-[120px]">
                                {pod.podIp}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Age</span>
                              <span className="text-slate-300">{pod.age}</span>
                            </div>
                          </div>

                          {/* 위반 경고 뱃지 */}
                          {hasPodViolation && (
                            <div className="mt-2.5 flex items-center gap-1 rounded-md bg-rose-500/20 px-2 py-1 text-[10px] font-semibold text-rose-300">
                              <AlertTriangle className="size-3 shrink-0" />
                              <span className="truncate">
                                {pod.violations[0].policyName}
                              </span>
                            </div>
                          )}

                          {/* 정책 예외 승인 뱃지 */}
                          {hasPodException && (
                            <div className="mt-2.5 flex items-center gap-1 rounded-md bg-purple-500/20 px-2 py-1 text-[10px] font-semibold text-purple-300">
                              <Shield className="size-3 shrink-0" />
                              <span className="truncate">
                                예외 적용됨 (
                                {pod.activeExceptions[0].policyName})
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </section>

        {/* 5. 승인된 Kyverno 정책 예외 (PolicyException) 실시간 현황 */}
        {data?.exceptions && data.exceptions.length > 0 && (
          <section className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-purple-500/30 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-purple-400" />
                <h3 className="text-sm font-semibold tracking-tight text-white">
                  클러스터에 적용된 Kyverno 정책 예외 (PolicyException{" "}
                  {data.exceptions.length}건)
                </h3>
              </div>
              <span className="text-xs text-purple-300/80">
                Kyverno 엔진이 평가에서 자동 면제 처리 중
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.exceptions.map((ex) => (
                <div
                  key={ex.id}
                  className="rounded-xl border border-purple-500/30 bg-slate-900/80 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-xs font-bold text-white">
                        {ex.resourceKind} / {ex.resourceName}
                      </span>
                      <p className="text-[10px] text-purple-300">
                        ns: {ex.resourceNamespace} · CRD: {ex.k8sExceptionName}
                      </p>
                    </div>
                    <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px]">
                      {ex.syncedToK8s ? "K8s Synced" : "Approved"}
                    </Badge>
                  </div>

                  <div className="mt-2.5 rounded bg-slate-950/60 p-2 text-[11px] text-slate-300">
                    <span className="text-slate-500">면제 정책:</span>{" "}
                    <span className="font-semibold text-cyan-300">
                      {ex.policyName}
                    </span>
                    <div className="mt-1 text-[10px] text-slate-400 line-clamp-2">
                      사유: {ex.reason}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <span>규칙: {ex.ruleNames.join(", ")}</span>
                    <span className="text-purple-300">
                      만료: {new Date(ex.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 6. 하단 Kyverno 거버넌스 정책 방어막 (Active Policy Shields) */}
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-cyan-400" />
              <h3 className="text-sm font-semibold tracking-tight text-white">
                클러스터에 적용된 Kyverno 거버넌스 정책 (
                {data?.policies.length ?? 0}개)
              </h3>
            </div>
            <span className="text-xs text-slate-500">
              시스템 네임스페이스 자동 제외 보호 활성화됨
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data?.policies.map((p) => (
              <div
                key={p.name}
                className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-white">
                    {p.name}
                  </span>
                  <Badge
                    className={`text-[10px] uppercase ${
                      p.mode === "enforce"
                        ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                        : "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                    }`}
                  >
                    {p.mode}
                  </Badge>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-slate-400 line-clamp-2">
                  {p.description}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {p.rules.map((rule) => (
                    <span
                      key={rule}
                      className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                    >
                      rule: {rule}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* 7. 파드 상세 인스펙터 슬라이드 드로어 (Pod Inspector Drawer) */}
      {selectedPod && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-800 bg-[#0b1120] p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between border-b border-slate-800 pb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`size-2.5 rounded-full ${
                    selectedPod.status === "Running"
                      ? "bg-emerald-400"
                      : "bg-rose-500"
                  }`}
                />
                <h3 className="truncate text-base font-bold text-white">
                  {selectedPod.name}
                </h3>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                namespace:{" "}
                <span className="text-cyan-300">{selectedPod.namespace}</span>
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSelectedPod(null)}
              className="size-8 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-5 text-xs">
            {/* 정책 예외 배너 (있을 경우) */}
            {selectedPod.activeExceptions.length > 0 && (
              <div className="rounded-xl border border-purple-500/40 bg-purple-950/30 p-3.5 text-purple-200">
                <div className="flex items-center gap-1.5 font-semibold text-purple-300">
                  <Shield className="size-4 text-purple-400" />
                  <span>Kyverno 정책 예외(PolicyException) 승인 적용됨</span>
                </div>
                {selectedPod.activeExceptions.map((ex, i) => (
                  <div key={i} className="mt-2 text-[11px]">
                    <span className="font-semibold text-purple-300">
                      [{ex.policyName} / {ex.ruleNames.join(", ")}]
                    </span>
                    <p className="mt-0.5 text-purple-200/90">
                      사유: {ex.reason}
                    </p>
                    <p className="mt-1 text-[10px] text-purple-400 font-mono">
                      만료: {new Date(ex.expiresAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* 위반 내역 배너 (있을 경우) */}
            {selectedPod.violations.length > 0 && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-rose-200">
                <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                  <AlertOctagon className="size-4 text-rose-400" />
                  <span>Kyverno 정책 위반 감지됨</span>
                </div>
                {selectedPod.violations.map((v, i) => (
                  <div key={i} className="mt-2 text-[11px]">
                    <span className="font-semibold text-rose-300">
                      [{v.policyName} / {v.ruleName}]
                    </span>
                    <p className="mt-0.5 text-rose-200/90">{v.message}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 기본 메타데이터 */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-2">파드 정보</h4>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span className="text-emerald-400">{selectedPod.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ready</span>
                  <span className="text-slate-300">{selectedPod.ready}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IP</span>
                  <span className="text-slate-300">{selectedPod.podIp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Node</span>
                  <span className="text-slate-300">{selectedPod.nodeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Restarts</span>
                  <span className="text-slate-300">{selectedPod.restarts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created At</span>
                  <span className="text-slate-300">
                    {selectedPod.createdAt}
                  </span>
                </div>
              </div>
            </div>

            {/* 컨테이너 명세 */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-2">
                컨테이너 명세
              </h4>
              <div className="space-y-2">
                {selectedPod.containers.map((c) => (
                  <div
                    key={c.name}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-[11px]"
                  >
                    <div className="flex items-center justify-between font-semibold text-white">
                      <span>{c.name}</span>
                      <Badge
                        className={`text-[9px] ${
                          c.ready
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {c.ready ? "Ready" : "Not Ready"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] text-cyan-300 break-all">
                      {c.image}
                    </p>

                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                      <div>
                        <span className="text-slate-500">Requests:</span>{" "}
                        {c.requests?.cpu ?? "-"} / {c.requests?.memory ?? "-"}
                      </div>
                      <div>
                        <span className="text-slate-500">Limits:</span>{" "}
                        {c.limits?.cpu ?? "-"} / {c.limits?.memory ?? "-"}
                      </div>
                      <div>
                        <span className="text-slate-500">Privileged:</span>{" "}
                        <span
                          className={
                            c.privileged
                              ? "text-rose-400 font-bold"
                              : "text-slate-300"
                          }
                        >
                          {c.privileged ? "true (경고)" : "false"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 레이블 */}
            {Object.keys(selectedPod.labels).length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-300 mb-2">Labels</h4>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(selectedPod.labels).map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300"
                    >
                      {k}={v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
