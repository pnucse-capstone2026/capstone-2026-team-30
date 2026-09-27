"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Code2,
  Edit,
  FileClock,
  FileQuestion,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  exceptionRiskClassName,
  exceptionRiskLabel,
  exceptionStatusClassName,
  exceptionStatusLabel,
} from "@/lib/exception-requests";
import {
  getPolicyById,
  policyModeLabel,
  policyStatusClassName,
  policyStatusLabel,
  policyTypeClassName,
  policyTypeLabel,
  type KyvernoPolicy,
} from "@/lib/policies";
import {
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
} from "@/lib/policy-violations";

const statusIcon = {
  open: XCircle,
  inReview: Clock3,
  resolved: CheckCircle2,
};

export default function AdminPolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : "";

  const [policy, setPolicy] = useState<KyvernoPolicy | null>(null);
  const [loading, setLoading] = useState(true);

  const initializeAuth = useAuthStore((state) => state.initialize);
  const liveViolations = useDataStore((state) => state.violations);
  const liveExceptions = useDataStore((state) => state.exceptions);
  const fetchViolations = useDataStore((state) => state.fetchViolations);
  const fetchExceptions = useDataStore((state) => state.fetchExceptions);
  const fetchPolicies = useDataStore((state) => state.fetchPolicies);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      await initializeAuth();
      void fetchViolations();
      void fetchExceptions();
      void fetchPolicies();
      const detail = await getPolicyById(id);
      setPolicy(detail);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fetchExceptions, fetchPolicies, fetchViolations, id, initializeAuth]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const allViolations = liveViolations ?? [];
  const allExceptions = liveExceptions ?? [];

  const relatedViolations = useMemo(() => {
    if (!policy) return [];
    return allViolations.filter(
      (violation) =>
        violation.policyName === policy.name ||
        (violation.clusterId === policy.clusterId &&
          violation.policyName.toLowerCase() === policy.name.toLowerCase()),
    );
  }, [allViolations, policy]);

  const relatedExceptions = useMemo(() => {
    if (!policy) return [];
    return allExceptions.filter(
      (request) =>
        request.policyName === policy.name ||
        request.policyName.toLowerCase() === policy.name.toLowerCase(),
    );
  }, [allExceptions, policy]);

  const openViolations = useMemo(
    () =>
      relatedViolations.filter((violation) => violation.status !== "resolved"),
    [relatedViolations],
  );

  const policyYaml = useMemo(
    () => (policy ? buildPolicyYaml(policy) : ""),
    [policy],
  );

  if (loading) {
    return (
      <DashboardPageShell
        variant="admin"
        activeHref="/admin/policies"
        title="정책 상세"
        description="정책 정보를 불러오는 중입니다..."
        actions={
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link href="/admin/policies">
              <ArrowLeft className="size-4" />
              목록
            </Link>
          </Button>
        }
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
    );
  }

  if (!policy) {
    return (
      <DashboardPageShell
        variant="admin"
        activeHref="/admin/policies"
        title="정책을 찾을 수 없음"
        description="요청하신 Kyverno 정책 정보를 찾을 수 없습니다."
        actions={
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link href="/admin/policies">
              <ArrowLeft className="size-4" />
              목록으로 돌아가기
            </Link>
          </Button>
        }
      >
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <FileQuestion className="size-8" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            정책 정보를 찾을 수 없습니다
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            요청하신 정책 식별자({id})가 클러스터에 존재하지 않거나 접근 권한이
            없습니다.
          </p>
          <div className="mt-6 flex gap-3">
            <Button
              variant="outline"
              onClick={() => void loadData()}
              className="rounded-xl border-slate-200"
            >
              <RefreshCw className="size-4" />
              다시 시도
            </Button>
            <Button
              asChild
              className="rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            >
              <Link href="/admin/policies">정책 목록 보기</Link>
            </Button>
          </div>
        </div>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/policies"
      title="정책 상세"
      description={policy.name}
      actions={
        <>
          <Button
            asChild
            variant="outline"
            className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
          >
            <Link href="/admin/policies">
              <ArrowLeft className="size-4" />
              목록
            </Link>
          </Button>
          <Button
            asChild
            className="hidden h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] sm:inline-flex"
          >
            <Link
              href={`/admin/policies/${encodeURIComponent(policy.id)}/edit`}
            >
              <Edit className="size-4" />
              수정
            </Link>
          </Button>
        </>
      }
    >
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className={policyTypeClassName[policy.type]}>
              {policyTypeLabel[policy.type]}
            </Badge>
            <Badge className={policyStatusClassName[policy.status]}>
              {policyStatusLabel[policy.status]}
            </Badge>
            <Badge className="bg-slate-100 text-slate-600 ring-1 ring-slate-200">
              {policyModeLabel[policy.mode]}
            </Badge>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {policy.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            {policy.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link
              href={`/admin/violations?policy=${encodeURIComponent(policy.name)}`}
            >
              <ShieldAlert className="size-4" />
              오류 보기
            </Link>
          </Button>
          <Button
            asChild
            className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
          >
            <Link
              href={`/admin/policies/${encodeURIComponent(policy.id)}/edit`}
            >
              <Edit className="size-4" />
              정책 수정
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="규칙 수"
          value={String(policy.ruleCount)}
          detail={policy.scope}
          icon={ShieldCheck}
          className="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="미해결 오류"
          value={String(openViolations.length)}
          detail={`전체 ${relatedViolations.length}건`}
          icon={AlertTriangle}
          className="bg-rose-50 text-rose-600"
        />
        <SummaryCard
          label="예외 신청"
          value={String(relatedExceptions.length)}
          detail="관련 정책 예외"
          icon={FileClock}
          className="bg-amber-50 text-amber-600"
        />
        <SummaryCard
          label="클러스터"
          value={policy.clusterDisplayName ?? policy.clusterName}
          detail={policy.namespace ?? "cluster-wide"}
          icon={ShieldCheck}
          className="bg-emerald-50 text-emerald-600"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">정책 메타데이터</h3>
                <p className="mt-1 text-xs text-slate-400">
                  정책 설정 및 운영 상태 정보입니다.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["정책 이름", policy.name],
                ["정책 범위", policy.scope],
                ["적용 모드", policyModeLabel[policy.mode]],
                ["운영 상태", policyStatusLabel[policy.status]],
                ["클러스터", policy.clusterDisplayName ?? policy.clusterName],
                ["Namespace", policy.namespace ?? "cluster-wide"],
                ["담당자 / 관리 주체", policy.owner || "미지정"],
                ["최근 수정", policy.updatedAt],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <dt className="text-[11px] font-medium text-slate-400">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium text-slate-800">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </article>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-sm font-semibold">관련 정책 오류</h3>
                <p className="mt-1 text-xs text-slate-400">
                  이 정책에서 감지된 최근 위반 이력입니다.
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-lg border-slate-200 bg-white"
              >
                <Link
                  href={`/admin/violations?policy=${encodeURIComponent(policy.name)}`}
                >
                  전체 보기
                </Link>
              </Button>
            </div>
            <div className="divide-y divide-slate-100">
              {relatedViolations.length > 0 ? (
                relatedViolations.map((violation) => {
                  const StatusIcon = statusIcon[violation.status];

                  return (
                    <Link
                      key={violation.id}
                      href={`/admin/violations/${violation.id}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                    >
                      <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 sm:flex">
                        <ShieldAlert className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-medium">
                            {violation.ruleName}
                          </p>
                          <Badge
                            className={severityClassName[violation.severity]}
                          >
                            {severityLabel[violation.severity]}
                          </Badge>
                          <Badge className={statusClassName[violation.status]}>
                            <StatusIcon className="size-3" />
                            {statusLabel[violation.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-slate-400">
                          {violation.resourceKind} / {violation.resourceName} ·{" "}
                          {violation.detectedAt}
                        </p>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  관련 정책 오류가 없습니다.
                </div>
              )}
            </div>
          </article>
        </div>

        <aside className="space-y-6">
          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Code2 className="size-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">정책 YAML 미리보기</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Kyverno 매니페스트 정의
                </p>
              </div>
            </div>
            <pre className="max-h-[460px] overflow-auto p-5 text-xs leading-6 text-slate-700">
              <code>{policyYaml}</code>
            </pre>
          </article>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-semibold">관련 예외 신청</h3>
              <p className="mt-1 text-xs text-slate-400">
                이 정책에 연결된 예외 요청입니다.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {relatedExceptions.length > 0 ? (
                relatedExceptions.map((request) => (
                  <Link
                    key={request.id}
                    href={`/admin/exceptions/${request.id}`}
                    className="block px-5 py-4 hover:bg-slate-50/70"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {request.id}
                      </p>
                      <Badge
                        className={exceptionStatusClassName[request.status]}
                      >
                        {exceptionStatusLabel[request.status]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {request.requester} · {request.team}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Badge
                        className={exceptionRiskClassName[request.riskLevel]}
                      >
                        {exceptionRiskLabel[request.riskLevel]}
                      </Badge>
                      <span className="text-[11px] text-slate-400">
                        만료 {request.expiresAt}
                      </span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-5 py-8 text-center text-sm text-slate-500">
                  관련 예외 신청이 없습니다.
                </div>
              )}
            </div>
          </article>
        </aside>
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
        <div
          className={`flex size-10 items-center justify-center rounded-xl ${className}`}
        >
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-3xl font-semibold tracking-tight">
        {value}
      </p>
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </article>
  );
}

function buildPolicyYaml(policy: KyvernoPolicy): string {
  if (policy.rawJson) {
    try {
      const raw = policy.rawJson;
      const apiVersion = (raw.apiVersion as string) ?? "kyverno.io/v1";
      const kind = (raw.kind as string) ?? policy.scope;
      const metadata = raw.metadata ?? { name: policy.name };
      const spec = raw.spec ?? {};
      return JSON.stringify({ apiVersion, kind, metadata, spec }, null, 2);
    } catch {
      // fallback
    }
  }

  const namespace =
    policy.scope === "Policy" && policy.namespace
      ? `  namespace: ${policy.namespace}\n`
      : "";

  const ruleNames =
    policy.rules && policy.rules.length > 0
      ? policy.rules
      : [`${policy.type}-${policy.name}`];

  const renderedRules = ruleNames
    .map(
      (rule) => `    - name: ${rule}
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
      ${policy.type}:
        message: "${policy.description || "정책 조건을 만족해야 합니다."}"
        pattern:
          metadata:
            labels:
              app: "?*"`,
    )
    .join("\n");

  return `apiVersion: kyverno.io/v1
kind: ${policy.scope}
metadata:
  name: ${policy.name}
${namespace}spec:
  validationFailureAction: ${policy.mode === "enforce" ? "Enforce" : "Audit"}
  background: true
  rules:
${renderedRules}`;
}
