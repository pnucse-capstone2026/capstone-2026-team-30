"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
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

const typeOptions: PolicyType[] = [
  "validate",
  "mutate",
  "generate",
  "verifyImages",
];
const scopeOptions: PolicyScope[] = ["ClusterPolicy", "Policy"];
const modeOptions: PolicyMode[] = ["enforce", "audit"];
const statusOptions: PolicyStatus[] = ["active", "warning", "draft"];

export default function AdminPoliciesPage() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [clusterFilter, setClusterFilter] = useState("all");

  const livePolicies = useDataStore((state) => state.policies);
  const fetchPolicies = useDataStore((state) => state.fetchPolicies);
  const policiesLoading = useDataStore((state) => state.policiesLoading);

  const initializeAuth = useAuthStore((state) => state.initialize);

  const loadPolicies = useCallback(async () => {
    try {
      await initializeAuth();
      await fetchPolicies();
    } catch {
      // Graceful fallback
    }
  }, [fetchPolicies, initializeAuth]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const policies = livePolicies ?? kyvernoPolicies;
  const isLive = livePolicies !== null;

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
  }, [
    policies,
    clusterFilter,
    modeFilter,
    query,
    scopeFilter,
    statusFilter,
    typeFilter,
  ]);

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
            onClick={() => void loadPolicies()}
            disabled={policiesLoading}
          >
            <RefreshCw
              className={`size-4 ${policiesLoading ? "animate-spin" : ""}`}
            />
            새로고침
          </Button>
          <Button
            asChild
            className="hidden h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] sm:inline-flex"
          >
            <Link href="/admin/policies/new">
              <FilePlus2 className="size-4" />
              정책 등록
            </Link>
          </Button>
        </div>
      }
    >
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="전체 정책"
          value={String(policies.length)}
          detail="등록된 정책 현황"
          icon={ShieldCheck}
          className="bg-blue-50 text-blue-600"
          loading={livePolicies === null}
        />
        <SummaryCard
          label="정상 정책"
          value={String(activePolicies)}
          detail="주의 없음"
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
          loading={livePolicies === null}
        />
        <SummaryCard
          label="주의 필요"
          value={String(warningPolicies)}
          detail="위반 발생 정책"
          icon={AlertTriangle}
          className="bg-amber-50 text-amber-600"
          loading={livePolicies === null}
        />
        <SummaryCard
          label="연결된 오류"
          value={String(totalViolations)}
          detail="정책 위반 합계"
          icon={ShieldAlert}
          className="bg-rose-50 text-rose-600"
          loading={livePolicies === null}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="border-b border-slate-100 px-5 py-3.5 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                정책 운영 현황
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-slate-500">
                정책 유형, 적용 범위, 모드, 상태, 클러스터 기준으로 운영 중인
                정책을 확인합니다.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="정책명, 설명, 담당자 검색"
                  className="h-9 w-full rounded-xl border-slate-200 bg-slate-50 pr-3 pl-8 text-xs sm:w-64"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-slate-200 bg-white text-xs text-slate-700"
                onClick={resetFilters}
              >
                <Filter className="size-3.5" />
                필터 초기화
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
            <FilterSelect
              label="클러스터"
              value={clusterFilter}
              onChange={setClusterFilter}
            >
              <option value="all">전체 클러스터</option>
              {clusters.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                <TableHead className="w-[300px] max-w-[300px] px-5 py-2.5 text-xs text-slate-500 sm:px-6">
                  정책
                </TableHead>
                <TableHead className="w-[85px] py-2.5 text-xs text-slate-500">
                  유형
                </TableHead>
                <TableHead className="w-[120px] py-2.5 text-xs text-slate-500">
                  범위
                </TableHead>
                <TableHead className="w-[80px] py-2.5 text-xs text-slate-500">
                  모드
                </TableHead>
                <TableHead className="w-[80px] py-2.5 text-xs text-slate-500">
                  상태
                </TableHead>
                <TableHead className="w-[90px] py-2.5 text-xs text-slate-500">
                  규칙/오류
                </TableHead>
                <TableHead className="w-[150px] py-2.5 text-xs text-slate-500">
                  최근 수정
                </TableHead>
                <TableHead className="w-10 py-2.5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {livePolicies === null
                ? [1, 2, 3].map((key) => (
                    <TableRow key={key}>
                      <TableCell className="px-5 py-2.5 sm:px-6">
                        <Skeleton className="h-5 w-48 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-5 w-14 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-5 w-20 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-5 w-14 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-5 w-14 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-5 w-16 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-5 w-24 rounded-lg" />
                      </TableCell>
                      <TableCell className="py-2.5 pr-5 sm:pr-6" />
                    </TableRow>
                  ))
                : filteredPolicies.map((policy) => (
                    <TableRow
                      key={policy.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <TableCell className="max-w-[300px] px-5 py-2.5 sm:px-6">
                        <Link
                          href={`/admin/policies/${encodeURIComponent(policy.id)}`}
                          className="flex items-center gap-3 group min-w-0"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                            <ShieldCheck className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-xs font-semibold text-slate-950 group-hover:text-blue-600 transition-colors"
                              title={policy.name}
                            >
                              {policy.name}
                            </p>
                            <p
                              className="mt-0.5 truncate text-[11px] text-slate-400"
                              title={policy.description}
                            >
                              {policy.description}
                            </p>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap">
                        <Badge className={policyTypeClassName[policy.type]}>
                          {policyTypeLabel[policy.type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap">
                        <div>
                          <p className="text-xs font-medium text-slate-800">
                            {policy.scope}
                          </p>
                          <p
                            className="mt-0.5 max-w-[120px] truncate text-[11px] text-slate-400"
                            title={policy.namespace ?? "cluster-wide"}
                          >
                            {policy.namespace ?? "cluster-wide"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap">
                        <Badge className="bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                          {policyModeLabel[policy.mode]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap">
                        <Badge className={policyStatusClassName[policy.status]}>
                          {policyStatusLabel[policy.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap">
                        <p className="text-xs font-medium text-slate-800">
                          규칙 {policy.ruleCount}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          오류 {policy.violationCount}
                        </p>
                      </TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap">
                        <p className="text-xs text-slate-600">
                          {policy.updatedAt}
                        </p>
                        <p
                          className="mt-0.5 max-w-[150px] truncate text-[11px] text-slate-400"
                          title={`${policy.owner} · ${policy.clusterDisplayName ?? policy.clusterName}`}
                        >
                          {policy.owner} ·{" "}
                          {policy.clusterDisplayName ?? policy.clusterName}
                        </p>
                      </TableCell>
                      <TableCell className="py-2.5 pr-5 sm:pr-6 text-right">
                        <Link
                          href={`/admin/policies/${encodeURIComponent(policy.id)}`}
                          aria-label={`${policy.name} 상세 보기`}
                          className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        {filteredPolicies.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-8 text-center text-xs text-slate-500">
            조건에 맞는 정책이 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredPolicies.length} / {policies.length}개 정책 표시
          </span>
          <span>클러스터별 Kyverno 정책 적용 현황</span>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
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
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof ShieldCheck;
  className: string;
  loading?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div
          className={`flex size-8 items-center justify-center rounded-lg ${className}`}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-2.5 text-xs text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-16 rounded-lg" />
      ) : (
        <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {value}
        </p>
      )}
      <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
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
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
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
      className="rounded-2xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-blue-200 hover:bg-blue-50/30 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}
