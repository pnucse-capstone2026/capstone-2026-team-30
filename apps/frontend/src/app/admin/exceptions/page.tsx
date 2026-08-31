"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataStore } from "@/lib/data-store";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  FileClock,
  Filter,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { NotificationDropdown } from "@/components/dashboard/notification-dropdown";
import { ProcessingStandardsDialog } from "@/components/violations/processing-standards-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listExceptionRequests } from "@/lib/exception-requests-api";
import {
  exceptionRiskClassName,
  exceptionRiskLabel,
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequest,
  type ExceptionRequestStatus,
  type ExceptionRiskLevel,
} from "@/lib/exception-requests";

const statusIcon: Record<ExceptionRequestStatus, typeof Clock3> = {
  pending: Clock3,
  applying: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  cancelling: Clock3,
  expiring: FileClock,
  expired: FileClock,
  cancelled: XCircle,
  failed: AlertTriangle,
};

const statusOptions: Array<"all" | ExceptionRequestStatus> = [
  "all",
  "pending",
  "applying",
  "approved",
  "rejected",
  "cancelling",
  "expiring",
  "expired",
  "cancelled",
  "failed",
];
const riskOptions: Array<"all" | ExceptionRiskLevel> = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
];

export default function AdminExceptionsPage() {
  const cachedRequests = useDataStore((state) => state.exceptions);
  const fetchExceptions = useDataStore((state) => state.fetchExceptions);
  const exceptionsLoading = useDataStore((state) => state.exceptionsLoading);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ExceptionRequestStatus>("all");
  const [riskLevel, setRiskLevel] = useState<"all" | ExceptionRiskLevel>("all");
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStandardsOpen, setIsStandardsOpen] = useState(false);

  const loadRequests = useCallback(async () => {
    setErrorMessage(null);
    setIsRefreshing(true);
    try {
      await fetchExceptions(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "예외 신청 목록을 불러오지 못했습니다.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchExceptions]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const requests = useMemo(() => cachedRequests ?? [], [cachedRequests]);
  const isLoading =
    (cachedRequests === null && exceptionsLoading) ||
    (cachedRequests === null && isRefreshing);

  const pendingRequests = requests.filter(
    (request) => request.status === "pending" || request.status === "applying",
  );
  const approvedRequests = requests.filter(
    (request) => request.status === "approved",
  );
  const needsActionRequests = requests.filter((request) =>
    ["applying", "cancelling", "expiring", "failed"].includes(request.status),
  );
  const highRiskRequests = requests.filter(
    (request) =>
      request.riskLevel === "critical" || request.riskLevel === "high",
  );

  const summaryCards = [
    {
      label: "검토 대기",
      value: pendingRequests.length.toString(),
      detail: "관리자 판단 필요",
      icon: Clock3,
      className: "bg-amber-50 text-amber-600",
    },
    {
      label: "적용 중",
      value: approvedRequests.length.toString(),
      detail: "만료일 추적 대상",
      icon: ShieldCheck,
      className: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "고위험 예외",
      value: highRiskRequests.length.toString(),
      detail: "운영 영향 우선 검토",
      icon: AlertTriangle,
      className: "bg-rose-50 text-rose-600",
    },
    {
      label: "조치 필요",
      value: needsActionRequests.length.toString(),
      detail: "적용·삭제 확인 필요",
      icon: AlertTriangle,
      className: "bg-blue-50 text-blue-600",
    },
  ];

  const clusters = useMemo(
    () =>
      Array.from(
        new Map(
          requests.map((request) => {
            const clusterId = request.targetClusterId ?? request.clusterName;

            return [
              clusterId,
              {
                id: clusterId,
                label:
                  request.targetClusterDisplayName ??
                  request.clusterName ??
                  clusterId,
              },
            ];
          }),
        ).values(),
      ),
    [requests],
  );
  const namespaces = useMemo(
    () => Array.from(new Set(requests.map((item) => item.namespace))),
    [requests],
  );

  const filteredRequests = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return requests.filter((request) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          request.id,
          request.policyName,
          request.resourceKind,
          request.resourceName,
          request.namespace,
          request.targetClusterId,
          request.clusterName,
          request.requester,
          request.team,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (status === "all" || request.status === status) &&
        (riskLevel === "all" || request.riskLevel === riskLevel) &&
        (cluster === "all" ||
          (request.targetClusterId ?? request.clusterName) === cluster) &&
        (namespace === "all" || request.namespace === namespace)
      );
    });
  }, [cluster, namespace, query, requests, riskLevel, status]);

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setRiskLevel("all");
    setCluster("all");
    setNamespace("all");
  }

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="admin" activeHref="/admin/exceptions" />

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
              예외 관리
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              정책 예외 신청을 검토하고 승인, 거절, 만료 상태를 관리합니다.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden h-10 w-64 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-400 md:flex">
              <Search className="size-4" />
              신청자, 정책, 리소스 검색
            </div>
            <NotificationDropdown />
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  관리자
                </Badge>
                <span className="text-xs text-slate-400">
                  승인 전 위험도와 보완 통제를 함께 확인합니다.
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                예외 신청 검토
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                운영 영향, 만료일, 보완 통제를 기준으로 예외 신청을 승인하거나
                거절합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                disabled={isRefreshing}
                onClick={() => void loadRequests()}
              >
                <RefreshCw
                  className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
                {isRefreshing ? "불러오는 중..." : "새로고침"}
              </Button>
              <Button
                onClick={() => setIsStandardsOpen(true)}
                className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
              >
                <SlidersHorizontal className="size-4" />
                승인 기준 설정
              </Button>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(
              ({ label, value, detail, icon: Icon, className }) => (
                <article
                  key={label}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${className}`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <span className="text-[11px] font-medium text-slate-400">
                      live
                    </span>
                  </div>
                  <p className="mt-5 text-[13px] text-slate-500">{label}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight">
                    {value}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
                </article>
              ),
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">신청 목록</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    총 {requests.length}건 중 {filteredRequests.length}건을
                    표시합니다.
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="정책명, 리소스, 신청자 검색"
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-3 focus:ring-blue-500/10 lg:w-72"
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                    onClick={resetFilters}
                  >
                    <Filter className="size-4" />
                    필터 초기화
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    처리 상태
                  </span>
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(
                        event.target.value as "all" | ExceptionRequestStatus,
                      )
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    {statusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "all"
                          ? "전체 상태"
                          : exceptionStatusLabel[option]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    위험도
                  </span>
                  <select
                    value={riskLevel}
                    onChange={(event) =>
                      setRiskLevel(
                        event.target.value as "all" | ExceptionRiskLevel,
                      )
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    {riskOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "all"
                          ? "전체 위험도"
                          : exceptionRiskLabel[option]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    클러스터
                  </span>
                  <select
                    value={cluster}
                    onChange={(event) => setCluster(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    <option value="all">전체 클러스터</option>
                    {clusters.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    네임스페이스
                  </span>
                  <select
                    value={namespace}
                    onChange={(event) => setNamespace(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    <option value="all">전체 네임스페이스</option>
                    {namespaces.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="w-[190px] px-5 text-xs text-slate-500 sm:px-6">
                    신청 번호
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">대상</TableHead>
                  <TableHead className="text-xs text-slate-500">
                    신청자
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">
                    위험도
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">기간</TableHead>
                  <TableHead className="text-xs text-slate-500">상태</TableHead>
                  <TableHead className="min-w-[260px] text-xs text-slate-500">
                    보완 통제
                  </TableHead>
                  <TableHead className="w-[120px] text-xs text-slate-500">
                    조치
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 4 }).map((_, index) => (
                      <TableRow key={`loading-${index}`}>
                        <TableCell className="px-5 py-4 sm:px-6">
                          <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
                          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-44 animate-pulse rounded bg-slate-100" />
                          <div className="mt-2 h-3 w-36 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                          <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-6 w-14 animate-pulse rounded-full bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-56 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4 pr-5 sm:pr-6">
                          <div className="h-8 w-20 animate-pulse rounded-lg bg-slate-100" />
                        </TableCell>
                      </TableRow>
                    ))
                  : filteredRequests.map((request) => {
                      const StatusIcon = statusIcon[request.status];

                      return (
                        <TableRow
                          key={request.id}
                          className="hover:bg-slate-50/70"
                        >
                          <TableCell className="px-5 py-4 sm:px-6">
                            <div>
                              <p className="text-xs font-semibold text-slate-900">
                                {request.id}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-400">
                                {request.requestedAt} 신청
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 sm:flex">
                                <FileClock className="size-4.5" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-slate-900">
                                  {request.policyName}
                                </p>
                                <p className="mt-1 truncate text-[11px] text-slate-400">
                                  {request.resourceKind} /{" "}
                                  {request.resourceName} / {request.namespace}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <p className="text-xs font-medium text-slate-800">
                              {request.requester}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {request.team} · {request.clusterName}
                            </p>
                          </TableCell>
                          <TableCell className="py-4">
                            <Badge
                              className={
                                exceptionRiskClassName[request.riskLevel]
                              }
                            >
                              {exceptionRiskLabel[request.riskLevel]}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-4">
                            <p className="text-xs text-slate-600">
                              {request.requestedAt}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              만료 {request.expiresAt}
                            </p>
                          </TableCell>
                          <TableCell className="py-4">
                            <Badge
                              className={
                                exceptionStatusClassName[request.status]
                              }
                            >
                              <StatusIcon className="size-3" />
                              {exceptionStatusLabel[request.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[360px] py-4">
                            <p className="line-clamp-2 break-all text-xs leading-5 text-slate-500">
                              {request.compensatingControl}
                            </p>
                          </TableCell>
                          <TableCell className="py-4 pr-5 sm:pr-6">
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="rounded-lg border-slate-200 bg-white text-slate-700"
                            >
                              <Link href={`/admin/exceptions/${request.id}`}>
                                상세 검토
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>

            {!isLoading && errorMessage ? (
              <div className="border-t border-rose-100 bg-rose-50 px-5 py-6 text-sm text-rose-700 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{errorMessage}</span>
                  <Button
                    variant="outline"
                    className="h-9 rounded-lg border-rose-200 bg-white text-rose-700"
                    onClick={() => void loadRequests()}
                  >
                    다시 시도
                  </Button>
                </div>
              </div>
            ) : null}

            {!isLoading && !errorMessage && filteredRequests.length === 0 ? (
              <div className="border-t border-slate-100 px-5 py-10 text-center sm:px-6">
                <p className="text-sm font-medium text-slate-700">
                  조건에 맞는 예외 신청이 없습니다.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  사용자 예외 신청이 생성되면 이 목록에 표시됩니다.
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <ProcessingStandardsDialog
        open={isStandardsOpen}
        onOpenChange={setIsStandardsOpen}
        defaultTab="approval"
      />
    </main>
  );
}
