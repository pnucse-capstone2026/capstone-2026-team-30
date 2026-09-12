"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  GitPullRequest,
  Menu,
  Paperclip,
  Send,
  ShieldAlert,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { NotificationDropdown } from "@/components/dashboard/notification-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import { type ClusterMetadata, listClusters } from "@/lib/clusters";
import { createExceptionRequest } from "@/lib/exception-requests-api";

const fieldClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10";

const textareaClassName =
  "min-h-32 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10";

/**
 * 오늘을 기준으로 특정 일수(offsetDays) 후의 YYYY-MM-DD 날짜 문자열을 생성합니다.
 */
function dateInputValue(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * 날짜 문자열(YYYY-MM-DD)을 해당 일자 끝 시점의 ISO 8601 문자열로 변환합니다.
 */
function expirationFromDateInput(value: string) {
  return new Date(`${value}T23:59:59.000Z`).toISOString();
}

/**
 * 사용자용 정책 예외 신청 폼 내부 본문 컴포넌트입니다.
 * URL 쿼리 파라미터를 파싱하여 위반 대상 리소스 정보를 입력 폼에 자동으로 채웁니다.
 */
function ExceptionRequestContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramPolicy = searchParams.get("policy") || "";
  const paramRule = searchParams.get("rule") || "";
  const paramCluster = searchParams.get("cluster") || "";
  const paramResource = searchParams.get("resource") || "";
  const paramKind = searchParams.get("kind") || "";
  const paramNamespace = searchParams.get("namespace") || "";
  const paramRepo = searchParams.get("repo") || "";
  const paramPr = searchParams.get("pr") || "";

  const [policyName, setPolicyName] = useState(paramPolicy);
  const [ruleNames, setRuleNames] = useState(paramRule);
  const [resourceKind, setResourceKind] = useState(paramKind || "Pod");
  const [resourceName, setResourceName] = useState(paramResource);
  const [resourceNamespace, setResourceNamespace] = useState(paramNamespace);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clusters, setClusters] = useState<ClusterMetadata[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState(paramCluster);
  const [isLoadingClusters, setIsLoadingClusters] = useState(true);
  const [clusterErrorMessage, setClusterErrorMessage] = useState<string | null>(
    null,
  );

  const defaultEndDate = useMemo(() => dateInputValue(7), []);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableClusters() {
      setIsLoadingClusters(true);
      setClusterErrorMessage(null);

      try {
        await useAuthStore.getState().initialize();
        const clusterList = await listClusters();

        if (cancelled) return;

        setClusters(clusterList);
        setSelectedClusterId((currentClusterId) => {
          if (
            paramCluster &&
            clusterList.some(
              (c) => c.id === paramCluster || c.displayName === paramCluster,
            )
          ) {
            const matched = clusterList.find(
              (c) => c.id === paramCluster || c.displayName === paramCluster,
            );
            return matched?.id ?? paramCluster;
          }
          if (
            currentClusterId &&
            clusterList.some((cluster) => cluster.id === currentClusterId)
          ) {
            return currentClusterId;
          }
          return clusterList[0]?.id ?? "";
        });
      } catch (error) {
        if (cancelled) return;

        setClusters([]);
        setSelectedClusterId("");
        setClusterErrorMessage(
          error instanceof Error
            ? error.message
            : "클러스터 목록을 불러오지 못했습니다.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingClusters(false);
        }
      }
    }

    void loadAvailableClusters();

    return () => {
      cancelled = true;
    };
  }, [paramCluster]);

  const requestChecklist = [
    {
      label: "정책 위반 확인",
      detail:
        policyName && resourceName
          ? `${policyName} / ${resourceName}`
          : "위반 리소스 지정",
      icon: ShieldAlert,
      className: "bg-rose-50 text-rose-600",
    },
    {
      label: "요청 기간 지정",
      detail: "최대 30일 이내 권장",
      icon: CalendarDays,
      className: "bg-blue-50 text-blue-600",
    },
    {
      label: "관리자 검토",
      detail: "신청 후 승인 대기 상태로 전환",
      icon: Clock3,
      className: "bg-amber-50 text-amber-600",
    },
  ];

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reasonValue, setReasonValue] = useState(
    paramPr
      ? `[GitHub PR #${paramPr}${paramRepo ? ` (${paramRepo})` : ""}] 사전 거버넌스 검증 결과에 따른 일시적 정책 예외 신청입니다.`
      : "긴급 배포 일정으로 인해 리소스 limits 설정을 다음 릴리스에 포함해야 합니다. 예외 기간 동안 사용량을 모니터링하고 종료일 전에 requests/limits를 적용하겠습니다.",
  );
  const [endDateValue, setEndDateValue] = useState(defaultEndDate);

  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const formPolicy = String(formData.get("policyName") ?? "").trim();
    const formRules = String(formData.get("ruleNames") ?? "")
      .split(",")
      .map((rule) => rule.trim())
      .filter(Boolean);
    const reason = String(formData.get("reason") ?? "").trim();
    const attachmentNote = String(formData.get("attachmentNote") ?? "").trim();
    const formKind = String(formData.get("resourceKind") ?? "").trim();
    const formResource = String(formData.get("resourceName") ?? "").trim();
    const formNamespace = String(
      formData.get("resourceNamespace") ?? "",
    ).trim();
    const targetClusterId = String(
      formData.get("targetClusterId") ?? "",
    ).trim();
    const endDate = String(formData.get("endDate") ?? "").trim();

    const errors: Record<string, string> = {};
    if (!formPolicy) errors.policyName = "대상 정책 이름을 입력하세요. (필수)";
    if (formRules.length === 0)
      errors.ruleNames = "정책 규칙 이름을 하나 이상 입력하세요. (필수)";
    if (!targetClusterId)
      errors.targetClusterId = "대상 클러스터를 선택하세요. (필수)";
    if (!formKind)
      errors.resourceKind =
        "적용 리소스 종류(예: Pod, Deployment)를 입력하세요. (필수)";
    if (!formResource)
      errors.resourceName = "적용 리소스 이름을 입력하세요. (필수)";
    if (!endDate) errors.endDate = "예외 종료일을 지정하세요. (필수)";
    if (!reason) errors.reason = "예외 신청 사유를 입력하세요. (필수)";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const missingList = Object.values(errors).join(", ");
      setErrorMessage(`필수 입력값을 확인해 주세요: ${missingList}`);
      toast.error("필수 입력 항목이 누락되었습니다.");
      return;
    }

    setFieldErrors({});

    const expiresAt = expirationFromDateInput(endDate);
    if (new Date(expiresAt) <= new Date()) {
      setFieldErrors((prev) => ({
        ...prev,
        endDate: "예외 종료일은 오늘 이후여야 합니다.",
      }));
      setErrorMessage("예외 종료일은 오늘 이후여야 합니다.");
      toast.error("예외 종료일은 오늘 이후여야 합니다.");
      return;
    }

    const requestReason = attachmentNote
      ? `${reason}\n\n첨부 설명: ${attachmentNote}`
      : reason;

    setIsSubmitting(true);
    try {
      await createExceptionRequest({
        policyName: formPolicy,
        ruleNames: formRules,
        reason: requestReason,
        resourceKind: formKind,
        resourceName: formResource,
        resourceNamespace: formNamespace || undefined,
        targetClusterId,
        expiresAt,
      });
      toast.success("예외 신청이 생성되었습니다.");
      router.push("/exceptions");
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "예외 신청을 생성하지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="user" activeHref="/exceptions/new" />

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
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              정책 예외 신청
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              정책 위반 리소스에 대해 기간이 정해진 예외를 요청합니다.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
            >
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
                대시보드
              </Link>
            </Button>
            <NotificationDropdown />
          </div>
        </header>

        <div className="mx-auto max-w-[1280px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  사용자
                </Badge>
                <span className="text-xs text-slate-400">
                  예외 신청 번호는 제출 후 자동 생성됩니다.
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                일시 예외 신청서
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                승인된 예외는 지정한 기간에만 적용됩니다. 운영 리소스는 사유와
                종료일을 명확히 입력해야 합니다.
              </p>
            </div>
            {paramPr ? (
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                <GitPullRequest className="size-4 shrink-0 text-blue-600" />
                <span>
                  <strong>GitHub PR #{paramPr}</strong>
                  {paramRepo ? ` (${paramRepo})` : ""} 검증 결과로부터 자동
                  입력됨
                </span>
              </div>
            ) : paramResource ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
                <CheckCircle2 className="size-4 shrink-0" />
                선택된 정책 오류 리소스 정보가 자동으로 바인딩되었습니다.
              </div>
            ) : null}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <form
              className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              onSubmit={handleSubmit}
            >
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-sm font-semibold">신청 정보</h3>
                <p className="mt-1 text-xs text-slate-400">
                  대상 클러스터와 정책, 규칙 및 적용 리소스를 지정하세요.
                </p>
              </div>

              <div className="space-y-6 p-5 sm:p-6">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="policyName"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>대상 정책</span>
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-rose-500 font-normal">
                        (필수)
                      </span>
                    </Label>
                    <Input
                      id="policyName"
                      name="policyName"
                      value={policyName}
                      onChange={(e) => {
                        setPolicyName(e.target.value);
                        clearFieldError("policyName");
                      }}
                      placeholder="예: require-resource-limits"
                      className={`h-11 rounded-xl border-slate-200 ${
                        fieldErrors.policyName
                          ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                          : ""
                      }`}
                      required
                    />
                    {fieldErrors.policyName && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.policyName}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="ruleNames"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>정책 규칙</span>
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-rose-500 font-normal">
                        (필수)
                      </span>
                    </Label>
                    <Input
                      id="ruleNames"
                      name="ruleNames"
                      value={ruleNames}
                      onChange={(e) => {
                        setRuleNames(e.target.value);
                        clearFieldError("ruleNames");
                      }}
                      placeholder="예: validate-resource-limits (쉼표로 복수 지정)"
                      className={`h-11 rounded-xl border-slate-200 ${
                        fieldErrors.ruleNames
                          ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                          : ""
                      }`}
                      required
                    />
                    {fieldErrors.ruleNames ? (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.ruleNames}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400">
                        여러 규칙은 쉼표로 구분합니다.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="targetClusterId"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>대상 클러스터</span>
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-rose-500 font-normal">
                        (필수)
                      </span>
                    </Label>
                    <select
                      id="targetClusterId"
                      name="targetClusterId"
                      value={selectedClusterId}
                      onChange={(event) => {
                        setSelectedClusterId(event.target.value);
                        clearFieldError("targetClusterId");
                      }}
                      className={`${fieldClassName} ${
                        fieldErrors.targetClusterId
                          ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                          : ""
                      }`}
                      disabled={isLoadingClusters || clusters.length === 0}
                      required
                    >
                      {isLoadingClusters ? (
                        <option value="">클러스터를 불러오는 중입니다</option>
                      ) : clusters.length === 0 ? (
                        <option value="">배정된 클러스터가 없습니다</option>
                      ) : (
                        clusters.map((cluster) => (
                          <option key={cluster.id} value={cluster.id}>
                            {cluster.displayName} ({cluster.id})
                          </option>
                        ))
                      )}
                    </select>
                    {fieldErrors.targetClusterId ? (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.targetClusterId}
                      </p>
                    ) : clusterErrorMessage ? (
                      <p className="text-[11px] leading-5 text-rose-500">
                        {clusterErrorMessage}
                      </p>
                    ) : clusters.length === 0 && !isLoadingClusters ? (
                      <p className="text-[11px] leading-5 text-slate-400">
                        관리자에게 클러스터 배정을 요청하세요.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="resourceNamespace"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>Namespace</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        (선택 - 클러스터 전역인 경우 공백)
                      </span>
                    </Label>
                    <Input
                      id="resourceNamespace"
                      name="resourceNamespace"
                      value={resourceNamespace}
                      onChange={(e) => setResourceNamespace(e.target.value)}
                      placeholder="예: payments"
                      className="h-11 rounded-xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="resourceKind"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>적용 리소스 종류</span>
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-rose-500 font-normal">
                        (필수)
                      </span>
                    </Label>
                    <Input
                      id="resourceKind"
                      name="resourceKind"
                      value={resourceKind}
                      onChange={(e) => {
                        setResourceKind(e.target.value);
                        clearFieldError("resourceKind");
                      }}
                      placeholder="예: Deployment, Pod, Service"
                      className={`h-11 rounded-xl border-slate-200 ${
                        fieldErrors.resourceKind
                          ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                          : ""
                      }`}
                      required
                    />
                    {fieldErrors.resourceKind && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.resourceKind}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="resourceName"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>적용 리소스 이름</span>
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-rose-500 font-normal">
                        (필수)
                      </span>
                    </Label>
                    <Input
                      id="resourceName"
                      name="resourceName"
                      value={resourceName}
                      onChange={(e) => {
                        setResourceName(e.target.value);
                        clearFieldError("resourceName");
                      }}
                      placeholder="예: payment-api"
                      className={`h-11 rounded-xl border-slate-200 ${
                        fieldErrors.resourceName
                          ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                          : ""
                      }`}
                      required
                    />
                    {fieldErrors.resourceName && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.resourceName}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="startDate"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>예외 시작일</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        (자동 오늘 일자)
                      </span>
                    </Label>
                    <Input
                      id="startDate"
                      name="startDate"
                      type="date"
                      defaultValue={dateInputValue(0)}
                      className="h-11 rounded-xl border-slate-200 bg-slate-50 text-slate-500"
                      disabled
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="endDate"
                      className="flex items-center gap-1 text-xs font-semibold"
                    >
                      <span>예외 종료일</span>
                      <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-rose-500 font-normal">
                        (필수)
                      </span>
                    </Label>
                    <Input
                      id="endDate"
                      name="endDate"
                      type="date"
                      value={endDateValue}
                      onChange={(e) => {
                        setEndDateValue(e.target.value);
                        clearFieldError("endDate");
                      }}
                      className={`h-11 rounded-xl border-slate-200 ${
                        fieldErrors.endDate
                          ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                          : ""
                      }`}
                      required
                    />
                    {fieldErrors.endDate && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.endDate}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="reason"
                    className="flex items-center gap-1 text-xs font-semibold"
                  >
                    <span>예외 신청 사유</span>
                    <span className="text-rose-500 font-bold">*</span>
                    <span className="text-[10px] text-rose-500 font-normal">
                      (필수)
                    </span>
                  </Label>
                  <textarea
                    id="reason"
                    name="reason"
                    className={`${textareaClassName} ${
                      fieldErrors.reason
                        ? "border-rose-500 ring-2 ring-rose-500/10 bg-rose-50/10"
                        : ""
                    }`}
                    placeholder="예외가 필요한 배경, 영향 범위, 종료일까지의 조치 계획을 입력하세요."
                    value={reasonValue}
                    onChange={(e) => {
                      setReasonValue(e.target.value);
                      clearFieldError("reason");
                    }}
                    required
                  />
                  {fieldErrors.reason && (
                    <p className="text-[11px] text-rose-600 font-medium">
                      {fieldErrors.reason}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="attachmentNote"
                    className="flex items-center gap-1 text-xs font-semibold"
                  >
                    <span>첨부 설명 및 참고 링크</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      (선택)
                    </span>
                  </Label>
                  <textarea
                    id="attachmentNote"
                    name="attachmentNote"
                    defaultValue={
                      paramPr
                        ? paramRepo
                          ? `GitHub PR: https://github.com/${paramRepo}/pull/${paramPr}`
                          : `GitHub PR #${paramPr}`
                        : undefined
                    }
                    className="min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                    placeholder="관련 변경 요청 번호, 배포 문서, 검토 링크 등을 입력하세요."
                  />
                </div>

                <div
                  className={`rounded-xl border px-4 py-3 ${
                    errorMessage
                      ? "border-rose-100 bg-rose-50"
                      : "border-amber-100 bg-amber-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle
                      className={`mt-0.5 size-4 shrink-0 ${
                        errorMessage ? "text-rose-600" : "text-amber-600"
                      }`}
                    />
                    <div>
                      <p
                        className={`text-xs font-semibold ${
                          errorMessage ? "text-rose-800" : "text-amber-800"
                        }`}
                      >
                        {errorMessage ? "신청 실패" : "신청 전 확인"}
                      </p>
                      <p
                        className={`mt-1 text-xs leading-5 ${
                          errorMessage ? "text-rose-700" : "text-amber-700"
                        }`}
                      >
                        {errorMessage ??
                          "정책명과 규칙명은 승인 시 실제 Kyverno 정책과 대조됩니다."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
                  <Button
                    asChild
                    variant="outline"
                    className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                  >
                    <Link href="/dashboard">취소</Link>
                  </Button>
                  <Button
                    type="submit"
                    className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
                    disabled={
                      isSubmitting || isLoadingClusters || clusters.length === 0
                    }
                  >
                    <Send className="size-4" />
                    {isSubmitting ? "제출 중" : "제출"}
                  </Button>
                </div>
              </div>
            </form>

            <aside className="space-y-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                    <ShieldAlert className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">대상 위반</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      신청 대상 리소스
                    </p>
                  </div>
                </div>
                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">정책</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {policyName || "선택/입력 대기"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">규칙</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {ruleNames || "선택/입력 대기"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">리소스</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {resourceName
                        ? `${resourceKind}/${resourceName}`
                        : "선택/입력 대기"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">네임스페이스</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {resourceNamespace || "기본 (default/all)"}
                    </dd>
                  </div>
                </dl>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h3 className="text-sm font-semibold">진행 기준</h3>
                <div className="mt-5 space-y-4">
                  {requestChecklist.map(
                    ({ label, detail, icon: Icon, className }) => (
                      <div key={label} className="flex items-start gap-3">
                        <div
                          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${className}`}
                        >
                          <Icon className="size-4.5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">
                            {label}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {detail}
                          </p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Paperclip className="size-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">첨부 안내</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      현재는 설명 입력으로 대체
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-xs leading-5 text-slate-500">
                  <FileText className="mb-2 size-4 text-slate-400" />
                  변경 요청 번호, 이슈 링크, 배포 승인 문서 위치를 첨부 설명에
                  남겨주세요.
                </div>
              </article>
            </aside>
          </section>
        </div>
      </div>
    </main>
  );
}

/**
 * 사용자용 정책 예외 신청 페이지 컴포넌트입니다.
 * useSearchParams 훅을 사용하는 하위 본문 컴포넌트를 Suspense로 래핑합니다.
 */
export default function ExceptionRequestPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#f4f7fb] text-sm text-slate-500">
          정책 예외 신청 화면을 불러오는 중...
        </main>
      }
    >
      <ExceptionRequestContent />
    </Suspense>
  );
}
