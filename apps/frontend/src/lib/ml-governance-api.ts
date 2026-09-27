import { requestWithAuth } from "@/lib/api-client";

export type GpuQuotaStatus = {
  clusterId: string;
  namespace: string;
  totalLimit: number;
  usedGpus: number;
  availableGpus: number;
  usagePercentage: number;
};

export type MlGovernanceOverview = {
  clusterId: string;
  namespace: string;
  gpuQuota: GpuQuotaStatus;
  notebooks: {
    total: number;
    active: number;
    idle: number;
    stopped: number;
  };
  costSavings: {
    estimatedMonthlySavingsUsd: number;
    estimatedDailySavingsUsd: number;
    autoStoppedCount: number;
  };
  policyViolationsCount: number;
};

export type MlPolicyViolation = {
  id: string;
  clusterId: string;
  namespace: string;
  policyName: string;
  ruleName: string;
  resourceKind: string;
  resourceName: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  detectedAt: string;
  remediation: string;
};

export type GovernanceSettings = {
  idleThresholdHours: number;
  autoStopEnabled: boolean;
  notifyUser: boolean;
};

export type IdleInspectionResult = {
  scannedCount: number;
  idleDetectedCount: number;
  autoStoppedCount: number;
  stoppedNotebooks: Array<{
    clusterId: string;
    namespace: string;
    name: string;
    idleHours: number;
  }>;
};

export async function getMlGovernanceOverview(
  clusterId: string = "default",
  namespace: string = "default",
): Promise<MlGovernanceOverview> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<MlGovernanceOverview>(
    `/mlops/governance/overview?${query.toString()}`,
  );
}

export async function getGpuQuotas(
  clusterId: string = "default",
  namespace: string = "default",
): Promise<GpuQuotaStatus> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<GpuQuotaStatus>(
    `/mlops/governance/gpu-quotas?${query.toString()}`,
  );
}

export async function getMlPolicyViolations(
  clusterId?: string,
  namespace?: string,
): Promise<MlPolicyViolation[]> {
  const params = new URLSearchParams();
  if (clusterId) params.append("clusterId", clusterId);
  if (namespace) params.append("namespace", namespace);
  return requestWithAuth<MlPolicyViolation[]>(
    `/mlops/governance/violations?${params.toString()}`,
  );
}

export async function getGovernanceSettings(): Promise<GovernanceSettings> {
  return requestWithAuth<GovernanceSettings>("/mlops/governance/settings");
}

export async function updateGovernanceSettings(
  settings: Partial<GovernanceSettings>,
): Promise<GovernanceSettings> {
  return requestWithAuth<GovernanceSettings>("/mlops/governance/settings", {
    method: "PATCH",
    body: settings,
  });
}

export async function triggerIdleMonitor(
  clusterId?: string,
  namespace: string = "default",
): Promise<IdleInspectionResult> {
  const params = new URLSearchParams();
  if (clusterId) params.append("clusterId", clusterId);
  if (namespace) params.append("namespace", namespace);
  return requestWithAuth<IdleInspectionResult>(
    `/mlops/governance/idle-monitor/trigger?${params.toString()}`,
    { method: "POST" },
  );
}
