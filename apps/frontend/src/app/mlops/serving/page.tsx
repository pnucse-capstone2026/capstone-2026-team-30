"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  useServingEndpoints,
  useDeleteServingEndpoint,
} from "@/hooks/use-serving";
import { DeployModelDialog } from "./deploy-model-dialog";
import { CanaryTrafficSlider } from "./canary-traffic-slider";
import { ApiTestConsoleDialog } from "./api-test-console-dialog";
import { CopilotDrawer } from "@/components/mlops/copilot-drawer";
import {
  Server,
  Activity,
  Box,
  Layers,
  RefreshCw,
  Trash2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export default function ServingPage() {
  const user = useAuthStore((state) => state.user);
  const liveClusters = useDataStore((state) => state.clusters);
  const fetchClusters = useDataStore((state) => state.fetchClusters);

  const [selectedClusterId, setSelectedClusterId] = useState<string>(
    () => useDataStore.getState().clusters?.[0]?.id || "default",
  );
  const [selectedNamespace, setSelectedNamespace] =
    useState<string>("kserve-test");

  useEffect(() => {
    void (async () => {
      const data = await fetchClusters();
      if (Array.isArray(data) && data.length > 0) {
        setSelectedClusterId((prev) =>
          prev === "default" ? data[0].id : prev,
        );
      }
    })();
  }, [fetchClusters]);

  const clusters = liveClusters ?? [];

  const {
    data: endpoints = [],
    isLoading,
    isRefetching,
    refetch,
  } = useServingEndpoints(selectedClusterId, selectedNamespace);

  const deleteEndpointMutation = useDeleteServingEndpoint();

  const handleDelete = async (name: string) => {
    if (
      !confirm(
        `정말로 InferenceService 서빙 엔드포인트 '${name}'을 삭제하시겠습니까?`,
      )
    ) {
      return;
    }

    try {
      await deleteEndpointMutation.mutateAsync({
        name,
        clusterId: selectedClusterId,
        namespace: selectedNamespace,
      });
      toast.success(`서빙 엔드포인트 '${name}'이 성공적으로 삭제되었습니다.`);
    } catch {
      toast.error("엔드포인트 삭제 처리 중 오류가 발생했습니다.");
    }
  };

  const activeCount = endpoints.filter((e) => e.status === "Ready").length;
  const canaryActiveCount = endpoints.filter(
    (e) => e.canaryTrafficPercent < 100,
  ).length;

  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  return (
    <ProtectedRoute>
      <DashboardPageShell
        variant={sidebarVariant}
        activeHref="/mlops/serving"
        title="Model Serving Center (KServe)"
        description="S3/MinIO 모델 아티팩트 배포, KServe InferenceService CRD 추상화, Canary 트래픽 조절 및 대화형 API 테스트 콘솔"
        actions={
          <div className="flex items-center gap-2">
            <DeployModelDialog
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
        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium">대상 클러스터:</span>
              <select
                value={selectedClusterId}
                onChange={(e) => setSelectedClusterId(e.target.value)}
                className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                className="h-9 w-36 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Metrics Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                전체 활성 서빙 엔드포인트
              </CardTitle>
              <Box className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{endpoints.length}개</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                정상 가동 (Ready State)
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-emerald-600">
                  {activeCount}개
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Canary 트래픽 활성 모드
              </CardTitle>
              <Activity className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-indigo-600">
                  {canaryActiveCount}개 엔드포인트
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Endpoint Card Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Skeleton className="h-56 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        ) : endpoints.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
            <Layers className="mx-auto h-12 w-12 text-slate-400 mb-3" />
            <h3 className="text-lg font-semibold mb-1">
              등록된 KServe 모델 배포가 없습니다
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              &quot;신규 모델 배포&quot; 버튼을 눌러 S3 모델 바이너리를 바로
              production API 엔드포인트로 노출해보세요.
            </p>
            <DeployModelDialog
              clusterId={selectedClusterId}
              namespace={selectedNamespace}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {endpoints.map((ep) => (
              <Card
                key={ep.name}
                className="flex flex-col justify-between border-slate-200 shadow-2xs hover:shadow-xs transition-shadow"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <span>{ep.name}</span>
                        <span className="text-xs uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {ep.framework}
                        </span>
                      </CardTitle>
                      <p className="text-xs font-mono text-slate-400 mt-0.5">
                        ns: {ep.namespace}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" />
                      {ep.status}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs text-slate-600 pb-4">
                  {/* Storage URI */}
                  <div className="flex items-center gap-2 bg-slate-100 p-2.5 rounded-lg font-mono overflow-x-auto text-[11px]">
                    <Box className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="truncate">{ep.storageUri}</span>
                  </div>

                  {/* Endpoint Public URL */}
                  {ep.url && (
                    <div className="flex items-center gap-2 text-indigo-600 font-mono text-[11px] truncate">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <a
                        href={ep.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline truncate"
                      >
                        {ep.url}
                      </a>
                    </div>
                  )}

                  {/* Replica settings badge */}
                  <div className="flex items-center justify-between text-slate-500 pt-1 text-[11px]">
                    <span>
                      Scale-to-Zero 지원 (Min: {ep.minReplicas} / Max:{" "}
                      {ep.maxReplicas})
                    </span>
                    <span>
                      생성: {new Date(ep.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Canary Traffic Slider component */}
                  <CanaryTrafficSlider
                    name={ep.name}
                    currentPercent={ep.canaryTrafficPercent}
                    clusterId={selectedClusterId}
                    namespace={selectedNamespace}
                  />
                </CardContent>

                <div className="flex items-center justify-between p-4 bg-slate-50 border-t border-slate-100 rounded-b-2xl">
                  <ApiTestConsoleDialog
                    name={ep.name}
                    clusterId={selectedClusterId}
                    namespace={selectedNamespace}
                  />
                  <button
                    onClick={() => handleDelete(ep.name)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* MLOps Copilot Drawer (현재 비활성화됨) */}
        <CopilotDrawer
          enabled={false}
          activePageName="MLOps 모델 서빙 센터 (KServe)"
          onRefreshList={() => refetch()}
        />
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
