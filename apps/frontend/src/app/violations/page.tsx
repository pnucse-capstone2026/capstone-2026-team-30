"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FilePlus2,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  exceptionClassName,
  policyViolations,
  severityClassName,
  statusClassName,
  type ExceptionStatus,
  type ViolationSeverity,
  type ViolationStatus,
} from "@/lib/policy-violations";

const severityLabel: Record<ViolationSeverity, string> = {
  critical: "긴급",
  high: "높음",
  medium: "중간",
  low: "낮음",
  info: "정보",
};

const statusLabel: Record<ViolationStatus, string> = {
  open: "수정 필요",
  inReview: "검토 중",
  resolved: "완료",
};

const exceptionLabel: Record<ExceptionStatus, string> = {
  none: "예외 없음",
  requested: "예외 요청됨",
  approved: "예외 승인됨",
};

const violationCopy: Record<
  string,
  {
    message: string;
    recommendation: string;
  }
> = {
  "vio-001": {
    message:
      "payment-api 컨테이너에 CPU와 memory limits가 설정되어 있지 않습니다.",
    recommendation:
      "컨테이너 resources.limits에 cpu와 memory 값을 추가한 뒤 다시 배포하세요.",
  },
  "vio-002": {
    message:
      "batch-sync-worker 컨테이너가 latest 이미지 태그를 참조하고 있습니다.",
    recommendation:
      "고정된 이미지 태그나 digest를 지정해 항상 동일한 이미지가 실행되도록 변경하세요.",
  },
  "vio-003": {
    message: "payments 네임스페이스 리소스에 team 라벨이 누락되었습니다.",
    recommendation: "metadata.labels에 team: payments 라벨을 추가하세요.",
  },
  "vio-004": {
    message:
      "crypto-wallet-cron 컨테이너가 privileged 모드로 실행되고 있습니다.",
    recommendation:
      "보안 취약점 방지를 위해 securityContext.privileged 설정을 제거하거나 false로 변경하세요.",
  },
  "vio-005": {
    message:
      "허용된 이미지 레지스트리 접두어가 누락되어 정책 보정이 필요합니다.",
    recommendation:
      "이미지 경로가 승인된 레지스트리 기준을 따르도록 수정하세요.",
  },
};

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

const exceptionOptions: Array<"all" | ExceptionStatus> = [
  "all",
  "none",
  "requested",
  "approved",
];

/**
 * 사용자용 정책 위반 오류 목록 본문 컴포넌트입니다.
 * URL 쿼리 파라미터(policy, cluster 등)를 감지하여 초기 필터 상태로 자동 적용합니다.
 */
