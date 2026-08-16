"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  exceptionRequests,
  exceptionStatusClassName,
  exceptionStatusLabel,
} from "@/lib/exception-requests";
import {
  kyvernoPolicies,
  policyModeLabel,
  policyStatusClassName,
  policyStatusLabel,
  policyTypeClassName,
  policyTypeLabel,
  type PolicyMode,
  type PolicyStatus,
  type PolicyType,
} from "@/lib/policies";

type TypeFilter = "all" | PolicyType;
type ModeFilter = "all" | PolicyMode;
type StatusFilter = "all" | PolicyStatus;

const typeOptions: PolicyType[] = ["validate", "mutate", "generate"];
const modeOptions: PolicyMode[] = ["enforce", "audit"];
const statusOptions: PolicyStatus[] = ["active", "warning"];

export default function PoliciesPage() {
  const visiblePolicies = kyvernoPolicies.filter((policy) => policy.status !== "draft");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [clusterFilter, setClusterFilter] = useState("all");

  const clusters = useMemo(
    () => Array.from(new Set(visiblePolicies.map((policy) => policy.clusterName))),
    [visiblePolicies],
  );
  const filteredPolicies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return visiblePolicies.filter((policy) => {
      const relatedExceptions = exceptionRequests.filter(
        (request) => request.policyName === policy.name,
      );
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          policy.name,
          policy.description,
          policy.clusterName,
          policy.namespace ?? "",
          policy.owner,
          relatedExceptions.map((request) => request.id).join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (typeFilter === "all" || policy.type === typeFilter) &&
        (modeFilter === "all" || policy.mode === modeFilter) &&
        (statusFilter === "all" || policy.status === statusFilter) &&
        (clusterFilter === "all" || policy.clusterName === clusterFilter)
      );
    });
  }, [clusterFilter, modeFilter, query, statusFilter, typeFilter, visiblePolicies]);

  const warningPolicies = visiblePolicies.filter(
    (policy) => policy.status === "warning",
  ).length;
  const enforcePolicies = visiblePolicies.filter(
    (policy) => policy.mode === "enforce",
  ).length;
  const exceptionLinkedPolicies = visiblePolicies.filter((policy) =>
    exceptionRequests.some((request) => request.policyName === policy.name),
  ).length;

  function resetFilters() {
    setQuery("");
    setTypeFilter("all");
    setModeFilter("all");
    setStatusFilter("all");
    setClusterFilter("all");
  }

  return (
    <DashboardPageShell
      activeHref="/policies"
      title="정책"
      description="내가 지켜야 하는 Kyverno 정책과 예외 신청 기준을 확인합니다."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="적용 정책"
          value={String(visiblePolicies.length)}
          detail="조회 가능 정책"
          icon={ShieldCheck}
          className="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="강제 정책"
          value={String(enforcePolicies)}
          detail="위반 시 차단 가능"
          icon={ShieldAlert}
          className="bg-rose-50 text-rose-600"
        />
        <SummaryCard
          label="주의 필요"
          value={String(warningPolicies)}
          detail="오류 발생 정책"
          icon={AlertTriangle}
          className="bg-amber-50 text-amber-600"
        />
        <SummaryCard
          label="예외 이력"
          value={String(exceptionLinkedPolicies)}
          detail="예외 신청 연결"
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  사용자
                </Badge>
                <span className="text-xs text-slate-400">
                  등록/수정 없이 조회와 예외 신청 중심
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                정책 적용 기준
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                배포 리소스가 어떤 정책을 따라야 하는지 확인하고, 관련 위반과 예외 신청 내역으로 이동합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="정책명, 설명, 클러스터 검색"
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="grid gap-4 p-5 lg:grid-cols-2 xl:grid-cols-3 sm:p-6">
          {filteredPolicies.map((policy) => {
            const relatedExceptions = exceptionRequests.filter(
              (request) => request.policyName === policy.name,
            );

            return (
              <article
                key={policy.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={policyTypeClassName[policy.type]}>
                        {policyTypeLabel[policy.type]}
                      </Badge>
                      <Badge className={policyStatusClassName[policy.status]}>
                        {policyStatusLabel[policy.status]}
                      </Badge>
                    </div>
                    <h3 className="mt-4 truncate text-base font-semibold text-slate-950">
                      {policy.name}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                      {policy.description}
                    </p>
                  </div>
                </div>

                <dl className="mt-5 grid gap-3 text-xs">
                  <InfoRow label="적용 범위" value={`${policy.scope} · ${policy.namespace ?? "cluster-wide"}`} />
                  <InfoRow label="클러스터" value={policy.clusterName} />
                  <InfoRow label="적용 모드" value={policyModeLabel[policy.mode]} />
                  <InfoRow label="관련 오류" value={`${policy.violationCount}건`} />
                </dl>

                {relatedExceptions.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-medium text-slate-500">
                      관련 예외 신청
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {relatedExceptions.slice(0, 2).map((request) => (
                        <Badge key={request.id} className={exceptionStatusClassName[request.status]}>
                          {request.id} · {exceptionStatusLabel[request.status]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button
                    asChild
                    variant="outline"
                    className="h-9 rounded-xl border-slate-200 bg-white"
                  >
                    <Link href="/violations">관련 위반 보기</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="h-9 rounded-xl border-slate-200 bg-white"
                  >
                    <Link href="/exceptions">내 신청 보기</Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>

        {filteredPolicies.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 정책이 없습니다.
          </div>
        ) : null}
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}
