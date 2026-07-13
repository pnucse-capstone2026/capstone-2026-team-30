"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  Menu,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
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
import {
  exceptionClassName,
  exceptionLabel,
  policyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
  type ViolationSeverity,
  type ViolationStatus,
} from "@/lib/policy-violations";

const severityOptions: Array<"all" | ViolationSeverity> = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
];
const statusOptions: Array<"all" | ViolationStatus> = ["all", "open", "inReview", "resolved"];

const summaryCards = [
  {
    label: "전체 위반",
    value: policyViolations.length.toString(),
    detail: "최근 24시간 기준",
    icon: ShieldAlert,
    className: "bg-amber-50 text-amber-600",
  },
  {
    label: "긴급 처리",
    value: policyViolations
      .filter((item) => item.severity === "critical" || item.severity === "high")
      .length.toString(),
    detail: "긴급 또는 높음",
    icon: AlertTriangle,
    className: "bg-rose-50 text-rose-600",
  },
  {
    label: "검토 중",
    value: policyViolations.filter((item) => item.status === "inReview").length.toString(),
    detail: "담당자 확인 진행",
    icon: Clock3,
    className: "bg-blue-50 text-blue-600",
  },
  {
    label: "해결 완료",
    value: policyViolations.filter((item) => item.status === "resolved").length.toString(),
    detail: "정책 재검사 통과",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-600",
  },
];

