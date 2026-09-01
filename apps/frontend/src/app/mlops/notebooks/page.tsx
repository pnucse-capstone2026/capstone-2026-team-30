"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import { useNotebooks } from "@/hooks/use-notebooks";
import { CreateNotebookDialog } from "./create-notebook-dialog";
import { NotebookStatusBadge } from "./notebook-status-badge";
import { NotebookActions } from "./notebook-actions";
import { CopilotDrawer } from "@/components/mlops/copilot-drawer";
import { MlopsDiagnosticModal } from "@/components/mlops/mlops-diagnostic-modal";
import {
  BookOpen,
  Cpu,
  HardDrive,
  Layers,
  PlayCircle,
  RefreshCw,
  Server,
  Sparkles,
  StopCircle,
} from "lucide-react";

export default function NotebooksPage() {
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
  const [selectedNamespace, setSelectedNamespace] = useState<string>("default");

  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [diagnosticTarget, setDiagnosticTarget] = useState<{
    name: string;
    namespace: string;
  } | null>(null);

  useEffect(() => {
    void fetchClusters();
  }, [fetchClusters]);

  const clusters = liveClusters ?? [];

  const {
    data: notebooks = [],
    isLoading,
    isRefetching,
    refetch,
  } = useNotebooks(selectedClusterId, selectedNamespace);

  const runningCount = notebooks.filter((n) => n.status === "Running").length;
  const stoppedCount = notebooks.filter((n) => n.status === "Stopped").length;
  const totalCount = notebooks.length;

  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  return (
    <ProtectedRoute>
      <DashboardPageShell
        variant={sidebarVariant}
        activeHref="/mlops/notebooks"
        title="MLOps 노트북"
        description="데이터 사이언티스트를 위한 JupyterLab 및 RStudio 워크스페이스 프로비저닝 및 생명주기 관리 플랫폼"
        actions={
          <div className="flex items-center gap-2">
            {selectedClusterId && (
              <CreateNotebookDialog
                clusterId={selectedClusterId}
                namespace={selectedNamespace}
              />
            )}
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
              />
              <span>새로고침</span>
            </button>
          </div>
        }
      >
        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
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
                className="h-9 w-32 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                전체 노트북 인스턴스
              </CardTitle>
              <BookOpen className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{totalCount}개</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                실행 중 (Active)
              </CardTitle>
              <PlayCircle className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-emerald-600">
                  {runningCount}개
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                중지됨 (Stopped)
              </CardTitle>
              <StopCircle className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-zinc-500">
                  {stoppedCount}개
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Notebook Grid / List */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : notebooks.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
            <Layers className="mx-auto h-12 w-12 text-slate-400 mb-3" />
            <h3 className="text-lg font-semibold mb-1">
              등록된 노트북이 없습니다
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              &quot;새 노트북 생성&quot; 버튼을 클릭하여 파이썬/PyTorch/RStudio
              개발 환경을 바로 구성해보세요.
            </p>
            {selectedClusterId && (
              <CreateNotebookDialog
                clusterId={selectedClusterId}
                namespace={selectedNamespace}
              />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {notebooks.map((nb) => (
              <Card
                key={nb.name}
                className="flex flex-col justify-between hover:shadow-md transition-shadow border-slate-200"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        {nb.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                        ns: {nb.namespace}
                      </p>
                    </div>
                    <NotebookStatusBadge status={nb.status} />
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs text-slate-600 pb-4">
                  <div className="flex items-center gap-2 bg-slate-100 p-2.5 rounded-md font-mono overflow-x-auto">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                    <span className="truncate">{nb.image}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-slate-400" />
                      <span>
                        CPU {nb.cpuLimit} / RAM {nb.memoryLimit}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-slate-400" />
                      <span>GPU: {nb.gpuLimit}ea</span>
                    </div>
                  </div>
                </CardContent>

                <div className="flex items-center justify-between p-4 bg-slate-50 border-t border-slate-100 rounded-b-xl">
                  <span className="text-[11px] text-muted-foreground">
                    {nb.hardwareTier}
                  </span>
                  <div className="flex items-center gap-2">
                    {nb.status === "Failed" && (
                      <button
                        onClick={() => {
                          setDiagnosticTarget({
                            name: nb.name,
                            namespace: nb.namespace,
                          });
                          setIsDiagnosticOpen(true);
                        }}
                        className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded"
                      >
                        <Sparkles className="h-3 w-3 text-amber-500" />
                        <span>Ask AI to Debug</span>
                      </button>
                    )}
                    <NotebookActions notebook={nb} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* MLOps Copilot Drawer (현재 비활성화됨) */}
        <CopilotDrawer
          enabled={false}
          activePageName="MLOps 노트북 센터"
          onRefreshList={() => refetch()}
        />

        {/* MLOps Diagnostic Modal */}
        {diagnosticTarget && (
          <MlopsDiagnosticModal
            isOpen={isDiagnosticOpen}
            onClose={() => setIsDiagnosticOpen(false)}
            resourceType="NOTEBOOK"
            resourceName={diagnosticTarget.name}
            namespace={diagnosticTarget.namespace}
            podLogs="torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 16.00 GiB (GPU 0; 15.78 GiB total capacity)"
            k8sEvents={[
              "OOMKilled: Container notebook-main killed by OS OOM-killer",
            ]}
          />
        )}
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