function MyViolationsContent() {
  const searchParams = useSearchParams();

  const initialPolicy = searchParams.get("policy") || "all";
  const initialCluster = searchParams.get("cluster") || "all";
  const initialNamespace = searchParams.get("namespace") || "all";
  const initialSeverity =
    (searchParams.get("severity") as "all" | ViolationSeverity) || "all";
  const initialStatus =
    (searchParams.get("status") as "all" | ViolationStatus) || "all";
  const initialExceptionStatus =
    (searchParams.get("exceptionStatus") as "all" | ExceptionStatus) || "all";
  const initialQuery = searchParams.get("query") || "";

  const [query, setQuery] = useState(initialQuery);
  const [cluster, setCluster] = useState(initialCluster);
  const [policy, setPolicy] = useState(initialPolicy);
  const [namespace, setNamespace] = useState(initialNamespace);
  const [severity, setSeverity] = useState<"all" | ViolationSeverity>(
    initialSeverity,
  );
  const [status, setStatus] = useState<"all" | ViolationStatus>(initialStatus);
  const [exceptionStatus, setExceptionStatus] = useState<
    "all" | ExceptionStatus
  >(initialExceptionStatus);

  const liveViolations = useDataStore((state) => state.violations);
  const fetchViolations = useDataStore((state) => state.fetchViolations);
  const violationsLoading = useDataStore((state) => state.violationsLoading);

  const authStatus = useAuthStore((state) => state.status);
  const initializeAuth = useAuthStore((state) => state.initialize);

  // URL 쿼리 파라미터 변경 시 필터 상태를 동기화합니다.
  useEffect(() => {
    const p = searchParams.get("policy");
    if (p !== null) setPolicy(p || "all");
    const c = searchParams.get("cluster");
    if (c !== null) setCluster(c || "all");
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
    const ex = searchParams.get("exceptionStatus") as
      | ("all" | ExceptionStatus)
      | null;
    if (ex !== null && (ex === "all" || exceptionOptions.includes(ex))) {
      setExceptionStatus(ex);
    }
  }, [searchParams]);

  /**
   * 백엔드 API에서 실시간 정책 위반 목록을 조회합니다.
   * 세션 복원 후 최신 위반 이력을 갱신합니다.
   */
  const loadViolations = useCallback(async () => {
    try {
      await initializeAuth();
      await fetchViolations(true);
    } catch {
      // 백엔드 연동 실패 시 fallback 처리
    }
  }, [fetchViolations, initializeAuth]);

  useEffect(() => {
    void loadViolations();
  }, [authStatus, loadViolations]);

  const violations = liveViolations ?? policyViolations;

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
      const copy = violationCopy[violation.id];
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          violation.policyName,
          violation.ruleName,
          violation.resourceKind,
          violation.resourceName,
          violation.namespace,
          violation.clusterName,
          copy?.message ?? "",
          copy?.recommendation ?? "",
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
        (status === "all" || violation.status === status) &&
        (exceptionStatus === "all" ||
          violation.exceptionStatus === exceptionStatus)
      );
    });
  }, [
    violations,
    cluster,
    exceptionStatus,
    namespace,
    policy,
    query,
    severity,
    status,
  ]);

  const openCount = violations.filter((item) => item.status === "open").length;
  const urgentCount = violations.filter(
    (item) => item.severity === "critical" || item.severity === "high",
  ).length;
  const exceptionRequestedCount = violations.filter(
    (item) => item.exceptionStatus !== "none",
  ).length;
  const resolvedCount = violations.filter(
    (item) => item.status === "resolved",
  ).length;

  /**
   * 모든 필터 검색 조건을 기본값으로 초기화합니다.
   */
  function resetFilters() {
    setQuery("");
    setCluster("all");
    setPolicy("all");
    setNamespace("all");
    setSeverity("all");
    setStatus("all");
    setExceptionStatus("all");
  }

  return (
    <DashboardPageShell
      activeHref="/violations"
      title="내 리소스 위반"
      description="내가 배포한 리소스가 어떤 정책을 위반했는지 확인합니다."
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
            onClick={() => void loadViolations()}
            disabled={violationsLoading}
          >
            <RefreshCw
              className={`size-4 ${violationsLoading ? "animate-spin" : ""}`}
            />
            새로고침
          </Button>
          <Button
            asChild
            className="hidden h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] sm:inline-flex"
          >
            <Link href="/exceptions/new">
              <FilePlus2 className="size-4" />
              예외 신청
            </Link>
          </Button>
        </div>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="전체 위반"
          value={String(violations.length)}
          detail="내 리소스 기준"
          icon={ShieldAlert}
          className="bg-amber-50 text-amber-600"
          loading={liveViolations === null}
        />
        <SummaryCard
          label="우선 확인"
          value={String(urgentCount)}
          detail="긴급 또는 높음"
          icon={AlertTriangle}
          className="bg-rose-50 text-rose-600"
          loading={liveViolations === null}
        />
        <SummaryCard
          label="예외 진행"
          value={String(exceptionRequestedCount)}
          detail="요청 또는 승인됨"
          icon={Clock3}
          className="bg-blue-50 text-blue-600"
          loading={liveViolations === null}
        />
        <SummaryCard
          label="해결 완료"
          value={String(resolvedCount)}
          detail={`수정 필요 ${openCount}건`}
          icon={CheckCircle2}
          className="bg-emerald-50 text-emerald-600"
          loading={liveViolations === null}
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
                  정책 위반 확인 후 수정하거나 예외를 신청합니다.
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                위반 리소스 목록
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                위반한 정책, 대상 리소스, 문제 위치, 권장 조치를 확인하고 필요한
                경우 예외 신청으로 이동합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="정책명, 리소스, 조치 내용 검색"
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
            <FilterSelect
              label="예외 상태"
              value={exceptionStatus}
              onChange={(value) =>
                setExceptionStatus(value as "all" | ExceptionStatus)
              }
            >
              {exceptionOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "전체 예외" : exceptionLabel[option]}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {liveViolations === null
            ? [1, 2, 3].map((key) => (
                <article
                  key={key}
                  className="grid gap-4 px-5 py-5 sm:px-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)_auto]"
                >
                  <div className="min-w-0 space-y-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-16 rounded-lg" />
                      <Skeleton className="h-5 w-20 rounded-lg" />
                      <Skeleton className="h-5 w-20 rounded-lg" />
                    </div>
                    <Skeleton className="h-6 w-3/4 rounded-lg" />
                    <Skeleton className="h-4 w-1/2 rounded-lg" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>

                  <div className="grid content-start gap-2">
                    <Skeleton className="h-8 w-full rounded-xl" />
                    <Skeleton className="h-8 w-full rounded-xl" />
                    <Skeleton className="h-8 w-full rounded-xl" />
                    <Skeleton className="h-14 w-full rounded-xl" />
                  </div>

                  <div className="flex flex-wrap items-start gap-2 xl:justify-end">
                    <Skeleton className="h-9 w-24 rounded-xl" />
                    <Skeleton className="h-9 w-24 rounded-xl" />
                  </div>
                </article>
              ))
            : filteredViolations.map((violation) => {
                const copy = violationCopy[violation.id];

                return (
                  <article
                    key={violation.id}
                    className="grid gap-4 px-5 py-5 hover:bg-slate-50/70 sm:px-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={severityClassName[violation.severity]}
                        >
                          {severityLabel[violation.severity]}
                        </Badge>
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
                        <Badge
                          className={
                            exceptionClassName[violation.exceptionStatus]
                          }
                        >
                          {exceptionLabel[violation.exceptionStatus]}
                        </Badge>
                      </div>
                      <h3 className="mt-3 truncate text-base font-semibold text-slate-950">
                        {violation.policyName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {violation.ruleName} · {violation.detectedAt}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {copy?.message ?? violation.message}
                      </p>
                    </div>

                    <dl className="grid content-start gap-2 text-xs">
                      <InfoRow
                        label="대상 리소스"
                        value={`${violation.resourceKind} / ${violation.resourceName}`}
                      />
                      <InfoRow
                        label="위치"
                        value={`${violation.clusterName} / ${violation.namespace}`}
                      />
                      <InfoRow
                        label="문제 경로"
                        value={violation.resourcePath}
                      />
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <dt className="text-slate-500">권장 조치</dt>
                        <dd className="mt-1 leading-5 text-slate-800">
                          {copy?.recommendation ?? violation.recommendation}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-start gap-2 xl:justify-end">
                      <Button
                        asChild
                        variant="outline"
                        className="h-9 rounded-xl border-slate-200 bg-white"
                      >
                        <Link href={`/violations/${violation.id}`}>
                          상세 보기
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                      {violation.relatedExceptionId ? (
                        <Button
                          asChild
                          variant="outline"
                          className="h-9 rounded-xl border-slate-200 bg-white"
                        >
                          <Link
                            href={`/exceptions/${violation.relatedExceptionId}`}
                          >
                            내 신청 보기
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          asChild
                          className="h-9 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
                        >
                          <Link
                            href={`/exceptions/new?policy=${encodeURIComponent(violation.policyName)}&rule=${encodeURIComponent(violation.ruleName)}&cluster=${encodeURIComponent(violation.clusterId || violation.clusterName)}&resource=${encodeURIComponent(violation.resourceName)}&kind=${encodeURIComponent(violation.resourceKind)}&namespace=${encodeURIComponent(violation.namespace || "")}`}
                          >
                            <FilePlus2 className="size-4" />
                            예외 신청
                          </Link>
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
        </div>

        {liveViolations !== null && filteredViolations.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 위반 리소스가 없습니다.
          </div>
        ) : null}
      </section>
    </DashboardPageShell>
  );
}

/**
 * 사용자용 정책 오류/위반 내역 페이지 컴포넌트입니다.
 * useSearchParams 훅을 사용하는 하위 컨텐츠 컴포넌트를 Suspense로 래핑합니다.
 */
export default function MyViolationsPage() {
  return (
    <Suspense
      fallback={
        <DashboardPageShell
          activeHref="/violations"
          title="내 위반 리소스"
          description="내 리소스에서 발생한 정책 위반 이력을 확인하고 조치합니다."
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
      <MyViolationsContent />
    </Suspense>
  );
}

/**
 * 요약 지표 카드 컴포넌트입니다.
 */
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
  icon: typeof ShieldAlert;
  className: string;
  loading?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div
          className={`flex size-10 items-center justify-center rounded-xl ${className}`}
        >
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-9 w-20 rounded-lg" />
      ) : (
        <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </article>
  );
}

/**
 * 드롭다운 필터 선택 컴포넌트입니다.
 */
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

/**
 * 상세 정보 항목 라인 컴포넌트입니다.
 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="truncate text-right font-medium text-slate-800">
        {value}
      </dd>
    </div>
  );
}
