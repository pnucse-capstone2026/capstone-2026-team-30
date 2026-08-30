"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
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
import { RefreshCw, Server } from "lucide-react";

export default function MlGovernancePage() {
  const user = useAuthStore((state) => state.user);
  const liveClusters = useDataStore((state) => state.clusters);
  const fetchClusters = useDataStore((state) => state.fetchClusters);

  const [selectedClusterId, setSelectedClusterId] = useState<string>(
    () => useDataStore.getState().clusters?.[0]?.id || "default",
  );
  const [selectedNamespace, setSelectedNamespace] = useState<string>("default");

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

  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  return (
    <ProtectedRoute>
      <DashboardPageShell
        variant={sidebarVariant}
        activeHref="/mlops/governance"
        title="MLOps Governance & FinOps"
        description="GPU 리소스 남용 방지, 유휴 노트북 자동 중지 비용 절감(60%+) 및 Kyverno ML 정책 준수 모니터링"
        actions={
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
            />
            <span>새로고침</span>
          </button>
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

          <Badge
            variant="outline"
            className="bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
          >
            Phase 2 Active
          </Badge>
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
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
