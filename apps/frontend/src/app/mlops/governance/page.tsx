"use client";

import { useEffect, useState } from "react";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Badge } from "@/components/ui/badge";
import { listClusters, ClusterMetadata } from "@/lib/clusters";
import {
  useGovernanceSettings,
  useMlGovernanceOverview,
  useMlPolicyViolations,
  useTriggerIdleMonitor,
  useUpdateGovernanceSettings,
} from "@/hooks/use-ml-governance";
import { FinOpsResourceWidget } from "./finops-resource-widget";
import { MlPolicyCompliancePanel } from "./ml-policy-compliance-panel";
import { IdleSettingsPanel } from "./idle-settings-panel";
import { Coins, RefreshCw, Server, ShieldCheck } from "lucide-react";

export default function MlGovernancePage() {
  const [clusters, setClusters] = useState<ClusterMetadata[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string>("default");
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
    data: overview,
    isLoading: isLoadingOverview,
    refetch: refetchOverview,
    isRefetching,
  } = useMlGovernanceOverview(selectedClusterId, selectedNamespace);

  const { data: violations = [], isLoading: isLoadingViolations } =
    useMlPolicyViolations(selectedClusterId, selectedNamespace);

  const { data: settings, isLoading: isLoadingSettings } =
    useGovernanceSettings();

  const updateSettingsMutation = useUpdateGovernanceSettings();
  const triggerMonitorMutation = useTriggerIdleMonitor();

  const handleRefresh = () => {
    refetchOverview();
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <DashboardSidebar activeHref="/mlops/governance" />

        <main className="flex-1 p-8 overflow-y-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2">
                <Coins className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
                <h1 className="text-2xl font-bold tracking-tight">
                  MLOps Governance & FinOps
                </h1>
                <Badge
                  variant="outline"
                  className="bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
                >
                  Phase 2 Active
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                GPU 리소스 남용 방지, 유휴 노트북 자동 중지 비용 절감(60%+) 및
                Kyverno ML 정책 준수 모니터링
              </p>
            </div>
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
              onClick={handleRefresh}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
              />
              새로고침
            </button>
          </div>

          {/* Widget 1: FinOps & Resource Summary */}
          <FinOpsResourceWidget
            overview={overview}
            isLoading={isLoadingOverview}
          />

          {/* Grid Layout: Idle Settings Panel & ML Policy Compliance Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <IdleSettingsPanel
              settings={settings}
              isLoading={isLoadingSettings}
              onUpdateSettings={async (updated) =>
                updateSettingsMutation.mutateAsync(updated)
              }
              onTriggerMonitor={async () =>
                triggerMonitorMutation.mutateAsync({
                  clusterId: selectedClusterId,
                  namespace: selectedNamespace,
                })
              }
            />

            <MlPolicyCompliancePanel
              violations={violations}
              isLoading={isLoadingViolations}
            />
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
