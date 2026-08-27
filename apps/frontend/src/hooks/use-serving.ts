import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteServingEndpoint,
  deployModelEndpoint,
  getServingEndpoints,
  testModelPrediction,
  updateCanaryTraffic,
  DeployModelInput,
} from "@/lib/serving-api";

export function useServingEndpoints(
  clusterId: string,
  namespace: string = "kserve-test",
) {
  return useQuery({
    queryKey: ["serving-endpoints", clusterId, namespace],
    queryFn: () => getServingEndpoints(clusterId, namespace),
    enabled: Boolean(clusterId),
    refetchInterval: 5000,
  });
}

export function useDeployModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeployModelInput) => deployModelEndpoint(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "serving-endpoints",
          variables.clusterId,
          variables.namespace,
        ],
      });
    },
  });
}

export function useUpdateCanaryTraffic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      canaryTrafficPercent,
      clusterId,
      namespace = "kserve-test",
    }: {
      name: string;
      canaryTrafficPercent: number;
      clusterId: string;
      namespace?: string;
    }) => updateCanaryTraffic(name, canaryTrafficPercent, clusterId, namespace),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "serving-endpoints",
          variables.clusterId,
          variables.namespace || "kserve-test",
        ],
      });
    },
  });
}

export function useDeleteServingEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      clusterId,
      namespace = "kserve-test",
    }: {
      name: string;
      clusterId: string;
      namespace?: string;
    }) => deleteServingEndpoint(name, clusterId, namespace),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "serving-endpoints",
          variables.clusterId,
          variables.namespace || "kserve-test",
        ],
      });
    },
  });
}

export function useTestPrediction() {
  return useMutation({
    mutationFn: ({
      name,
      payload,
      clusterId,
      namespace = "kserve-test",
    }: {
      name: string;
      payload: Record<string, unknown>;
      clusterId: string;
      namespace?: string;
    }) => testModelPrediction(name, payload, clusterId, namespace),
  });
}
