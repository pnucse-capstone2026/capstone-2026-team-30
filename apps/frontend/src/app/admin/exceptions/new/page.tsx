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
  FilePlus2,
  FileText,
  Menu,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { NotificationDropdown } from "@/components/dashboard/notification-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ClusterMetadata, listClusters } from "@/lib/clusters";
import { createExceptionRequest } from "@/lib/exception-requests-api";
import {
  policyViolations,
  type PolicyViolation,
} from "@/lib/policy-violations";

const fieldClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10";

const textareaClassName =
  "min-h-32 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10";

function dateInputValue(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function expirationFromDateInput(value: string) {
  return new Date(`${value}T23:59:59.000Z`).toISOString();
}

/**
 * 관리자 전용 신규 예외 신청/발급 폼 내부 본문 컴포넌트입니다.
 * URL 쿼리 파라미터를 파싱하여 위반 대상 리소스 정보를 자동으로 입력 폼에 채웁니다.
 */
function AdminNewExceptionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramPolicy = searchParams.get("policy") || "";
  const paramRule = searchParams.get("rule") || "";
  const paramCluster = searchParams.get("cluster") || "";
  const paramResource = searchParams.get("resource") || "";
  const paramKind = searchParams.get("kind") || "";
  const paramNamespace = searchParams.get("namespace") || "";

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

  const defaultEndDate = useMemo(() => dateInputValue(14), []);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableClusters() {
      setIsLoadingClusters(true);
      setClusterErrorMessage(null);

      try {
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
      label: "대상 정책 및 리소스",
      detail:
        policyName && resourceName
          ? `${policyName} / ${resourceName}`
          : "위반 리소스 지정",
      icon: ShieldAlert,
      className: "bg-rose-50 text-rose-600",
    },
    {
      label: "예외 유효 기간",
      detail: "기본 14일 설정 (최대 90일)",
      icon: CalendarDays,
      className: "bg-blue-50 text-blue-600",
    },
    {
      label: "관리자 직접 등록",
      detail: "등록 즉시 예외 관리 목록에 반영",
      icon: Clock3,
      className: "bg-emerald-50 text-emerald-600",
    },
  ];

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reasonValue, setReasonValue] = useState(
    "운영 긴급 조치 및 마이그레이션 일정에 따른 임시 예외 등록",
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
    if (!formPolicy) errors.policyName = "대상 정책명을 입력하세요. (필수)";
    if (formRules.length === 0)
      errors.ruleNames = "정책 규칙명을 하나 이상 입력하세요. (필수)";
    if (!targetClusterId)
      errors.targetClusterId = "대상 클러스터를 선택하세요. (필수)";
    if (!formKind)
      errors.resourceKind = "리소스 종류(Kind)를 입력하세요. (필수)";
    if (!formResource)
      errors.resourceName = "적용 리소스 이름을 입력하세요. (필수)";
    if (!endDate) errors.endDate = "예외 종료일을 지정하세요. (필수)";
    if (!reason) errors.reason = "예외 등록 사유를 입력하세요. (필수)";

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
      ? `${reason}\n\n[관리자 비고]: ${attachmentNote}`
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
      toast.success("정책 예외 신청이 등록되었습니다.");
      router.push("/admin/exceptions");
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "예외 신청을 등록하지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

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
          <div>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              신규 예외 등록
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              관리자 권한으로 특정 리소스에 대한 정책 예외를 직접 등록하고
              적용합니다.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
            >
              <Link href="/admin/exceptions">
                <ArrowLeft className="size-4" />
                예외 관리 목록
              </Link>
            </Button>
            <NotificationDropdown />
          </div>
        </header>

        <div className="mx-auto max-w-[1280px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-[#0b2342] text-white hover:bg-[#0b2342]">
                  관리자 콘솔
                </Badge>
                <span className="text-xs text-slate-400">
                  등록된 예외는 정책 엔진(Kyverno PolicyException)에 반영 준비
                  상태로 기록됩니다.
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                정책 예외 등록서
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                특정 워크로드 및 네임스페이스에 대해 기간 한정 정책 검사 예외를
                생성합니다.
              </p>
            </div>
            {paramResource && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
                <CheckCircle2 className="size-4" />
                선택된 정책 오류 리소스 정보가 자동으로 바인딩되었습니다.
              </div>
            )}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <form
              className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              onSubmit={handleSubmit}
            >
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-sm font-semibold">예외 대상 정보</h3>
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
                      <span>대상 정책명</span>
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
                      <span>정책 규칙명</span>
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
                    {fieldErrors.ruleNames && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {fieldErrors.ruleNames}
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
                        <option value="">등록된 클러스터가 없습니다</option>
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
                      <span>리소스 종류 (Kind)</span>
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
                    <span>예외 등록 사유</span>
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
                    placeholder="예외가 필요한 업무적 배경, 긴급성 및 사유를 입력하세요."
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
                    <span>관리자 검토 메모 및 링크</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      (선택)
                    </span>
                  </Label>
                  <textarea
                    id="attachmentNote"
                    name="attachmentNote"
                    className="min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
                    placeholder="티켓 번호, 승인 근거 문서 링크 등을 입력하세요."
                  />
                </div>

                {errorMessage && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 sm:px-6">
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-slate-200 text-slate-700"
                >
                  <Link href="/admin/exceptions">취소 및 목록으로</Link>
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-10 gap-2 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
                >
                  <Send className="size-4" />
                  {isSubmitting ? "등록 중..." : "예외 직접 등록"}
                </Button>
              </div>
            </form>

            <div className="space-y-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h3 className="text-sm font-semibold">등록 요약</h3>
                <div className="mt-4 space-y-3">
                  {requestChecklist.map(
                    ({ label, detail, icon: Icon, className }) => (
                      <div
                        key={label}
                        className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                      >
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${className}`}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-800">
                            {label}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">
                            {detail}
                          </p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h3 className="text-sm font-semibold">관리자 안내 사항</h3>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-500">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-cyan-500" />
                    <span>
                      관리자가 등록한 예외는 관리자 예외 관리 화면에서 즉시 검토
                      및 승인 처리할 수 있습니다.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-cyan-500" />
                    <span>
                      만료일이 지나면 Kyverno 정책 엔진에 의해 자동으로 정책
                      검사가 다시 활성화됩니다.
                    </span>
                  </li>
                </ul>
              </article>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function AdminNewExceptionPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#f4f7fb] text-sm text-slate-500">
          신규 예외 등록 화면을 불러오는 중...
        </main>
      }
    >
      <AdminNewExceptionContent />
    </Suspense>
  );
}
