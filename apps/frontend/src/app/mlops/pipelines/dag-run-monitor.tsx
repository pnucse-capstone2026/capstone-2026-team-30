"use client";

import { PipelineDagNode } from "@/lib/pipelines-api";
import { CheckCircle2, Clock, Terminal, AlertCircle } from "lucide-react";

interface DagRunMonitorProps {
  nodes?: PipelineDagNode[];
  onSelectNodeLog?: (
    podName: string,
    containerName?: string,
    stepTitle?: string,
  ) => void;
}

export function DagRunMonitor({
  nodes = [],
  onSelectNodeLog,
}: DagRunMonitorProps) {
  if (nodes.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-slate-400">
        DAG 스텝 노드가 구성되지 않았거나 로딩 중입니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
        파이프라인 DAG 워크플로우 실행 스텝
      </h4>
      <div className="flex flex-col md:flex-row items-stretch gap-3">
        {nodes.map((node, index) => {
          let statusBadgeClass = "bg-slate-100 text-slate-600 border-slate-200";
          let IconComponent = Clock;

          if (node.status === "Succeeded") {
            statusBadgeClass =
              "bg-emerald-50 text-emerald-700 border-emerald-200";
            IconComponent = CheckCircle2;
          } else if (node.status === "Running") {
            statusBadgeClass =
              "bg-amber-50 text-amber-700 border-amber-200 animate-pulse";
            IconComponent = Clock;
          } else if (node.status === "Failed") {
            statusBadgeClass = "bg-rose-50 text-rose-700 border-rose-200";
            IconComponent = AlertCircle;
          }

          return (
            <div
              key={node.id}
              className="flex-1 flex flex-col justify-between p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs hover:shadow-xs transition-shadow"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[11px] font-mono text-slate-400">
                    Step {index + 1}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusBadgeClass}`}
                  >
                    <IconComponent className="h-3 w-3" />
                    {node.status}
                  </span>
                </div>
                <h5 className="text-sm font-semibold text-slate-900 mb-1">
                  {node.displayName}
                </h5>
                {node.podName && (
                  <p className="text-[11px] font-mono text-slate-500 truncate">
                    pod: {node.podName}
                  </p>
                )}
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  {node.finishedAt
                    ? "완료됨"
                    : node.startedAt
                      ? "실행 중"
                      : "대기 중"}
                </span>
                {node.podName && onSelectNodeLog && (
                  <button
                    onClick={() =>
                      onSelectNodeLog(
                        node.podName!,
                        node.containerName,
                        node.displayName,
                      )
                    }
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                  >
                    <Terminal className="h-3 w-3" />
                    <span>로그 보기</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
