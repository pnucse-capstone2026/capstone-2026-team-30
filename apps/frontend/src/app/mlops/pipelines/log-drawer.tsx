"use client";

import { usePipelineRunLogs } from "@/hooks/use-pipelines";
import { Terminal, RefreshCw, X, Download } from "lucide-react";

interface LogDrawerProps {
  runId: string | null;
  podName: string | null;
  containerName?: string;
  stepTitle?: string;
  clusterId: string;
  namespace: string;
  onClose: () => void;
}

export function LogDrawer({
  runId,
  podName,
  containerName,
  stepTitle,
  clusterId,
  namespace,
  onClose,
}: LogDrawerProps) {
  const {
    data: logs = "",
    isLoading,
    isRefetching,
    refetch,
  } = usePipelineRunLogs(runId, podName, containerName, clusterId, namespace);

  if (!podName) return null;

  const handleDownloadLogs = () => {
    const element = document.createElement("a");
    const file = new Blob([logs], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `${podName}-logs.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-slate-950 text-slate-100 shadow-2xl border-l border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              {stepTitle || "파이프라인 컨테이너 로그"}
            </h3>
            <p className="text-xs font-mono text-slate-400 truncate max-w-md">
              pod: {podName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
            />
            <span>갱신</span>
          </button>
          <button
            onClick={handleDownloadLogs}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            <span>다운로드</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Log Output Area */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-slate-300 bg-slate-950">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            <span>Pod 실행 로그 스트림 연결 중...</span>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-all">{logs}</pre>
        )}
      </div>
    </div>
  );
}