export default function AdminViolationsPage() {
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState("all");
  const [policy, setPolicy] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [severity, setSeverity] = useState<"all" | ViolationSeverity>("all");
  const [status, setStatus] = useState<"all" | ViolationStatus>("all");

  const clusters = useMemo(
    () => Array.from(new Set(policyViolations.map((item) => item.clusterName))),
    [],
  );
  const policies = useMemo(
    () => Array.from(new Set(policyViolations.map((item) => item.policyName))),
    [],
  );
  const namespaces = useMemo(
    () => Array.from(new Set(policyViolations.map((item) => item.namespace))),
    [],
  );

  const filteredViolations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return policyViolations.filter((violation) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          violation.policyName,
          violation.resourceKind,
          violation.resourceName,
          violation.namespace,
          violation.clusterName,
          violation.assignee,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (cluster === "all" || violation.clusterName === cluster) &&
        (policy === "all" || violation.policyName === policy) &&
        (namespace === "all" || violation.namespace === namespace) &&
        (severity === "all" || violation.severity === severity) &&
        (status === "all" || violation.status === status)
      );
    });
  }, [cluster, namespace, policy, query, severity, status]);

  function resetFilters() {
    setQuery("");
    setCluster("all");
    setPolicy("all");
    setNamespace("all");
    setSeverity("all");
    setStatus("all");
  }

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="admin" activeHref="/admin/violations" />

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
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">정책 위반</h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              Kyverno 정책을 위반한 리소스와 처리 상태를 확인하세요.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden h-10 w-64 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-400 md:flex">
              <Search className="size-4" />
              정책, 리소스, Namespace 검색
            </div>
            <button
              type="button"
              className="relative flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="알림 보기"
            >
              <Bell className="size-4.5" />
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-rose-500" />
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">관리자</Badge>
                <span className="text-xs text-slate-400">2026년 7월 8일 수요일</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">정책 위반 목록</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                클러스터별 정책 위반을 필터링하고, 심각도와 예외 신청 상태를 기준으로 조치 대상을 확인합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
              >
                <Download className="size-4" />
                내보내기
              </Button>
              <Button className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]">
                <SlidersHorizontal className="size-4" />
                처리 기준 설정
              </Button>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(({ label, value, detail, icon: Icon, className }) => (
              <article
                key={label}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="flex items-start justify-between">
                  <div className={`flex size-10 items-center justify-center rounded-xl ${className}`}>
                    <Icon className="size-5" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-400">live</span>
                </div>
                <p className="mt-5 text-[13px] text-slate-500">{label}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
                <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">위반 리소스</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    총 {policyViolations.length}건 중 {filteredViolations.length}건을 표시합니다.
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="정책명 또는 리소스 검색"
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-3 focus:ring-blue-500/10 lg:w-64"
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

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">클러스터</span>
                  <select
                    value={cluster}
                    onChange={(event) => setCluster(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    <option value="all">전체 클러스터</option>
                    {clusters.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">정책</span>
                  <select
                    value={policy}
                    onChange={(event) => setPolicy(event.target.value)}
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
                  <span className="text-[11px] font-medium text-slate-500">Namespace</span>
                  <select
                    value={namespace}
                    onChange={(event) => setNamespace(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    <option value="all">전체 Namespace</option>
                    {namespaces.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">심각도</span>
                  <select
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as "all" | ViolationSeverity)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    {severityOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "all" ? "전체 심각도" : severityLabel[option]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-500">처리 상태</span>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as "all" | ViolationStatus)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                  >
                    {statusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "all" ? "전체 상태" : statusLabel[option]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="w-[260px] px-5 text-xs text-slate-500 sm:px-6">
                    위반 정책
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">리소스</TableHead>
                  <TableHead className="text-xs text-slate-500">Namespace</TableHead>
                  <TableHead className="text-xs text-slate-500">심각도</TableHead>
                  <TableHead className="text-xs text-slate-500">처리 상태</TableHead>
                  <TableHead className="text-xs text-slate-500">예외</TableHead>
                  <TableHead className="text-xs text-slate-500">발생 시간</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredViolations.map((violation) => (
                  <TableRow key={violation.id} className="hover:bg-slate-50/70">
                    <TableCell className="px-5 py-4 sm:px-6">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                          <ShieldAlert className="size-4.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-slate-950">
                            {violation.policyName}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {violation.policyType} · {violation.clusterName} · {violation.assignee}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <div>
                        <p className="text-xs font-medium text-slate-800">{violation.resourceKind}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{violation.resourceName}</p>
                      </div>
                    </TableCell>
                    <TableCell className="py-4 text-xs text-slate-600">
                      {violation.namespace}
                    </TableCell>
                    <TableCell className="py-4">
                      <Badge className={severityClassName[violation.severity]}>
                        {severityLabel[violation.severity]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-4">
                      <Badge className={statusClassName[violation.status]}>
                        {violation.status === "resolved" ? (
                          <CheckCircle2 className="size-3" />
                        ) : violation.status === "open" ? (
                          <XCircle className="size-3" />
                        ) : (
                          <Clock3 className="size-3" />
                        )}
                        {statusLabel[violation.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-4">
                      {violation.relatedExceptionId ? (
                        <Badge asChild className={exceptionClassName[violation.exceptionStatus]}>
                          <Link href={`/admin/exceptions/${violation.relatedExceptionId}`}>
                            {exceptionLabel[violation.exceptionStatus]}
                          </Link>
                        </Badge>
                      ) : (
                        <Badge className={exceptionClassName[violation.exceptionStatus]}>
                          {exceptionLabel[violation.exceptionStatus]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-4 text-xs text-slate-500">
                      {violation.detectedAt}
                    </TableCell>
                    <TableCell className="py-4 pr-5 sm:pr-6">
                      <Link
                        href={`/admin/violations/${violation.id}`}
                        aria-label={`${violation.policyName} 상세 보기`}
                        className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {filteredViolations.length === 0 ? (
              <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
                조건에 맞는 정책 위반이 없습니다.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span>
                1-{filteredViolations.length} / {policyViolations.length}개 항목
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="rounded-lg border-slate-200">
                  이전
                </Button>
                <Button variant="outline" size="sm" className="rounded-lg border-slate-200">
                  다음
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <AlertTriangle className="size-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">긴급 조치 기준</h3>
                  <p className="mt-1 text-xs text-slate-400">production high 이상 우선 검토</p>
                </div>
              </div>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <Clock3 className="size-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">예외 신청 대기</h3>
                  <p className="mt-1 text-xs text-slate-400">검토 중인 예외 신청 1건</p>
                </div>
              </div>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <ShieldCheck className="size-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">최근 해결</h3>
                  <p className="mt-1 text-xs text-slate-400">1건이 정책 검사를 통과했습니다.</p>
                </div>
              </div>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
