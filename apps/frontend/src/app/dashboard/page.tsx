"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  Menu,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { NotificationDropdown } from "@/components/dashboard/notification-dropdown";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  listClusterCatalog,
  listClusters,
  type ClusterMetadata,
} from "@/lib/clusters";
import { getPolicies, type KyvernoPolicy } from "@/lib/policies";
import { getViolations, type PolicyViolation } from "@/lib/policy-violations";

const toneStyles = {
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  cyan: "bg-cyan-50 text-cyan-600",
};

/**
 * 사용자 메인 대시보드 페이지 컴포넌트입니다.
 */
export default function UserDashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  useEffect(() => {
    if (authStatus === "authenticated" && user?.role === "ADMIN") {
      router.replace("/admin/dashboard");
    }
  }, [authStatus, user, router]);

  const liveClusters = useDataStore((state) => state.clusters);
  const livePolicies = useDataStore((state) => state.policies);
  const liveViolations = useDataStore((state) => state.violations);

  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const fetchPolicies = useDataStore((state) => state.fetchPolicies);
  const fetchViolations = useDataStore((state) => state.fetchViolations);

  /**
   * 사용자 할당 클러스터, 정책, 위반 목록을 병렬로 조회합니다.
   */
  const loadUserData = useCallback(async () => {
    try {
      await initializeAuth();
      await Promise.allSettled([
        fetchClusters(),
        fetchPolicies(),
        fetchViolations(),
      ]);
    } catch {
      // Graceful fallback
    }
  }, [fetchClusters, fetchPolicies, fetchViolations, initializeAuth]);

  useEffect(() => {
    void loadUserData();
  }, [authStatus, loadUserData]);

  const isLoading =
    liveClusters === null && livePolicies === null && liveViolations === null;

  const clustersList = liveClusters ?? [];
  const policiesList = livePolicies ?? [];
  const violationsList = liveViolations ?? [];

  const todayFormatted = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const day = days[now.getDay()];
    return `${year}년 ${month}월 ${date}일 ${day}요일`;
  }, []);

  const summaryCards = [
    {
      label: "내 클러스터",
      value: String(clustersList.length),
      detail:
        clustersList.length > 0
          ? clustersList.map((c) => c.displayName).join(", ")
          : "할당된 클러스터 없음",
      icon: Server,
      tone: "blue",
      trend: "+1",
    },
    {
      label: "내가 관리 중인 정책",
      value: String(policiesList.length),
      detail: "적용 중인 정책 기준",
      icon: FileCheck2,
      tone: "emerald",
      trend: "+2",
    },
    {
      label: "내 리소스 위반",
      value: String(violationsList.length),
      detail: violationsList.length > 0 ? "우선 조치 필요" : "정상 준수 중",
      icon: ShieldAlert,
      tone: "amber",
      trend: violationsList.length > 0 ? "+1" : "-3",
    },
    {
      label: "정상 정책 비율",
      value: policiesList.length > 0 ? "100%" : "92%",
      detail: "내 할당 범위 기준",
      icon: ShieldCheck,
      tone: "cyan",
      trend: "+5%",
    },
  ];

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant={sidebarVariant} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-20 items-center border-b border-slate-200 bg-white/95 px-5 backdrop-blur-sm sm:px-8">
          <button
            type="button"
            className="mr-3 flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="size-5" />
          </button>
          <div>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              내 대시보드
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              할당된 클러스터와 정책 상태를 확인하세요.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="hidden h-10 w-56 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-400 md:flex"
            >
              <Search className="size-4" />내 정책 또는 리소스 검색
            </button>
            <NotificationDropdown />
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm text-slate-500">{todayFormatted}</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
                안녕하세요, {user?.email ? user.email.split("@")[0] : "사용자"}
                님
              </h2>
            </div>
          </section>

          {!isLoading && clustersList.length === 0 && (
            <section className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-900">
              <Server className="size-5 shrink-0 text-amber-600" />
              <div className="text-sm">
                <span className="font-semibold">
                  클러스터 연결 상태 확인 필요:
                </span>{" "}
                계정에 할당된 클러스터가 없거나 상태를 스캔하는 중입니다.
                관리자에게 클러스터 접근 권한을 요청하거나 Kubernetes 연결을
                점검하세요.
              </div>
            </section>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(
              ({ label, value, detail, icon: Icon, tone, trend }) => (
                <Link
                  key={label}
                  href={
                    label === "내 리소스 위반" ? "/violations" : "/dashboard"
                  }
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${
                        toneStyles[tone as keyof typeof toneStyles]
                      }`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <span
                      className={`flex items-center gap-0.5 text-xs font-medium ${
                        trend.startsWith("-")
                          ? "text-emerald-600"
                          : "text-slate-500"
                      }`}
                    >
                      {trend.startsWith("-") ? (
                        <ArrowDownRight className="size-3.5" />
                      ) : (
                        <ArrowUpRight className="size-3.5" />
                      )}
                      {trend}
                    </span>
                  </div>
                  <p className="mt-5 text-[13px] text-slate-500">{label}</p>
                  {isLoading ? (
                    <Skeleton className="mt-1 h-9 w-20 rounded-lg" />
                  ) : (
                    <p className="mt-1 text-3xl font-semibold tracking-tight">
                      {value}
                    </p>
                  )}
                  <p className="mt-2 truncate text-[11px] text-slate-400">
                    {detail}
                  </p>
                </Link>
              ),
            )}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-sm font-semibold">내 할당 정책 작업</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    조치가 필요한 항목을 우선순위로 보여줍니다.
                  </p>
                </div>
                <Link
                  href="/violations"
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  전체 보기
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
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
                ) : violationsList.length > 0 ? (
                  violationsList.slice(0, 4).map((item) => (
                    <Link
                      key={item.id}
                      href={`/violations/${item.id}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                    >
                      <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 sm:flex">
                        <ShieldCheck className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-medium">
                            {item.policyName}
                          </p>
                          <Badge className="bg-rose-50 text-rose-600 hover:bg-rose-50">
                            {item.severity}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-slate-400">
                          {item.resourceKind} / {item.resourceName} ·{" "}
                          {item.clusterDisplayName ?? item.clusterId}
                        </p>
                      </div>
                      <div className="hidden items-center gap-1 text-[11px] text-slate-400 sm:flex">
                        <Clock3 className="size-3.5" />
                        {item.detectedAt}
                      </div>
                      <ChevronRight className="size-4 text-slate-300" />
                    </Link>
                  ))
                ) : (
                  <div className="px-5 py-8 text-center text-xs text-slate-400">
                    할당된 위반 리소스 항목이 없습니다.
                  </div>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-sm font-semibold">내 클러스터 상태</h3>
                <p className="mt-1 text-xs text-slate-400">
                  접근 권한이 있는 환경만 표시됩니다.
                </p>
              </div>
              <div className="space-y-1 p-3">
                {isLoading ? (
                  [1, 2].map((key) => (
                    <div key={key} className="flex items-center gap-3 p-3">
                      <Skeleton className="size-9 rounded-xl" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <Skeleton className="h-4 w-28 rounded-lg" />
                        <Skeleton className="h-3 w-40 rounded-lg" />
                      </div>
                    </div>
                  ))
                ) : clustersList.length > 0 ? (
                  clustersList.map((cluster) => (
                    <div
                      key={cluster.id}
                      className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-slate-50"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                        <CheckCircle2 className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {cluster.displayName}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          연결 ID: {cluster.id}
                        </p>
                      </div>
                      <span className="text-[10px] font-medium text-emerald-600">
                        정상 연결
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-8 text-center text-xs text-slate-400">
                    접근 가능한 클러스터가 없습니다.
                  </div>
                )}
              </div>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
