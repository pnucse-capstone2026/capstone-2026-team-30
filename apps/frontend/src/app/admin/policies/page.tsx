"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  Filter,
  Search,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
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
  getPolicies,
  kyvernoPolicies,
  policyModeLabel,
  policyStatusClassName,
  policyStatusLabel,
  policyTypeClassName,
  policyTypeLabel,
  type KyvernoPolicy,
  type PolicyMode,
  type PolicyScope,
  type PolicyStatus,
  type PolicyType,
} from "@/lib/policies";

type TypeFilter = "all" | PolicyType;
type ScopeFilter = "all" | PolicyScope;
type ModeFilter = "all" | PolicyMode;
type StatusFilter = "all" | PolicyStatus;

const typeOptions: PolicyType[] = ["validate", "mutate", "generate"];
const scopeOptions: PolicyScope[] = ["ClusterPolicy", "Policy"];
const modeOptions: PolicyMode[] = ["enforce", "audit"];
const statusOptions: PolicyStatus[] = ["active", "warning", "draft"];

export default function AdminPoliciesPage() {
  const [policies, setPolicies] = useState<KyvernoPolicy[]>(kyvernoPolicies);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [clusterFilter, setClusterFilter] = useState("all");

  useEffect(() => {
    let isMounted = true;
    getPolicies().then((data) => {
      if (isMounted && data.length > 0) {
        setPolicies(data);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const clusters = useMemo(
    () => Array.from(new Set(policies.map((p) => p.clusterName))),
    [policies],
  );

  const filteredPolicies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return policies.filter((policy) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          policy.name,
          policy.description,
          policy.owner,
          policy.clusterName,
          policy.namespace ?? "",
          policy.type,
          policy.scope,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (typeFilter === "all" || policy.type === typeFilter) &&
        (scopeFilter === "all" || policy.scope === scopeFilter) &&
        (modeFilter === "all" || policy.mode === modeFilter) &&
        (statusFilter === "all" || policy.status === statusFilter) &&
        (clusterFilter === "all" || policy.clusterName === clusterFilter)
      );
    });
  }, [policies, clusterFilter, modeFilter, query, scopeFilter, statusFilter, typeFilter]);

  const activePolicies = policies.filter(
    (policy) => policy.status === "active",
  ).length;
  const warningPolicies = policies.filter(
    (policy) => policy.status === "warning",
  ).length;
  const totalViolations = policies.reduce(
    (sum, policy) => sum + policy.violationCount,
    0,
  );

  function resetFilters() {
    setQuery("");
    setTypeFilter("all");
    setScopeFilter("all");
    setModeFilter("all");
    setStatusFilter("all");
    setClusterFilter("all");
  }

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/policies"
      title="정책 목록"
      description="Kyverno 정책의 적용 범위와 운영 상태를 확인합니다."
      actions={
        <Button
          asChild
          className="hidden h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] sm:inline-flex"
        >
          <Link href="/admin/policies/new">
            <FilePlus2 className="size-4" />
            정책 등록
          </Link>
        </Button>
      }
    >
      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="전체 정책"
          value={String(kyvernoPolicies.length)}
          detail="목업 정책"
          icon={ShieldCheck}
          className="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="정상 정책"
          value={String(activePolicies)}
          detail="주의 없음"
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
        />
        <SummaryCard
          label="주의 필요"
          value={String(warningPolicies)}
          detail="위반 발생 정책"
          icon={AlertTriangle}
          className="bg-amber-50 text-amber-600"
        />
        <SummaryCard
          label="연결된 오류"
          value={String(totalViolations)}
          detail="정책 위반 합계"
          icon={ShieldAlert}
          className="bg-rose-50 text-rose-600"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  Kyverno
                </Badge>
                <span className="text-xs text-slate-400">
                  Kubernetes API 연동 전 목업 데이터
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                정책 운영 현황
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                정책 유형, 적용 범위, 모드, 상태, 클러스터 기준으로 운영 중인 정책을 확인합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="정책명, 설명, 담당자 검색"
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <FilterSelect
              label="유형"
              value={typeFilter}
              onChange={(value) => setTypeFilter(value as TypeFilter)}
            >
              <option value="all">전체 유형</option>
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {policyTypeLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="범위"
              value={scopeFilter}
              onChange={(value) => setScopeFilter(value as ScopeFilter)}
            >
              <option value="all">전체 범위</option>
              {scopeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="모드"
              value={modeFilter}
              onChange={(value) => setModeFilter(value as ModeFilter)}
            >
              <option value="all">전체 모드</option>
              {modeOptions.map((option) => (
                <option key={option} value={option}>
                  {policyModeLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="상태"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <option value="all">전체 상태</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {policyStatusLabel[option]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="클러스터" value={clusterFilter} onChange={setClusterFilter}>
              <option value="all">전체 클러스터</option>
              {clusters.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className="w-[300px] px-5 text-xs text-slate-500 sm:px-6">
                정책
              </TableHead>
              <TableHead className="text-xs text-slate-500">유형</TableHead>
              <TableHead className="text-xs text-slate-500">범위</TableHead>
              <TableHead className="text-xs text-slate-500">모드</TableHead>
              <TableHead className="text-xs text-slate-500">상태</TableHead>
              <TableHead className="text-xs text-slate-500">규칙/오류</TableHead>
              <TableHead className="text-xs text-slate-500">최근 수정</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPolicies.map((policy) => (
              <TableRow key={policy.id} className="hover:bg-slate-50/70">
                <TableCell className="px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <ShieldCheck className="size-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-950">
                        {policy.name}
                      </p>
                      <p className="mt-1 line-clamp-1 text-[11px] text-slate-400">
                        {policy.description}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-4">
                  <Badge className={policyTypeClassName[policy.type]}>
                    {policyTypeLabel[policy.type]}
                  </Badge>
                </TableCell>
                <TableCell className="py-4">
                  <div>
                    <p className="text-xs font-medium text-slate-800">
                      {policy.scope}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {policy.namespace ?? "cluster-wide"}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="py-4">
                  <Badge className="bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                    {policyModeLabel[policy.mode]}
                  </Badge>
                </TableCell>
                <TableCell className="py-4">
                  <Badge className={policyStatusClassName[policy.status]}>
                    {policyStatusLabel[policy.status]}
                  </Badge>
                </TableCell>
                <TableCell className="py-4">
                  <p className="text-xs font-medium text-slate-800">
                    규칙 {policy.ruleCount}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    오류 {policy.violationCount}
                  </p>
                </TableCell>
                <TableCell className="py-4">
                  <p className="text-xs text-slate-600">{policy.updatedAt}</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {policy.owner} · {policy.clusterName}
                  </p>
                </TableCell>
                <TableCell className="py-4 pr-5 sm:pr-6">
                  <Link
                    href={`/admin/policies/${policy.id}`}
                    aria-label={`${policy.name} 상세 보기`}
                    className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredPolicies.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 정책이 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredPolicies.length} / {kyvernoPolicies.length}개 정책 표시
          </span>
          <span>이후 Kyverno 정책 API 응답으로 목록 데이터를 교체합니다.</span>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <StatusNote
          title="정책 등록"
          description="YAML 또는 폼 기반 등록 화면으로 이동합니다."
          href="/admin/policies/new"
          icon={FilePlus2}
        />
        <StatusNote
          title="처리 기준"
          description="정책 오류와 예외 승인 기준을 함께 점검합니다."
          href="/admin/violations"
          icon={SlidersHorizontal}
        />
        <StatusNote
          title="클러스터 적용"
          description="클러스터별 정책 동기화 상태를 확인합니다."
          href="/admin/clusters"
          icon={ShieldCheck}
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
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof ShieldCheck;
  className: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div className={`flex size-10 items-center justify-center rounded-xl ${className}`}>
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
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
  icon: typeof FilePlus2;
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
