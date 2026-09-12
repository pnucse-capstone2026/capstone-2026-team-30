"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
  FileText,
  Layers3,
  ShieldAlert,
  XCircle,
  UserRound,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth-store";
import {
  cancelExceptionRequest,
  getExceptionRequest,
  toExceptionRequest,
} from "@/lib/exception-requests-api";
import {
  exceptionRiskClassName,
  exceptionRiskLabel,
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequest,
} from "@/lib/exception-requests";
import {
  policyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
} from "@/lib/policy-violations";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default function MyExceptionRequestDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const user = useAuthStore((state) => state.user);
  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  const [request, setRequest] = useState<ExceptionRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRequest = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setRequest(await getExceptionRequest(id));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "예외 신청 상세를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadRequest();
  }, [loadRequest]);

  const relatedViolation = useMemo(
    () =>
      request?.relatedViolationId
        ? policyViolations.find(
            (violation) => violation.id === request.relatedViolationId,
          )
        : undefined,
    [request],
  );
  const canRequestAgain =
    request?.status === "rejected" ||
    request?.status === "expired" ||
    request?.status === "failed";
  const canCancel =
    request?.status === "pending" ||
    request?.status === "applying" ||
    request?.status === "approved" ||
    request?.status === "failed";

  async function handleCancel() {
    if (!request || !canCancel) return;
    setIsCancelling(true);
    setErrorMessage(null);
    try {
      const response = await cancelExceptionRequest(request.id);
      setRequest(toExceptionRequest(response));
      toast.success("예외 신청 취소를 요청했습니다.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "예외 신청 취소에 실패했습니다.",
      );
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <DashboardPageShell
      variant={sidebarVariant}
      activeHref={user?.role === "ADMIN" ? "/admin/exceptions" : "/exceptions"}
      title="예외 신청 상세"
      description="내가 신청한 정책 예외의 검토 상태와 적용 조건을 확인합니다."
      actions={
        <>
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white"
          >
            <Link
              href={
                user?.role === "ADMIN" ? "/admin/exceptions" : "/exceptions"
              }
            >
              <ArrowLeft className="size-4" />
              목록
            </Link>
          </Button>
          <Button
            asChild
            className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
          >
            <Link
              href={
                user?.role === "ADMIN"
                  ? "/admin/exceptions/new"
                  : "/exceptions/new"
              }
            >
              <FilePlus2 className="size-4" />
              {canRequestAgain ? "다시 신청" : "새 예외 신청"}
            </Link>
          </Button>
          {canCancel ? (
            <Button
              variant="outline"
              className="h-10 rounded-xl border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
              disabled={isCancelling}
              onClick={() => void handleCancel()}
            >
              <XCircle className="size-4" />
              {isCancelling ? "취소 중" : "신청 취소"}
            </Button>
          ) : null}
        </>
      }
    >
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
          예외 신청 상세를 불러오는 중입니다.
        </div>
      ) : null}

      {!isLoading && errorMessage ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-sm text-rose-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{errorMessage}</span>
            <Button
              variant="outline"
              className="h-9 rounded-lg border-rose-200 bg-white text-rose-700"
              onClick={() => void loadRequest()}
            >
              다시 시도
            </Button>
          </div>
        </div>
      ) : null}

      {!isLoading && request ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={exceptionStatusClassName[request.status]}>
                      {exceptionStatusLabel[request.status]}
                    </Badge>
                    <Badge
                      className={exceptionRiskClassName[request.riskLevel]}
                    >
                      위험도 {exceptionRiskLabel[request.riskLevel]}
                    </Badge>
                  </div>
                  <h2 className="mt-4 break-words text-2xl font-semibold tracking-tight">
                    {request.id}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {request.policyName} 정책에 대한 예외 신청입니다.
                  </p>
                </div>
                <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <ShieldAlert className="size-6" />
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoCard
                  icon={Layers3}
                  label="대상 리소스"
                  value={`${request.resourceKind} / ${request.resourceName}`}
                  detail={`${request.clusterName} · ${request.namespace}`}
                />
                <InfoCard
                  icon={FileText}
                  label="정책"
                  value={request.policyName}
                  detail={
                    request.ruleNames?.join(", ") ??
                    relatedViolation?.ruleName ??
                    "연결된 위반 규칙 없음"
                  }
                />
                <InfoCard
                  icon={UserRound}
                  label="신청자"
                  value={request.requester}
                  detail={request.team}
                />
                <InfoCard
                  icon={CalendarClock}
                  label="신청/만료일"
                  value={request.requestedAt}
                  detail={`만료 ${request.expiresAt}`}
                />
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-6 py-4">
                <h3 className="text-sm font-semibold">신청 사유</h3>
                <p className="mt-1 text-xs text-slate-400">
                  관리자가 예외 필요성을 판단할 때 보는 설명입니다.
                </p>
              </div>
              <div className="space-y-5 p-6">
                <section>
                  <h4 className="text-xs font-semibold text-slate-500">사유</h4>
                  <p className="mt-2 whitespace-pre-wrap break-all rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                    {request.reason}
                  </p>
                </section>
                <section>
                  <h4 className="text-xs font-semibold text-slate-500">
                    요청/적용 규칙
                  </h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <RuleSummary
                      label="요청 규칙"
                      values={request.ruleNames ?? []}
                    />
                    <RuleSummary
                      label="적용 규칙"
                      values={request.appliedRuleNames ?? []}
                    />
                  </div>
                </section>
                <section>
                  <h4 className="text-xs font-semibold text-slate-500">
                    보완 통제
                  </h4>
                  <p className="mt-2 whitespace-pre-wrap break-all rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                    {request.compensatingControl}
                  </p>
                </section>
              </div>
            </article>

            {relatedViolation ? (
              <article className="rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-6 py-4">
                  <h3 className="text-sm font-semibold">연결된 정책 위반</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    이 예외 신청이 어떤 정책 위반에서 시작됐는지 확인합니다.
                  </p>
                </div>
                <div className="p-6">
                  <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={
                            severityClassName[relatedViolation.severity]
                          }
                        >
                          {severityLabel[relatedViolation.severity]}
                        </Badge>
                        <Badge
                          className={statusClassName[relatedViolation.status]}
                        >
                          {statusLabel[relatedViolation.status]}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-900">
                        {relatedViolation.id} · {relatedViolation.ruleName}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {relatedViolation.message}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {relatedViolation.resourcePath}
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      className="shrink-0 rounded-xl border-slate-200 bg-white"
                    >
                      <Link href="/policies">정책 목록</Link>
                    </Button>
                  </div>
                </div>
              </article>
            ) : null}
          </div>

          <aside className="space-y-6">
            <article className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">검토 상태</h3>
                  <p className="text-xs text-slate-400">
                    현재 신청 기준 정보입니다.
                  </p>
                </div>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <StatusRow
                  label="상태"
                  value={exceptionStatusLabel[request.status]}
                />
                <StatusRow label="검토자" value={request.reviewer} />
                <StatusRow label="만료일" value={request.expiresAt} />
                <StatusRow
                  label="활성화일"
                  value={request.activatedAt ?? "-"}
                />
                <StatusRow
                  label="재시도"
                  value={`${request.applyAttempts ?? 0}회`}
                />
                <StatusRow
                  label="위험도"
                  value={exceptionRiskLabel[request.riskLevel]}
                />
              </dl>
            </article>

            {request.status === "failed" || request.lastError ? (
              <article className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-rose-900">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                  <div>
                    <h3 className="text-sm font-semibold">적용 실패 정보</h3>
                    <p className="mt-2 break-all text-xs leading-5 text-rose-800">
                      {request.lastError ?? "Kubernetes 적용이 실패했습니다."}
                    </p>
                    <dl className="mt-4 space-y-2 text-xs">
                      <StatusRow
                        label="시도 횟수"
                        value={`${request.applyAttempts ?? 0}회`}
                      />
                      <StatusRow
                        label="다음 재시도"
                        value={request.nextAttemptAt ?? "-"}
                      />
                    </dl>
                  </div>
                </div>
              </article>
            ) : null}

            <article className="rounded-2xl border border-amber-100 bg-amber-50 p-5 text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">확인 사항</h3>
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    예외가 승인되어도 만료일 이후에는 다시 정책 검사를 받습니다.
                    운영 반영 전에는 보완 통제 조건을 함께 확인해야 합니다.
                  </p>
                </div>
              </div>
            </article>
          </aside>
        </section>
      ) : null}
    </DashboardPageShell>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Layers3;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon className="size-4 text-slate-400" />
        {label}
      </div>
      <p className="mt-3 truncate text-sm font-semibold text-slate-900">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function RuleSummary({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <h5 className="text-xs font-semibold text-slate-500">{label}</h5>
      {values.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge
              key={value}
              className="bg-white text-slate-700 ring-1 ring-slate-200"
            >
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">-</p>
      )}
    </div>
  );
}
