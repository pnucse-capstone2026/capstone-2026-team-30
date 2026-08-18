"use client";

import { useEffect, useState } from "react";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listClusters, ClusterMetadata } from "@/lib/clusters";
import { useNotebooks } from "@/hooks/use-notebooks";
import { CreateNotebookDialog } from "./create-notebook-dialog";
import { NotebookStatusBadge } from "./notebook-status-badge";
import { NotebookActions } from "./notebook-actions";
import {
  BookOpen,
  Cpu,
  HardDrive,
  Layers,
  PlayCircle,
  RefreshCw,
  Server,
  StopCircle,
} from "lucide-react";

export default function NotebooksPage() {
  const [clusters, setClusters] = useState<ClusterMetadata[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [selectedNamespace, setSelectedNamespace] = useState<string>("default");

  useEffect(() => {
    async function loadClusters() {
      try {
        const data = await listClusters();
        setClusters(data);
        if (data.length > 0) {
          setSelectedClusterId((prev) => prev || data[0].id);
        }
      } catch (err) {
        console.error("클러스터 목록을 불러오는 중 오류 발생:", err);
      }
    }
    loadClusters();
  }, []);

  const {
    data: notebooks = [],
    isLoading,
    isRefetching,
    refetch,
  } = useNotebooks(selectedClusterId, selectedNamespace);

  const runningCount = notebooks.filter((n) => n.status === "Running").length;
  const stoppedCount = notebooks.filter((n) => n.status === "Stopped").length;
  const totalCount = notebooks.length;

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
        <DashboardSidebar activeHref="/mlops/notebooks" />

        <main className="flex-1 p-8 overflow-y-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
                <h1 className="text-2xl font-bold tracking-tight">
                  MLOps Notebook Hub
                </h1>
                <Badge
                  variant="outline"
                  className="bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
                >
                  Phase 1 Self-Service
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                데이터 사이언티스트를 위한 JupyterLab 및 RStudio 워크스페이스
                프로비저닝 및 생명주기 관리 플랫폼
              </p>
            </div>

            {selectedClusterId && (
              <CreateNotebookDialog
                clusterId={selectedClusterId}
                namespace={selectedNamespace}
              />
            )}
          </div>

          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm mb-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium">대상 클러스터:</span>
                <select
                  value={selectedClusterId}
                  onChange={(e) => setSelectedClusterId(e.target.value)}
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

            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
              />
              새로고침
            </button>
          </div>

          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  전체 노트북 인스턴스
                </CardTitle>
                <BookOpen className="h-4 w-4 text-indigo-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCount}개</div>
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
                <div className="text-2xl font-bold text-emerald-600">
                  {runningCount}개
                </div>
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
                <div className="text-2xl font-bold text-zinc-500">
                  {stoppedCount}개
                </div>
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
            <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
              <Layers className="mx-auto h-12 w-12 text-slate-400 mb-3" />
              <h3 className="text-lg font-semibold mb-1">
                등록된 노트북이 없습니다
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
                &quot;새 노트북 생성&quot; 버튼을 클릭하여
                파이썬/PyTorch/RStudio 개발 환경을 바로 구성해보세요.
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
                  className="flex flex-col justify-between hover:shadow-md transition-shadow border-slate-200 dark:border-slate-800"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          {nb.name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          ns: {nb.namespace}
                        </p>
                      </div>
                      <NotebookStatusBadge status={nb.status} />
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 text-xs text-slate-600 dark:text-slate-400 pb-4">
                    <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-2.5 rounded-md font-mono overflow-x-auto">
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

                  <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 rounded-b-xl">
                    <span className="text-[11px] text-muted-foreground">
                      {nb.hardwareTier}
                    </span>
                    <NotebookActions notebook={nb} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
