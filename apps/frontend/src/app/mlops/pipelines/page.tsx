"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import { usePipelineRuns, usePipelineRunDetail } from "@/hooks/use-pipelines";
import { PipelineExecutionForm } from "./pipeline-execution-form";
import { DagRunMonitor } from "./dag-run-monitor";
import { LogDrawer } from "./log-drawer";
import { CopilotDrawer } from "@/components/mlops/copilot-drawer";
import {
  Workflow,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Server,
  Layers,
} from "lucide-react";

export default function PipelinesPage() {
  const user = useAuthStore((state) => state.user);
  const liveClusters = useDataStore((state) => state.clusters);
  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const globalClusterId = useDataStore((state) => state.selectedClusterId);
  const setGlobalClusterId = useDataStore(
    (state) => state.setSelectedClusterId,
  );

  const selectedClusterId =
    globalClusterId ||
    user?.clusterIds?.[0] ||
    liveClusters?.[0]?.id ||
    "default";
  const [selectedNamespace, setSelectedNamespace] =
    useState<string>("kubeflow");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [activeLogPod, setActiveLogPod] = useState<{
    podName: string;
    containerName?: string;
    stepTitle?: string;
  } | null>(null);

  useEffect(() => {
    void fetchClusters();
  }, [fetchClusters]);

  const clusters = liveClusters ?? [];

  const {
    data: runs = [],
    isLoading,
    isRefetching,
    refetch,
  } = usePipelineRuns(selectedClusterId, selectedNamespace);

  const { data: activeRunDetail } = usePipelineRunDetail(
    selectedRunId,
    selectedClusterId,
    selectedNamespace,
  );

  const succeededCount = runs.filter((r) => r.status === "Succeeded").length;
  const runningCount = runs.filter((r) => r.status === "Running").length;
  const failedCount = runs.filter((r) => r.status === "Failed").length;

  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  return (
    <ProtectedRoute>
      <DashboardPageShell
        variant={sidebarVariant}
        activeHref="/mlops/pipelines"
        title="Pipeline Studio (Kubeflow Pipelines)"
        description="데이터 파이프라인 워크플로우 템플릿 제출, 하이퍼파라미터 주입, DAG 실행 모니터링 및 실시간 Pod 로그 플랫폼"
        actions={
          <div className="flex items-center gap-2">
            <PipelineExecutionForm
              clusterId={selectedClusterId}
              namespace={selectedNamespace}
            />
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 shadow-2xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
              />
              <span>새로고침</span>
            </button>
          </div>
        }
      >
        {/* Top Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium">대상 클러스터:</span>
              <select
                value={selectedClusterId}
                onChange={(e) => setGlobalClusterId(e.target.value)}
                className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || c.id}
                  </option>
                ))}
                {clusters.length === 0 && (
                  <option value="default">default (Local Cluster)</option>
                )}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">네임스페이스:</span>
              <input
                type="text"
                value={selectedNamespace}
                onChange={(e) => setSelectedNamespace(e.target.value)}
                className="h-9 w-36 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                전체 실행 이력
              </CardTitle>
              <Workflow className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{runs.length}건</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                실행 중 (Running)
              </CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-amber-600">
                  {runningCount}건
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                성공 (Succeeded)
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-emerald-600">
                  {succeededCount}건
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                실패 (Failed)
              </CardTitle>
              <AlertCircle className="h-4 w-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-rose-600">
                  {failedCount}건
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Selected Run DAG Monitor */}
        {selectedRunId && activeRunDetail && (
          <div className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>선택된 파이프라인: {activeRunDetail.name}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    ID: {activeRunDetail.id}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  생성 일시:{" "}
                  {new Date(activeRunDetail.createdAt).toLocaleString()} |
                  템플릿: {activeRunDetail.pipelineId}
                </p>
              </div>
              <button
                onClick={() => setSelectedRunId(null)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                닫기
              </button>
            </div>

            <DagRunMonitor
              nodes={activeRunDetail.nodes}
              onSelectNodeLog={(podName, containerName, stepTitle) =>
                setActiveLogPod({ podName, containerName, stepTitle })
              }
            />
          </div>
        )}

        {/* Pipeline Runs Table List */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-500" />
              <span>파이프라인 실행 히스토리</span>
            </h3>
          </div>

          {isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              등록되었거나 실행 중인 파이프라인 Run이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-100">
                  <tr>
                    <th className="p-3.5">실행 이름</th>
                    <th className="p-3.5">템플릿 ID</th>
                    <th className="p-3.5">상태</th>
                    <th className="p-3.5">네임스페이스</th>
                    <th className="p-3.5">생성 일시</th>
                    <th className="p-3.5 text-right">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="p-3.5 font-medium text-slate-900 font-mono">
                        {run.name}
                      </td>
                      <td className="p-3.5 text-slate-500 font-mono">
                        {run.pipelineId}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            run.status === "Succeeded"
                              ? "bg-emerald-100 text-emerald-800"
                              : run.status === "Running"
                                ? "bg-amber-100 text-amber-800 animate-pulse"
                                : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-slate-500">
                        {run.namespace}
                      </td>
                      <td className="p-3.5 text-slate-500">
                        {new Date(run.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => setSelectedRunId(run.id)}
                          className="px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        >
                          DAG & 로그 모니터링
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live Container Log Drawer */}
        {activeLogPod && (
          <LogDrawer
            runId={selectedRunId}
            podName={activeLogPod.podName}
            containerName={activeLogPod.containerName}
            stepTitle={activeLogPod.stepTitle}
            clusterId={selectedClusterId}
            namespace={selectedNamespace}
            onClose={() => setActiveLogPod(null)}
          />
        )}

        {/* MLOps Copilot Drawer */}
        <CopilotDrawer
          enabled={false}
          activePageName="MLOps 파이프라인 스튜디오"
          onRefreshList={() => refetch()}
        />
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
