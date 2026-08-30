"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataStore } from "@/lib/data-store";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock3,
  FilePlus2,
  FileSearch,
  Filter,
  Menu,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { NotificationDropdown } from "@/components/dashboard/notification-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequest,
  type ExceptionRequestStatus,
} from "@/lib/exception-requests";

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

const statusIcon: Record<ExceptionRequestStatus, typeof Clock3> = {
  pending: Clock3,
  applying: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  cancelling: Clock3,
  expiring: AlertCircle,
  expired: AlertCircle,
  cancelled: XCircle,
  failed: AlertCircle,
};

export default function MyExceptionRequestsPage() {
  const cachedRequests = useDataStore((state) => state.exceptions);
  const fetchExceptions = useDataStore((state) => state.fetchExceptions);
  const exceptionsLoading = useDataStore((state) => state.exceptionsLoading);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ExceptionRequestStatus>("all");
  const [policyName, setPolicyName] = useState("all");
  const [clusterName, setClusterName] = useState("all");

  const loadRequests = useCallback(async () => {
    setErrorMessage(null);
    try {
      await fetchExceptions();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "예외 신청 내역을 불러오지 못했습니다.",
      );
    }
  }, [fetchExceptions]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const requests = useMemo(() => cachedRequests ?? [], [cachedRequests]);
  const isLoading = cachedRequests === null && exceptionsLoading;

  const policies = useMemo(
    () => Array.from(new Set(requests.map((request) => request.policyName))),
    [requests],
  );
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
          request.reason,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (status === "all" || request.status === status) &&
        (policyName === "all" || request.policyName === policyName) &&
        (clusterName === "all" ||
          (request.targetClusterId ?? request.clusterName) === clusterName)
      );
    });
  }, [clusterName, policyName, query, requests, status]);

  const summaryCards = [
    {
      label: "전체 신청",
      value: requests.length.toString(),
      detail: "내가 신청한 예외",
      icon: FileSearch,
      className: "bg-blue-50 text-blue-600",
    },
    {
      label: "승인 대기",
      value: requests
        .filter(
          (item) => item.status === "pending" || item.status === "applying",
        )
        .length.toString(),
      detail: "관리자 검토 필요",
      icon: Clock3,
      className: "bg-amber-50 text-amber-600",
    },
    {
      label: "승인",
      value: requests
        .filter((item) => item.status === "approved")
        .length.toString(),
      detail: "현재 적용 중",
      icon: CheckCircle2,
      className: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "종료",
      value: requests
        .filter((item) =>
          ["rejected", "expired", "cancelled", "failed"].includes(item.status),
        )
        .length.toString(),
      detail: "재신청 또는 조치 필요",
      icon: XCircle,
      className: "bg-rose-50 text-rose-600",
    },
  ];

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setPolicyName("all");
    setClusterName("all");
  }

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="user" activeHref="/exceptions" />

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
              내 예외 신청
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              내가 신청한 정책 예외의 처리 상태와 만료일을 확인하세요.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              className="hidden h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] sm:inline-flex"
            >
              <Link href="/exceptions/new">
                <FilePlus2 className="size-4" />
                예외 신청
              </Link>
            </Button>
            <NotificationDropdown />
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  사용자
                </Badge>
                <span className="text-xs text-slate-400">
                  최근 신청일 기준으로 정렬되었습니다.
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                신청 내역
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                승인 대기, 승인, 거절, 만료 상태를 확인하고 필요한 경우 새
                예외를 신청합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                onClick={() => void loadRequests()}
              >
                <SlidersHorizontal className="size-4" />
                새로고침
              </Button>
              <Button
                asChild
                className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
              >
                <Link href="/exceptions/new">
                  <FilePlus2 className="size-4" />새 신청
                </Link>
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
                      mine
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
                  <h3 className="text-sm font-semibold">신청 내역 검색</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    총 {requests.length}건 중 {filteredRequests.length}건을
                    표시합니다.
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="정책명 또는 신청 사유 검색"
                      className="h-10 w-full rounded-xl border-slate-200 bg-slate-50 pr-3 pl-9 text-xs lg:w-72"
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

              <div className="mt-4 grid gap-3 md:grid-cols-3">
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
                    정책
                  </span>
                  <select
                    value={policyName}
                    onChange={(event) => setPolicyName(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    <option value="all">전체 정책</option>
                    {policies.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    클러스터
                  </span>
                  <select
                    value={clusterName}
                    onChange={(event) => setClusterName(event.target.value)}
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
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="w-[210px] px-5 text-xs text-slate-500 sm:px-6">
                    신청 번호
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">
                    정책명
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">
                    신청 사유
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">
                    신청일
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">
                    만료일
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">
                    처리 상태
                  </TableHead>
                  <TableHead className="w-20 text-xs text-slate-500">
                    상세
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
                          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                          <div className="mt-2 h-3 w-28 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-56 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
                        </TableCell>
                        <TableCell className="py-4 pr-5 sm:pr-6">
                          <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-100" />
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
                                {request.clusterName} · {request.namespace}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 sm:flex">
                                <ShieldAlert className="size-4.5" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-slate-900">
                                  {request.policyName}
                                </p>
                                <p className="mt-1 truncate text-[11px] text-slate-400">
                                  {request.resourceKind} /{" "}
                                  {request.resourceName}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[360px] py-4">
                            <p className="line-clamp-2 break-all text-xs leading-5 text-slate-500">
                              {request.reason}
                            </p>
                          </TableCell>
                          <TableCell className="py-4 text-xs text-slate-500">
                            {request.requestedAt}
                          </TableCell>
                          <TableCell className="py-4 text-xs text-slate-500">
                            {request.expiresAt}
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
                          <TableCell className="py-4 pr-5 sm:pr-6">
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="rounded-lg border-slate-200 bg-white"
                            >
                              <Link href={`/exceptions/${request.id}`}>
                                보기
                                <ArrowRight className="size-3.5" />
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
                  필요한 경우 새 예외 신청을 생성하세요.
                </p>
                <Button
                  asChild
                  className="mt-5 h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
                >
                  <Link href="/exceptions/new">
                    <FilePlus2 className="size-4" />새 신청
                  </Link>
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
