"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
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
import {
  exceptionClassName,
  exceptionLabel,
  getViolations,
  policyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
  type PolicyViolation,
  type ViolationSeverity,
  type ViolationStatus,
} from "@/lib/policy-violations";
import { useEffect } from "react";

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

export default function AdminViolationsPage() {
  const [violations, setViolations] = useState<PolicyViolation[]>(policyViolations);
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState("all");
  const [policy, setPolicy] = useState("all");
  const [rule, setRule] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [severity, setSeverity] = useState<"all" | ViolationSeverity>("all");
  const [status, setStatus] = useState<"all" | ViolationStatus>("all");

  useEffect(() => {
    let isMounted = true;
    getViolations().then((data) => {
      if (isMounted && data.length > 0) {
        setViolations(data);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

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
        .filter((item) => item.severity === "critical" || item.severity === "high")
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

  const clusters = useMemo(
    () => Array.from(new Set(violations.map((item) => item.clusterName))),
    [violations],
  );
  const policies = useMemo(
    () => Array.from(new Set(violations.map((item) => item.policyName))),
    [violations],
  );
  const rules = useMemo(
    () => Array.from(new Set(violations.map((item) => item.ruleName))),
    [violations],
  );
  const namespaces = useMemo(
    () => Array.from(new Set(violations.map((item) => item.namespace))),
    [violations],
  );

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
        (cluster === "all" || violation.clusterName === cluster) &&
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
              관리자
            </Badge>
            <span className="text-xs text-slate-400">
              ViolationHistory 기준 확장 예정
            </span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            정책 오류 목록
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            정책명, 규칙명, 발생 시각을 중심으로 위반 이력을 추적하고 조치 대상과 예외 상태를 확인합니다.
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
              <div
                className={`flex size-10 items-center justify-center rounded-xl ${className}`}
              >
                <Icon className="size-5" />
              </div>
              <span className="text-[11px] font-medium text-slate-400">
                mock
              </span>
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
              <h3 className="text-sm font-semibold">오류 이력</h3>
              <p className="mt-1 text-xs text-slate-400">
                총 {policyViolations.length}건 중 {filteredViolations.length}건을 표시합니다.
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
            <FilterSelect label="클러스터" value={cluster} onChange={setCluster}>
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
            <FilterSelect label="Namespace" value={namespace} onChange={setNamespace}>
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
              onChange={(value) => setSeverity(value as "all" | ViolationSeverity)}
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

        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className="w-[280px] px-5 text-xs text-slate-500 sm:px-6">
                정책 / 규칙
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
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {violation.ruleName} · {violation.clusterName} · {violation.assignee}
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
            조건에 맞는 정책 오류가 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredViolations.length} / {policyViolations.length}개 항목
          </span>
          <span>현재는 목업 데이터이며 이후 ViolationHistory API와 연결합니다.</span>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <StatusNote
          icon={AlertTriangle}
          title="긴급 조치 기준"
          description="production high 이상 우선 검토"
          className="bg-rose-50 text-rose-600"
        />
        <StatusNote
          icon={Clock3}
          title="예외 신청 대기"
          description="검토 중인 예외 신청 1건"
          className="bg-violet-50 text-violet-600"
        />
        <StatusNote
          icon={ShieldCheck}
          title="최근 해결"
          description="1건이 정책 검사를 통과했습니다."
          className="bg-emerald-50 text-emerald-600"
        />
      </section>
    </DashboardPageShell>
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
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  className: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className={`flex size-9 items-center justify-center rounded-xl ${className}`}>
          <Icon className="size-4.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>
      </div>
    </article>
  );
}
