"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileClock, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequest,
  type ExceptionRequestStatus,
} from "@/lib/exception-requests";

type ApprovalEvent = {
  label: string;
  at: string;
  description: string;
};

type ExceptionApprovalPanelProps = {
  request: ExceptionRequest;
};

const statusIcon: Record<ExceptionRequestStatus, typeof Clock3> = {
  pending: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  expired: FileClock,
};

const defaultDecisionNote =
  "보완 통제와 만료일을 확인했습니다. 예외 기간 동안 모니터링 결과를 남기고 만료 후 정책 기준으로 재적용합니다.";

export function ExceptionApprovalPanel({ request }: ExceptionApprovalPanelProps) {
  const [status, setStatus] = useState<ExceptionRequestStatus>(request.status);
  const [decisionNote, setDecisionNote] = useState(defaultDecisionNote);
  const [decisionAt, setDecisionAt] = useState<string | null>(
    request.status === "pending" ? null : request.requestedAt,
  );

  const StatusIcon = statusIcon[status];
  const canDecide = status === "pending";

  const events = useMemo<ApprovalEvent[]>(() => {
    const baseEvents: ApprovalEvent[] = [
      {
        label: "예외 신청 접수",
        at: request.requestedAt,
        description: `${request.requester} / ${request.team}에서 ${request.policyName} 예외를 신청했습니다.`,
      },
      {
        label: "위험도 검토",
        at: request.requestedAt,
        description: `대상 클러스터는 ${request.clusterName}, 네임스페이스는 ${request.namespace}입니다.`,
      },
    ];

    if (decisionAt) {
      baseEvents.push({
        label: status === "approved" ? "예외 승인" : status === "rejected" ? "예외 거절" : "상태 변경",
        at: decisionAt,
        description: decisionNote,
      });
    }

    return baseEvents;
  }, [decisionAt, decisionNote, request, status]);

  function decide(nextStatus: "approved" | "rejected") {
    setStatus(nextStatus);
    setDecisionAt("2026-07-09");
  }

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">승인 판단</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              처리 결과와 검토 메모를 남깁니다. 현재 단계에서는 화면 상태만 변경됩니다.
            </p>
          </div>
          <Badge className={exceptionStatusClassName[status]}>
            <StatusIcon className="size-3" />
            {exceptionStatusLabel[status]}
          </Badge>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="decision-note" className="text-xs text-slate-600">
            검토 메모
          </Label>
          <textarea
            id="decision-note"
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.target.value)}
            className="min-h-28 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-3 focus:ring-blue-500/10"
          />
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
          <div className="flex items-center justify-between gap-3">
            <span>승인 조건</span>
            <span className="text-right font-medium text-slate-800">만료일 {request.expiresAt}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>검토자</span>
            <span className="text-right font-medium text-slate-800">{request.reviewer}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>처리 가능 여부</span>
            <span className="text-right font-medium text-slate-800">
              {canDecide ? "승인 대기" : "이미 처리됨"}
            </span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            disabled={!canDecide}
            onClick={() => decide("approved")}
          >
            <CheckCircle2 className="size-4" />
            승인
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
            disabled={!canDecide}
            onClick={() => decide("rejected")}
          >
            <XCircle className="size-4" />
            거절
          </Button>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold">처리 이력</h3>
        <div className="mt-5 space-y-5">
          {events.map((event, index) => (
            <div key={`${event.label}-${event.at}-${index}`} className="relative pl-6">
              <span className="absolute top-1.5 left-0 size-2 rounded-full bg-blue-500" />
              {index < events.length - 1 ? (
                <div className="absolute top-4 bottom-[-22px] left-[3px] w-px bg-slate-200" />
              ) : null}
              <p className="text-xs font-semibold text-slate-900">{event.label}</p>
              <p className="mt-1 text-[11px] text-slate-400">{event.at}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{event.description}</p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
