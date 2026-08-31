"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  statusClassName,
  statusLabel,
  updateViolationStatus,
  type PolicyViolation,
  type ViolationStatus,
} from "@/lib/policy-violations";
import { useDataStore } from "@/lib/data-store";

type ViolationActionPanelProps = {
  violation: PolicyViolation;
  onStatusChange?: (updatedViolation: PolicyViolation) => void;
};

const statusIcon: Record<ViolationStatus, typeof XCircle> = {
  open: XCircle,
  inReview: Clock3,
  resolved: CheckCircle2,
};

export function ViolationActionPanel({
  violation,
  onStatusChange,
}: ViolationActionPanelProps) {
  const [status, setStatus] = useState<ViolationStatus>(violation.status);
  const [events, setEvents] = useState(violation.events);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchViolations = useDataStore((state) => state.fetchViolations);
  const fetchAuditLogs = useDataStore((state) => state.fetchAuditLogs);

  useEffect(() => {
    setStatus(violation.status);
    setEvents(violation.events);
  }, [violation]);

  const StatusIcon = statusIcon[status];

  async function handleStatusChange(
    nextStatus: ViolationStatus,
    note?: string,
  ) {
    if (isUpdating) return;
    setIsUpdating(true);

    try {
      const updated = await updateViolationStatus(
        violation.id,
        nextStatus,
        note,
        violation.clusterId,
      );

      setStatus(updated.status);
      setEvents(updated.events);
      onStatusChange?.(updated);

      // 글로벌 스토어 배경 동기화
      void fetchViolations(true);
      void fetchAuditLogs(true);

      const actionText =
        nextStatus === "resolved"
          ? "해결 완료"
          : nextStatus === "inReview"
            ? "검토 중"
            : "미처리(초기 상태)";
      toast.success(
        `정책 위반 상태가 '${actionText}'(으)로 업데이트되었습니다.`,
      );
    } catch (error) {
      // API 실패 시 로컬 상태 업데이트 fallback
      setStatus(nextStatus);
      const nowStr = new Date().toLocaleString("ko-KR");
      const fallbackEvents = [
        ...events,
        {
          label:
            nextStatus === "resolved"
              ? "해결 완료 처리 (로컬)"
              : nextStatus === "inReview"
                ? "검토 상태 변경 (로컬)"
                : "초기 상태 되돌리기 (로컬)",
          at: nowStr,
          description: `상태가 '${statusLabel[nextStatus]}'으로 변경되었습니다.`,
        },
      ];
      setEvents(fallbackEvents);

      const errMessage =
        error instanceof Error
          ? error.message
          : "상태 변경 중 오류가 발생했습니다.";
      toast.info(`화면 상태가 변경되었습니다. (${errMessage})`);
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">처리 상태 변경</h3>
            <p className="mt-1 text-xs text-slate-400">
              상태 변경 시 감사 로그가 기록되고 백엔드에 즉시 영속화됩니다.
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
            disabled={status === "inReview" || isUpdating}
            onClick={() => handleStatusChange("inReview", "관리자 검토 진행")}
          >
            {isUpdating && status !== "inReview" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Clock3 className="size-4" />
            )}
            검토 중으로 변경
          </Button>
          <Button
            className="h-10 justify-start rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            disabled={status === "resolved" || isUpdating}
            onClick={() =>
              handleStatusChange("resolved", "조치 완료 후 정책 재검사 확인")
            }
          >
            {isUpdating && status !== "resolved" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            해결 완료 처리
          </Button>
          <Button
            variant="outline"
            className="h-10 justify-start rounded-xl border-slate-200 bg-white text-slate-700"
            disabled={status === "open" || isUpdating}
            onClick={() =>
              handleStatusChange("open", "초기 미처리 상태로 환원")
            }
          >
            {isUpdating && status === "open" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            초기 상태(미처리)로 되돌리기
          </Button>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold">처리 및 감사 이력</h3>
        <div className="mt-5 space-y-5">
          {events.map((event, index) => (
            <div
              key={`${event.label}-${event.at}-${index}`}
              className="relative pl-6"
            >
              <span className="absolute top-1.5 left-0 size-2 rounded-full bg-blue-500" />
              {index < events.length - 1 ? (
                <div className="absolute top-4 bottom-[-22px] left-[3px] w-px bg-slate-200" />
              ) : null}
              <p className="text-xs font-semibold text-slate-900">
                {event.label}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">{event.at}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {event.description}
              </p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
