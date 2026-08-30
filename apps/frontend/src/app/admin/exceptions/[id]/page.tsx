"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarClock,
  FileClock,
  Menu,
  ShieldCheck,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { NotificationDropdown } from "@/components/dashboard/notification-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getExceptionRequest } from "@/lib/exception-requests-api";
import {
  exceptionRiskClassName,
  exceptionRiskLabel,
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequest,
} from "@/lib/exception-requests";
import { ExceptionApprovalPanel } from "./approval-panel";

type AdminExceptionDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default function AdminExceptionDetailPage({
  params,
}: AdminExceptionDetailPageProps) {
  const { id } = use(params);
  const [request, setRequest] = useState<ExceptionRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="admin" activeHref="/admin/exceptions" />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-20 items-center border-b border-slate-200 bg-white/95 px-5 backdrop-blur-sm sm:px-8">
          <button
            type="button"
            className="mr-3 flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Link href="/admin/exceptions" className="hover:text-slate-900">
                예외 관리
              </Link>
              <span>/</span>
              <span className="truncate">{request?.id ?? id}</span>
            </div>
            <h1 className="mt-1 truncate text-base font-semibold tracking-tight sm:text-lg">
              {request?.policyName ?? "예외 신청 상세"}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
            >
              <Link href="/admin/exceptions">
                <ArrowLeft className="size-4" />
                목록
              </Link>
            </Button>
            <NotificationDropdown />
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
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
            <>
              <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge className={exceptionStatusClassName[request.status]}>
                      {exceptionStatusLabel[request.status]}
                    </Badge>
                    <Badge
                      className={exceptionRiskClassName[request.riskLevel]}
                    >
                      <AlertTriangle className="size-3" />
                      {exceptionRiskLabel[request.riskLevel]}
                    </Badge>
                    <span className="text-xs text-slate-400">
                      {request.requestedAt} 신청 · {request.expiresAt} 만료
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {request.resourceKind} / {request.resourceName}
                  </h2>
                  <p className="mt-2 max-w-3xl whitespace-pre-wrap break-all text-sm leading-6 text-slate-500">
                    {request.reason}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {request.relatedViolationId ? (
                    <Button
                      asChild
                      variant="outline"
                      className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                    >
                      <Link
                        href={`/admin/violations/${request.relatedViolationId}`}
                      >
                        관련 위반 보기
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    asChild
                    variant="outline"
                    className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                  >
                    <Link href="/admin/exceptions">
                      <ArrowLeft className="size-4" />
                      목록으로
                    </Link>
                  </Button>
                </div>
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <FileClock className="size-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">예외 대상</h3>
                        <p className="mt-1 text-xs text-slate-400">
                          예외가 적용될 정책, 리소스, 클러스터 범위입니다.
                        </p>
                      </div>
                    </div>

                    <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                      {[
                        ["신청 번호", request.id],
                        ["정책", request.policyName],
                        [
                          "리소스",
                          `${request.resourceKind} / ${request.resourceName}`,
                        ],
                        ["네임스페이스", request.namespace],
                        ["클러스터", request.clusterName],
                        ["신청자", `${request.requester} / ${request.team}`],
                        ["검토자", request.reviewer],
                        ["만료일", request.expiresAt],
                        ["활성화일", request.activatedAt ?? "-"],
                        ["K8s 예외명", request.k8sExceptionName ?? "-"],
                        ["재시도 횟수", `${request.applyAttempts ?? 0}회`],
                        ["다음 재시도", request.nextAttemptAt ?? "-"],
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

                  <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                        <ShieldCheck className="size-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">보완 통제</h3>
                        <p className="mt-1 text-xs text-slate-400">
                          승인 후 예외 기간 동안 유지해야 하는 조건입니다.
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 whitespace-pre-wrap break-all rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                      {request.compensatingControl}
                    </div>
                  </article>

                  <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                        <FileClock className="size-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">적용 규칙</h3>
                        <p className="mt-1 text-xs text-slate-400">
                          요청 규칙과 실제 Kyverno 예외 적용 규칙입니다.
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <RuleGroup
                        label="요청 규칙"
                        values={request.ruleNames ?? []}
                      />
                      <RuleGroup
                        label="적용 규칙"
                        values={request.appliedRuleNames ?? []}
                      />
                    </div>
                    {request.lastError ? (
                      <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
                        <p className="text-xs font-semibold text-rose-800">
                          마지막 Kubernetes 오류
                        </p>
                        <p className="mt-2 break-all text-xs leading-5 text-rose-700">
                          {request.lastError}
                        </p>
                      </div>
                    ) : null}
                  </article>

                  <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                        <CalendarClock className="size-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">
                          승인 체크리스트
                        </h3>
                        <p className="mt-1 text-xs text-slate-400">
                          운영 예외 승인 전 확인해야 할 항목입니다.
                        </p>
                      </div>
                    </div>
                    <ul className="mt-5 grid gap-3 text-sm text-slate-600">
                      {[
                        "예외 종료일이 명확하고 과도하게 길지 않습니다.",
                        "보완 통제가 신청 사유와 실제 위험을 줄일 수 있습니다.",
                        "운영 클러스터 예외는 신청자와 검토자가 분리되어 있습니다.",
                        "만료 후 정책 기준으로 복구할 계획이 있습니다.",
                      ].map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                        >
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-blue-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                </div>

                <aside>
                  <ExceptionApprovalPanel
                    request={request}
                    onRequestChange={setRequest}
                  />
                </aside>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function RuleGroup({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <h4 className="text-[11px] font-medium text-slate-400">{label}</h4>
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
        <p className="mt-2 text-xs text-slate-500">-</p>
      )}
    </div>
  );
}
