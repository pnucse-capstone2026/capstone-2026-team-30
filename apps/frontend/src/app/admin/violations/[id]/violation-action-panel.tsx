"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  statusClassName,
  statusLabel,
  type PolicyViolation,
  type ViolationStatus,
} from "@/lib/policy-violations";

type ViolationActionPanelProps = {
  violation: PolicyViolation;
};

const statusIcon: Record<ViolationStatus, typeof XCircle> = {
  open: XCircle,
  inReview: Clock3,
  resolved: CheckCircle2,
};

export function ViolationActionPanel({ violation }: ViolationActionPanelProps) {
  const [status, setStatus] = useState<ViolationStatus>(violation.status);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const StatusIcon = statusIcon[status];
  const events = useMemo(
    () => [
      ...violation.events,
      ...(checkedAt
        ? [
            {
              label: status === "resolved" ? "해결 완료 처리" : "검토 상태 변경",
              at: checkedAt,
              description:
                status === "resolved"
                  ? "관리자가 권장 조치 적용 후 해결 완료로 표시했습니다."
                  : "관리자가 위반 항목을 검토 중 상태로 표시했습니다.",
            },
          ]
        : []),
    ],
    [checkedAt, status, violation.events],
  );

  function updateStatus(nextStatus: ViolationStatus) {
    setStatus(nextStatus);
    setCheckedAt("2026-07-09");
  }

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">처리 상태 변경</h3>
            <p className="mt-1 text-xs text-slate-400">
              현재 단계에서는 화면 상태만 변경됩니다.
            </p>
          </div>
          <Badge className={statusClassName[status]}>
            <StatusIcon className="size-3" />
            {statusLabel[status]}
          </Badge>
        </div>

        <div className="mt-5 grid gap-3">
          <Button
            variant="outline"
            className="h-10 justify-start rounded-xl border-slate-200 bg-white text-slate-700"
            disabled={status === "inReview"}
            onClick={() => updateStatus("inReview")}
          >
            <Clock3 className="size-4" />
            검토 중으로 변경
          </Button>
          <Button
            className="h-10 justify-start rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            disabled={status === "resolved"}
            onClick={() => updateStatus("resolved")}
          >
            <CheckCircle2 className="size-4" />
            해결 완료 처리
          </Button>
          <Button
            variant="outline"
            className="h-10 justify-start rounded-xl border-slate-200 bg-white text-slate-700"
            onClick={() => updateStatus(violation.status)}
          >
            <RefreshCw className="size-4" />
            초기 상태로 되돌리기
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
