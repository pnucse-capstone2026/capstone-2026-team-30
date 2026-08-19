import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Code2,
  FilePlus2,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { AiErrorExplainerDialog } from "@/components/ai-agent/ai-error-explainer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exceptionClassName,
  policyViolations,
  severityClassName,
  statusClassName,
} from "@/lib/policy-violations";

type MyViolationDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const severityLabel = {
  critical: "긴급",
  high: "높음",
  medium: "중간",
  low: "낮음",
  info: "정보",
};

const statusLabel = {
  open: "수정 필요",
  inReview: "검토 중",
  resolved: "완료",
};

const exceptionLabel = {
  none: "예외 없음",
  requested: "예외 요청됨",
  approved: "예외 승인됨",
};

const statusIcon = {
  open: XCircle,
  inReview: Clock3,
  resolved: CheckCircle2,
};

const violationCopy: Record<
  string,
  {
    message: string;
    recommendation: string;
  }
> = {
  "vio-001": {
    message: "payment-api 컨테이너에 CPU와 memory limits가 설정되어 있지 않습니다.",
    recommendation: "컨테이너 resources.limits에 cpu와 memory 값을 추가한 뒤 다시 배포하세요.",
  },
  "vio-002": {
    message: "worker Pod가 latest 이미지 태그를 사용하고 있습니다.",
    recommendation: "재현 가능한 배포를 위해 빌드 번호나 SemVer 기반의 고정 태그를 사용하세요.",
  },
  "vio-003": {
    message: "user-service 리소스에 team 라벨이 없습니다.",
    recommendation: "metadata.labels.team 값을 추가해 소유 팀을 추적할 수 있게 하세요.",
  },
  "vio-004": {
    message: "node-exporter가 제한된 hostPath 볼륨을 사용하고 있습니다.",
    recommendation: "승인된 모니터링 목적의 예외인지 확인하고 만료 전 대체 구성을 검토하세요.",
  },
  "vio-005": {
    message: "허용된 이미지 레지스트리 접두어가 누락되어 정책 보정이 필요합니다.",
    recommendation: "이미지 경로가 승인된 레지스트리 기준을 따르도록 수정하세요.",
  },
};

export function generateStaticParams() {
  return policyViolations.map((violation) => ({
    id: violation.id,
  }));
}

export default async function MyViolationDetailPage({
  params,
}: MyViolationDetailPageProps) {
  const { id } = await params;
  const violation = policyViolations.find((item) => item.id === id);

  if (!violation) {
    notFound();
  }

  const StatusIcon = statusIcon[violation.status];
  const copy = violationCopy[violation.id];

  return (
    <DashboardPageShell
      activeHref="/violations"
      title="위반 상세"
      description="정책 위반 원인과 조치 방향을 확인합니다."
      actions={
        <Button
          asChild
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white sm:inline-flex"
        >
          <Link href="/violations">
            <ArrowLeft className="size-4" />
            목록
          </Link>
        </Button>
      }
    >
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
            <Badge className={exceptionClassName[violation.exceptionStatus]}>
              {exceptionLabel[violation.exceptionStatus]}
            </Badge>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {violation.resourceKind} / {violation.resourceName}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            {copy?.message ?? violation.message}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiErrorExplainerDialog
            errorMessage={copy?.message ?? violation.message}
            policyName={violation.policyName}
            resourceManifest={violation.manifest}
            clusterContext={violation.clusterName}
          />
          {violation.relatedExceptionId ? (
            <Button asChild className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]">
              <Link href={`/exceptions/${violation.relatedExceptionId}`}>내 신청 보기</Link>
            </Button>
          ) : (
            <Button asChild className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]">
              <Link href="/exceptions/new">
                <FilePlus2 className="size-4" />
                예외 신청 작성
              </Link>
            </Button>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <ShieldAlert className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">위반 정보</h3>
                <p className="mt-1 text-xs text-slate-400">
                  정책 엔진이 감지한 리소스와 규칙입니다.
                </p>
              </div>
            </div>
            <dl className="mt-5 grid gap-4 md:grid-cols-2">
              <InfoCard label="정책" value={violation.policyName} detail={violation.ruleName} />
              <InfoCard
                label="대상 리소스"
                value={`${violation.resourceKind} / ${violation.resourceName}`}
                detail={`${violation.clusterName} / ${violation.namespace}`}
              />
              <InfoCard label="문제 경로" value={violation.resourcePath} detail="YAML 기준 위치" />
              <InfoCard label="발생 시간" value={violation.detectedAt} detail={violation.admissionReviewId} />
            </dl>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-sm font-semibold">권장 조치</h3>
            <p className="mt-1 text-xs text-slate-400">
              예외 신청 전에 수정 가능한 항목인지 먼저 확인합니다.
            </p>
            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
              {copy?.recommendation ?? violation.recommendation}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
              <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Code2 className="size-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">리소스 매니페스트</h3>
                <p className="mt-1 text-xs text-slate-400">검사 시점의 YAML 일부</p>
              </div>
            </div>
            <pre className="overflow-x-auto p-6 text-xs leading-6 text-slate-700">
              <code>{violation.manifest}</code>
            </pre>
          </article>
        </div>

        <aside className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold">처리 상태</h3>
            <dl className="mt-5 space-y-3 text-sm">
              <StatusRow label="심각도" value={severityLabel[violation.severity]} />
              <StatusRow label="상태" value={statusLabel[violation.status]} />
              <StatusRow label="예외" value={exceptionLabel[violation.exceptionStatus]} />
              <StatusRow label="엔진 응답" value={violation.engineResponse} />
            </dl>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold">진행 이력</h3>
            <div className="mt-5 space-y-4">
              {violation.events.map((event) => (
                <div key={`${event.label}-${event.at}`} className="border-l-2 border-slate-200 pl-4">
                  <p className="text-xs font-semibold text-slate-900">{event.label}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{event.at}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {event.description}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </section>
    </DashboardPageShell>
  );
}

function InfoCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-3 break-words text-sm font-semibold text-slate-900">{value}</dd>
      <dd className="mt-1 break-words text-xs text-slate-400">{detail}</dd>
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
