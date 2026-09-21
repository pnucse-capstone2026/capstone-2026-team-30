"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
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
  exceptionClassName,
  exceptionLabel,
  getViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
  type PolicyViolation,
  type ViolationSeverity,
  type ViolationStatus,
} from "@/lib/policy-violations";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/export-utils";
import { ProcessingStandardsDialog } from "@/components/violations/processing-standards-dialog";

const severityOptions: Array<"all" | ViolationSeverity> = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
];
const statusOptions: Array<"all" | ViolationStatus> = [
  "all",
  "open",
  "inReview",
  "resolved",
];

/**
 * 관리자용 정책 위반 오류 목록 본문 컴포넌트입니다.
 * URL 쿼리 파라미터(policy, cluster 등)를 감지하여 초기 필터 상태로 자동 적용합니다.
 */
function AdminViolationsContent() {
  const searchParams = useSearchParams();

  const initialPolicy = searchParams.get("policy") || "all";
  const initialCluster = searchParams.get("cluster") || "all";
  const initialRule = searchParams.get("rule") || "all";
  const initialNamespace = searchParams.get("namespace") || "all";
  const initialSeverity =
    (searchParams.get("severity") as "all" | ViolationSeverity) || "all";
  const initialStatus =
    (searchParams.get("status") as "all" | ViolationStatus) || "all";
  const initialQuery = searchParams.get("query") || "";

  const [query, setQuery] = useState(initialQuery);
  const [cluster, setCluster] = useState(initialCluster);
  const [policy, setPolicy] = useState(initialPolicy);
  const [rule, setRule] = useState(initialRule);
  const [namespace, setNamespace] = useState(initialNamespace);
  const [severity, setSeverity] = useState<"all" | ViolationSeverity>(
    initialSeverity,
  );
  const [status, setStatus] = useState<"all" | ViolationStatus>(initialStatus);
  const [isStandardsOpen, setIsStandardsOpen] = useState(false);

  // URL 쿼리 파라미터 변경 시 필터 상태를 동기화합니다.
  useEffect(() => {
    const p = searchParams.get("policy");
    if (p !== null) setPolicy(p || "all");
    const c = searchParams.get("cluster");
    if (c !== null) setCluster(c || "all");
    const r = searchParams.get("rule");
    if (r !== null) setRule(r || "all");
    const ns = searchParams.get("namespace");
    if (ns !== null) setNamespace(ns || "all");
    const q = searchParams.get("query");
    if (q !== null) setQuery(q || "");
    const sev = searchParams.get("severity") as
      | ("all" | ViolationSeverity)
      | null;
    if (sev !== null && (sev === "all" || severityOptions.includes(sev))) {
      setSeverity(sev);
    }
    const st = searchParams.get("status") as ("all" | ViolationStatus) | null;
    if (st !== null && (st === "all" || statusOptions.includes(st))) {
      setStatus(st);
    }
  }, [searchParams]);

  const liveViolations = useDataStore((state) => state.violations);
  const fetchViolations = useDataStore((state) => state.fetchViolations);

  const initializeAuth = useAuthStore((state) => state.initialize);

  const loadViolations = useCallback(async () => {
    try {
      await initializeAuth();
      await fetchViolations(true);
    } catch {
      // Graceful fallback
    }
  }, [fetchViolations, initializeAuth]);

  useEffect(() => {
    void loadViolations();
  }, [loadViolations]);

  const violations = liveViolations ?? [];
  const isLive = liveViolations !== null;

  const summaryCards = [
    {
      label: "전체 오류",
      value: violations.length.toString(),
      detail: "감지된 정책 위반 이력",
      icon: ShieldAlert,
      className: "bg-amber-50 text-amber-600",
    },
    {
      label: "긴급 처리",
      value: violations
        .filter(
          (item) => item.severity === "critical" || item.severity === "high",
        )
        .length.toString(),
      detail: "긴급 또는 높음",
      icon: AlertTriangle,
      className: "bg-rose-50 text-rose-600",
    },
    {
      label: "검토 중",
      value: violations
        .filter((item) => item.status === "inReview")
        .length.toString(),
      detail: "담당자 확인 진행",
      icon: Clock3,
      className: "bg-blue-50 text-blue-600",
    },
    {
      label: "해결 완료",
      value: violations
        .filter((item) => item.status === "resolved")
        .length.toString(),
      detail: "정책 재검사 통과",
      icon: CheckCircle2,
      className: "bg-emerald-50 text-emerald-600",
    },
  ];

  const clusters = useMemo(() => {
    const list = Array.from(
      new Set(violations.map((item) => item.clusterName)),
    );
    if (cluster !== "all" && !list.includes(cluster)) {
      list.push(cluster);
    }
    return list;
  }, [violations, cluster]);

  const policies = useMemo(() => {
    const list = Array.from(new Set(violations.map((item) => item.policyName)));
    if (policy !== "all" && !list.includes(policy)) {
      list.push(policy);
    }
    return list;
  }, [violations, policy]);

  const rules = useMemo(() => {
    const list = Array.from(new Set(violations.map((item) => item.ruleName)));
    if (rule !== "all" && !list.includes(rule)) {
      list.push(rule);
    }
    return list;
  }, [violations, rule]);

  const namespaces = useMemo(() => {
    const list = Array.from(new Set(violations.map((item) => item.namespace)));
    if (namespace !== "all" && !list.includes(namespace)) {
      list.push(namespace);
    }
    return list;
  }, [violations, namespace]);

  const filteredViolations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return violations.filter((violation) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          violation.policyName,
          violation.ruleName,
          violation.resourceKind,
          violation.resourceName,
          violation.namespace,
          violation.clusterName,
          violation.assignee,
          violation.message,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (cluster === "all" ||
          violation.clusterName === cluster ||
          violation.clusterId === cluster) &&
        (policy === "all" || violation.policyName === policy) &&
        (rule === "all" || violation.ruleName === rule) &&
        (namespace === "all" || violation.namespace === namespace) &&
        (severity === "all" || violation.severity === severity) &&
        (status === "all" || violation.status === status)
      );
    });
  }, [violations, cluster, namespace, policy, query, rule, severity, status]);

  function resetFilters() {
    setQuery("");
    setCluster("all");
    setPolicy("all");
    setRule("all");
    setNamespace("all");
    setSeverity("all");
    setStatus("all");
  }

  const handleExport = () => {
    if (filteredViolations.length === 0) {
      toast.error("내보낼 정책 오류 데이터가 없습니다.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    exportToCSV(
      `policy-violations-${today}.csv`,
      [
        { key: "id", label: "오류 ID" },
        { key: "policyName", label: "정책명" },
        { key: "ruleName", label: "규칙명" },
        { key: "clusterName", label: "클러스터" },
        { key: "namespace", label: "네임스페이스" },
        { key: "resourceKind", label: "리소스 종류" },
        { key: "resourceName", label: "리소스명" },
        { key: "severity", label: "심각도" },
        { key: "status", label: "처리 상태" },
        { key: "exceptionStatus", label: "예외 상태" },
        { key: "assignee", label: "담당자" },
        { key: "detectedAt", label: "발생 시간" },
        { key: "message", label: "오류 메시지" },
      ],
      filteredViolations,
    );
    toast.success(
      `${filteredViolations.length}건의 정책 오류 목록을 CSV 파일로 내보냈습니다.`,
    );
  };

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/violations"
      title="정책 오류 관리"
      description="Kyverno 정책 위반 이력과 처리 상태를 확인합니다."
      actions={
        <div className="hidden h-10 w-64 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-400 md:flex">
          <Search className="size-4" />
          정책, 규칙, 리소스 검색
        </div>
      }
    >
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            정책 오류 목록
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            정책명, 규칙명, 발생 시각을 중심으로 위반 이력을 추적하고 조치
            대상과 예외 상태를 확인합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <Download className="size-4" />
            내보내기
          </Button>
          <Button
            onClick={() => setIsStandardsOpen(true)}
            className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
          >
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
              <div
                className={`flex size-10 items-center justify-center rounded-xl ${className}`}
              >
                <Icon className="size-5" />
              </div>
            </div>
            <p className="mt-5 text-[13px] text-slate-500">{label}</p>
            {liveViolations === null ? (
              <Skeleton className="mt-1 h-9 w-20 rounded-lg" />
            ) : (
              <p className="mt-1 text-3xl font-semibold tracking-tight">
                {value}
              </p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h3 className="text-sm font-semibold">오류 이력</h3>
              <p className="mt-1 text-xs text-slate-400">
                총 {violations.length}건 중 {filteredViolations.length}건을
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
                  placeholder="정책명, 규칙명, 리소스 검색"
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <FilterSelect
              label="클러스터"
              value={cluster}
              onChange={setCluster}
            >
              <option value="all">전체 클러스터</option>
              {clusters.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="정책" value={policy} onChange={setPolicy}>
              <option value="all">전체 정책</option>
              {policies.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="규칙" value={rule} onChange={setRule}>
              <option value="all">전체 규칙</option>
              {rules.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Namespace"
              value={namespace}
              onChange={setNamespace}
            >
              <option value="all">전체 Namespace</option>
              {namespaces.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="심각도"
              value={severity}
              onChange={(value) =>
                setSeverity(value as "all" | ViolationSeverity)
              }
            >
              {severityOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "전체 심각도" : severityLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="처리 상태"
              value={status}
              onChange={(value) => setStatus(value as "all" | ViolationStatus)}
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "전체 상태" : statusLabel[option]}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        {/* 독립 수직 스크롤 컨테이너 & Sticky Header */}
        <div className="max-h-[calc(100vh-380px)] min-h-[400px] overflow-y-auto overflow-x-auto relative">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-[0_1px_0_rgba(0,0,0,0.05)]">
              <TableRow className="bg-slate-50/95 hover:bg-slate-50/95">
                <TableHead className="w-[280px] px-5 text-xs font-semibold text-slate-600 sm:px-6">
                  정책 / 규칙
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-600">리소스</TableHead>
                <TableHead className="text-xs font-semibold text-slate-600">
                  Namespace
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-600">심각도</TableHead>
                <TableHead className="text-xs font-semibold text-slate-600">
                  처리 상태
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-600">예외</TableHead>
                <TableHead className="text-xs font-semibold text-slate-600">
                  발생 시간
                </TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
            {liveViolations === null
              ? [1, 2, 3].map((key) => (
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
              : filteredViolations.map((violation) => (
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
                          <p className="mt-1 truncate text-[11px] text-slate-400">
                            {violation.ruleName} · {violation.clusterName} ·{" "}
                            {violation.assignee}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <div>
                        <p className="text-xs font-medium text-slate-800">
                          {violation.resourceKind}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {violation.resourceName}
                        </p>
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
                        <Badge
                          asChild
                          className={
                            exceptionClassName[violation.exceptionStatus]
                          }
                        >
                          <Link
                            href={`/admin/exceptions/${violation.relatedExceptionId}`}
                          >
                            {exceptionLabel[violation.exceptionStatus]}
                          </Link>
                        </Badge>
                      ) : (
                        <Badge
                          className={
                            exceptionClassName[violation.exceptionStatus]
                          }
                        >
                          {exceptionLabel[violation.exceptionStatus]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-4 text-xs text-slate-500">
                      {violation.detectedAt}
                    </TableCell>
                    <TableCell className="py-4 pr-5 sm:pr-6">
                      <Link
                        href={`/admin/violations/${encodeURIComponent(violation.id)}`}
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
      </div>

        {filteredViolations.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 정책 오류가 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredViolations.length} / {violations.length}개 항목
          </span>
          <span>정책 위반 및 예외 관리 현황</span>
        </div>
      </section>

      <ProcessingStandardsDialog
        open={isStandardsOpen}
        onOpenChange={setIsStandardsOpen}
      />
    </DashboardPageShell>
  );
}

/**
 * 관리자용 정책 오류 관리 페이지 컴포넌트입니다.
 * useSearchParams 훅을 사용하는 하위 컨텐츠 컴포넌트를 Suspense로 래핑합니다.
 */
export default function AdminViolationsPage() {
  return (
    <Suspense
      fallback={
        <DashboardPageShell
          variant="admin"
          activeHref="/admin/violations"
          title="정책 오류 관리"
          description="Kyverno 정책 위반 이력과 처리 상태를 확인합니다."
        >
          <div className="space-y-6">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        </DashboardPageShell>
      }
    >
      <AdminViolationsContent />
    </Suspense>
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
