"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileText,
  Loader2,
  Wrench,
  X,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DiagnoseWorkloadResponse,
  diagnoseWorkload,
  WorkloadResourceType,
} from "@/lib/mlops-assistant-api";

type MlopsDiagnosticModalProps = {
  isOpen: boolean;
  onClose: () => void;
  resourceType: WorkloadResourceType;
  resourceName: string;
  namespace?: string;
  podLogs?: string;
  k8sEvents?: string[];
  onApplyFix?: (fixPayload: Record<string, any>) => void;
};

/**
 * MLOps 워크로드 실패 원인(CUDA OOM, Exit Code 137 등)을 AI로 자동 진단하는 모달 컴포넌트입니다.
 */
export function MlopsDiagnosticModal({
  isOpen,
  onClose,
  resourceType,
  resourceName,
  namespace = "default",
  podLogs,
  k8sEvents,
  onApplyFix,
}: MlopsDiagnosticModalProps) {
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnoseWorkloadResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && resourceName) {
      let isMounted = true;
      setLoading(true);
      setError(null);

      diagnoseWorkload({
        resourceType,
        resourceName,
        namespace,
        podLogs,
        k8sEvents,
      })
        .then((res) => {
          if (isMounted) setDiagnosis(res);
        })
        .catch((err) => {
          if (isMounted) setError((err as Error).message);
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });

      return () => {
        isMounted = false;
      };
    } else {
      setDiagnosis(null);
      setError(null);
    }
  }, [isOpen, resourceName, resourceType, namespace, podLogs, k8sEvents]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                MLOps 워크로드 실패 자동 진단
                <Badge
                  variant="outline"
                  className="border-cyan-500/40 text-cyan-300 text-[11px]"
                >
                  <Sparkles className="size-3 mr-1" />
                  Bedrock Claude 3.5
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                {resourceType} :: [{resourceName}] (Namespace: {namespace})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Loader2 className="size-8 animate-spin text-cyan-400" />
            <p className="text-sm font-medium text-slate-300">
              컨테이너 로그 및 K8s 이벤트를 수집하여 AI 진단을 생성 중입니다...
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-red-300 text-xs">
            진단 요청 중 오류가 발생했습니다: {error}
          </div>
        )}

        {diagnosis && !loading && (
          <div className="space-y-5 pt-2">
            {/* Root Cause Card */}
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300">
                  감지된 근본 원인 (Root Cause)
                </span>
                {diagnosis.detectedErrorCode && (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/20 text-amber-200 font-mono text-[10px]"
                  >
                    {diagnosis.detectedErrorCode}
                  </Badge>
                )}
              </div>
              <h4 className="mt-2 text-base font-bold text-white">
                {diagnosis.rootCause}
              </h4>
              <p className="mt-1 text-xs text-amber-200/90 leading-relaxed">
                {diagnosis.summary}
              </p>
            </div>

            {/* Technical Detail Analysis */}
            <div className="space-y-1.5">
              <h5 className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <FileText className="size-3.5 text-cyan-400" />
                세부 기술 분석
              </h5>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs text-slate-300 leading-relaxed font-mono">
                {diagnosis.detailedDiagnosis}
              </div>
            </div>

            {/* Recommended Fixes */}
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <Wrench className="size-3.5 text-emerald-400" />
                AI 권장 대처 방안 및 원클릭 복구
              </h5>
              <div className="space-y-2">
                {diagnosis.recommendedFixes.map((fix, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-800/60 p-3"
                  >
                    <div>
                      <h6 className="text-xs font-bold text-slate-100">
                        {fix.title}
                      </h6>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {fix.description}
                      </p>
                    </div>
                    {fix.payload && onApplyFix && (
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium"
                        onClick={() => onApplyFix(fix.payload!)}
                      >
                        <CheckCircle2 className="size-3.5 mr-1" />
                        조치 적용
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-3 border-t border-slate-800">
          <Button
            variant="outline"
            className="border-slate-700 text-slate-300 text-xs"
            onClick={onClose}
          >
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
