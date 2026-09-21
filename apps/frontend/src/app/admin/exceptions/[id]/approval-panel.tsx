"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileClock,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequest,
  type ExceptionRequestStatus,
} from "@/lib/exception-requests";
import { useDataStore } from "@/lib/data-store";
import {
  approveExceptionRequest,
  cancelExceptionRequest,
  rejectExceptionRequest,
  retryExceptionRequest,
  toExceptionRequest,
} from "@/lib/exception-requests-api";

type ApprovalEvent = {
  label: string;
  at: string;
  description: string;
};

type ExceptionApprovalPanelProps = {
  request: ExceptionRequest;
  onRequestChange?: (request: ExceptionRequest) => void;
};

const statusIcon: Record<ExceptionRequestStatus, typeof Clock3> = {
  pending: Clock3,
  applying: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  cancelling: Clock3,
  expiring: FileClock,
  expired: FileClock,
  cancelled: XCircle,
  failed: XCircle,
};

const defaultDecisionNote =
  "보완 통제와 만료일을 확인했습니다. 예외 기간 동안 모니터링 결과를 남기고 만료 후 정책 기준으로 재적용합니다.";

export function ExceptionApprovalPanel({
  request,
  onRequestChange,
}: ExceptionApprovalPanelProps) {
  const [status, setStatus] = useState<ExceptionRequestStatus>(request.status);
  const [decisionNote, setDecisionNote] = useState(defaultDecisionNote);
  const [decisionAt, setDecisionAt] = useState<string | null>(
    request.status === "pending" ? null : request.requestedAt,
  );
  const [selectedRuleNames, setSelectedRuleNames] = useState<string[]>(
    request.ruleNames ?? [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatus(request.status);
    setDecisionAt(request.status === "pending" ? null : request.requestedAt);
    setSelectedRuleNames(request.ruleNames ?? []);
  }, [request]);

  const StatusIcon = statusIcon[status];
  const canDecide = status === "pending" && !isSubmitting;
  const canRetry = status === "failed" && !isSubmitting;
  const canRevoke =
    (status === "approved" || status === "applying") && !isSubmitting;
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  async function handleRevoke() {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await cancelExceptionRequest(request.id, {
        reason: revokeReason.trim() || undefined,
      });
      const updatedRequest = toExceptionRequest(response);
      setStatus(updatedRequest.status);
      setDecisionAt(new Date().toISOString().slice(0, 10));
      onRequestChange?.(updatedRequest);
      void useDataStore.getState().fetchExceptions(true);
      setIsRevokeDialogOpen(false);
      toast.success("예외를 회수하고 클러스터 리소스 삭제를 요청했습니다.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "예외 회수 처리에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

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
        label:
          status === "approved"
            ? "예외 승인"
            : status === "rejected"
              ? "예외 거절"
              : "상태 변경",
        at: decisionAt,
        description: decisionNote,
      });
    }

    return baseEvents;
  }, [decisionAt, decisionNote, request, status]);

  async function decide(nextStatus: "approved" | "rejected") {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const ruleNames =
        nextStatus === "approved" && selectedRuleNames.length > 0
          ? selectedRuleNames
          : undefined;
      const response =
        nextStatus === "approved"
          ? await approveExceptionRequest(request.id, {
              decisionNote,
              ruleNames,
            })
          : await rejectExceptionRequest(request.id, { decisionNote });
      const updatedRequest = toExceptionRequest(response);
      setStatus(updatedRequest.status);
      setDecisionAt(new Date().toISOString().slice(0, 10));
      onRequestChange?.(updatedRequest);
      void useDataStore.getState().fetchExceptions(true);
      toast.success(
        nextStatus === "approved"
          ? "예외 신청을 승인하고 적용을 시작했습니다."
          : "예외 신청을 거절했습니다.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "예외 신청 처리에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function retry() {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await retryExceptionRequest(request.id);
      const updatedRequest = toExceptionRequest(response);
      setStatus(updatedRequest.status);
      onRequestChange?.(updatedRequest);
      void useDataStore.getState().fetchExceptions(true);
      toast.success("적용 실패 요청을 재시도했습니다.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "예외 요청 재시도에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">승인 판단</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              처리 결과와 검토 메모를 남깁니다.
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

        {request.ruleNames && request.ruleNames.length > 0 ? (
          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium text-slate-600">승인 규칙</p>
            <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
              {request.ruleNames.map((ruleName) => {
                const checked = selectedRuleNames.includes(ruleName);

                return (
                  <label
                    key={ruleName}
                    className="flex items-center gap-3 text-xs font-medium text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canDecide}
                      onChange={(event) => {
                        setSelectedRuleNames((current) =>
                          event.target.checked
                            ? [...current, ruleName]
                            : current.filter((item) => item !== ruleName),
                        );
                      }}
                    />
                    <span>{ruleName}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
          <div className="flex items-center justify-between gap-3">
            <span>승인 조건</span>
            <span className="text-right font-medium text-slate-800">
              만료일 {request.expiresAt}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>검토자</span>
            <span className="text-right font-medium text-slate-800">
              {request.reviewer}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>처리 가능 여부</span>
            <span className="text-right font-medium text-slate-800">
              {status === "pending" ? "승인 대기" : "이미 처리됨"}
            </span>
          </div>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            disabled={
              !canDecide ||
              Boolean(
                request.ruleNames?.length && selectedRuleNames.length === 0,
              )
            }
            onClick={() => decide("approved")}
          >
            <CheckCircle2 className="size-4" />
            {isSubmitting ? "처리 중" : "승인"}
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
            disabled={!canDecide}
            onClick={() => decide("rejected")}
          >
            <XCircle className="size-4" />
            {isSubmitting ? "처리 중" : "거절"}
          </Button>
          {canRetry ? (
            <Button
              variant="outline"
              className="h-10 rounded-xl border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
              disabled={isSubmitting}
              onClick={() => void retry()}
            >
              <RotateCcw className="size-4" />
              {isSubmitting ? "재시도 중" : "재시도"}
            </Button>
          ) : null}
          {canRevoke ? (
            <Button
              variant="outline"
              className="h-10 rounded-xl border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
              disabled={isSubmitting}
              onClick={() => setIsRevokeDialogOpen(true)}
            >
              <AlertTriangle className="size-4" />
              {isSubmitting ? "회수 처리 중" : "예외 회수"}
            </Button>
          ) : null}
        </div>
      </article>

      <Dialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>배포된 예외 회수</DialogTitle>
            <DialogDescription>
              배포된 예외를 회수하면 대상 클러스터에서 Kyverno PolicyException
              리소스가 즉시 삭제되며 정책 위반 검사가 재개됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="revoke-reason" className="text-xs text-slate-700">
              회수 사유
            </Label>
            <textarea
              id="revoke-reason"
              placeholder="예: 보안 취약점 조치 완료, 운영 환경 긴급 보안 정책 재적용"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-800 outline-none focus:border-rose-500 focus:bg-white"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsRevokeDialogOpen(false)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={isSubmitting}
              onClick={() => void handleRevoke()}
            >
              {isSubmitting ? "회수 처리 중..." : "회수 실행"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold">처리 이력</h3>
        <div className="mt-5 max-h-64 space-y-5 overflow-y-auto pr-2">
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
              <p className="mt-2 break-all text-xs leading-5 text-slate-500">
                {event.description}
              </p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
