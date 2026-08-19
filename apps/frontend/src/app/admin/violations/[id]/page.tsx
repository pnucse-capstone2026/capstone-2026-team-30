import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock3,
  Code2,
  Copy,
  Download,
  FileWarning,
  Menu,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { AiErrorExplainerDialog } from "@/components/ai-agent/ai-error-explainer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exceptionClassName,
  exceptionLabel,
  policyViolations,
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
} from "@/lib/policy-violations";
import { ViolationActionPanel } from "./violation-action-panel";

type AdminViolationDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const statusIcon = {
  open: XCircle,
  inReview: Clock3,
  resolved: CheckCircle2,
};

export function generateStaticParams() {
  return policyViolations.map((violation) => ({
    id: violation.id,
  }));
}

export default async function AdminViolationDetailPage({
  params,
}: AdminViolationDetailPageProps) {
  const { id } = await params;
  const violation = policyViolations.find((item) => item.id === id);

  if (!violation) {
    notFound();
  }

  const StatusIcon = statusIcon[violation.status];

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="admin" activeHref="/admin/violations" />

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
              <Link href="/admin/violations" className="hover:text-slate-900">
                정책 위반
              </Link>
              <span>/</span>
              <span className="truncate">{violation.id}</span>
            </div>
            <h1 className="mt-1 truncate text-base font-semibold tracking-tight sm:text-lg">
              {violation.policyName}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
            >
              <Link href="/admin/violations">
                <ArrowLeft className="size-4" />
                목록
              </Link>
            </Button>
            <button
              type="button"
              className="relative flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="알림 보기"
            >
              <Bell className="size-4.5" />
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-rose-500" />
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className={severityClassName[violation.severity]}>
                  <AlertTriangle className="size-3" />
                  {severityLabel[violation.severity]}
                </Badge>
                <Badge className={statusClassName[violation.status]}>
                  <StatusIcon className="size-3" />
                  {statusLabel[violation.status]}
                </Badge>
                <Badge
                  className={exceptionClassName[violation.exceptionStatus]}
                >
                  예외 {exceptionLabel[violation.exceptionStatus]}
                </Badge>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {violation.resourceKind} / {violation.resourceName}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {violation.message}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AiErrorExplainerDialog
                errorMessage={violation.message}
                policyName={violation.policyName}
                resourceManifest={violation.manifest}
                clusterContext={violation.clusterName}
              />
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
              >
                <Download className="size-4" />
                리포트
              </Button>
              {violation.relatedExceptionId ? (
                <Button
                  asChild
                  className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
                >
                  <Link
                    href={`/admin/exceptions/${violation.relatedExceptionId}`}
                  >
                    관련 예외 보기
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
                >
                  <Link href="/admin/exceptions">예외 신청 확인</Link>
                </Button>
              )}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="space-y-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <ShieldAlert className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">위반 상세</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      정책 엔진이 반환한 판정 정보입니다.
                    </p>
                  </div>
                </div>

                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  {[
                    ["정책 유형", violation.policyType],
                    ["규칙", violation.ruleName],
                    ["클러스터", violation.clusterName],
                    ["Namespace", violation.namespace],
                    ["담당자", violation.assignee],
                    ["발생 시간", violation.detectedAt],
                    ["AdmissionReview", violation.admissionReviewId],
                    ["엔진 응답", violation.engineResponse],
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">권장 조치</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      실패한 필드와 복구 방향을 확인하세요.
                    </p>
                  </div>
                  <Badge className="bg-slate-100 text-slate-600">
                    {violation.resourcePath}
                  </Badge>
                </div>
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                  {violation.recommendation}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <Code2 className="size-4.5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">
                        리소스 매니페스트
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        검사 시점의 YAML 일부
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg border-slate-200"
                  >
                    <Copy className="size-3.5" />
                    복사
                  </Button>
                </div>
                <pre className="overflow-x-auto p-5 text-xs leading-6 text-slate-700 sm:p-6">
                  <code>{violation.manifest}</code>
                </pre>
              </article>
            </div>

            <aside className="space-y-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                    <FileWarning className="size-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">조치 요약</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      현재 처리 상태
                    </p>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">심각도</span>
                    <Badge className={severityClassName[violation.severity]}>
                      {severityLabel[violation.severity]}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">상태</span>
                    <Badge className={statusClassName[violation.status]}>
                      {statusLabel[violation.status]}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">예외</span>
                    {violation.relatedExceptionId ? (
                      <Badge
                        asChild
                        className={
                          exceptionClassName[violation.exceptionStatus]
                        }
                      >
                        <Link
                          href={`/admin/exceptions/${violation.relatedExceptionId}`}
                        >
                          {exceptionLabel[violation.exceptionStatus]}
                        </Link>
                      </Badge>
                    ) : (
                      <Badge
                        className={
                          exceptionClassName[violation.exceptionStatus]
                        }
                      >
                        {exceptionLabel[violation.exceptionStatus]}
                      </Badge>
                    )}
                  </div>
                </div>
              </article>

              <ViolationActionPanel violation={violation} />
            </aside>
          </section>
        </div>
      </div>
    </main>
  );
}
