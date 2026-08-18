import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGpuQuotas,
  getGovernanceSettings,
  getMlGovernanceOverview,
  getMlPolicyViolations,
  triggerIdleMonitor,
  updateGovernanceSettings,
  GovernanceSettings,
} from "@/lib/ml-governance-api";

export function useMlGovernanceOverview(
  clusterId: string = "default",
  namespace: string = "default",
) {
  return useQuery({
    queryKey: ["ml-governance-overview", clusterId, namespace],
    queryFn: () => getMlGovernanceOverview(clusterId, namespace),
    enabled: Boolean(clusterId),
    refetchInterval: 10000, // 10초 주기 자동 갱신
  });
}

export function useGpuQuotas(
  clusterId: string = "default",
  namespace: string = "default",
) {
  return useQuery({
    queryKey: ["gpu-quotas", clusterId, namespace],
    queryFn: () => getGpuQuotas(clusterId, namespace),
    enabled: Boolean(clusterId),
    refetchInterval: 10000,
  });
}

export function useMlPolicyViolations(clusterId?: string, namespace?: string) {
  return useQuery({
    queryKey: ["ml-violations", clusterId, namespace],
    queryFn: () => getMlPolicyViolations(clusterId, namespace),
    refetchInterval: 10000,
  });
}

export function useGovernanceSettings() {
  return useQuery({
    queryKey: ["ml-governance-settings"],
    queryFn: () => getGovernanceSettings(),
  });
}

export function useUpdateGovernanceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<GovernanceSettings>) =>
      updateGovernanceSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ml-governance-settings"] });
      queryClient.invalidateQueries({ queryKey: ["ml-governance-overview"] });
    },
  });
}

export function useTriggerIdleMonitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clusterId,
      namespace = "default",
    }: {
      clusterId?: string;
      namespace?: string;
    }) => triggerIdleMonitor(clusterId, namespace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ml-governance-overview"] });
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });
}
