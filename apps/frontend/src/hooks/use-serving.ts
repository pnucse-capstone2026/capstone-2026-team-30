import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteServingEndpoint,
  deployModelEndpoint,
  getServingEndpoints,
  testModelPrediction,
  updateCanaryTraffic,
  DeployModelInput,
} from "@/lib/serving-api";
import { useSseSubscription } from "./use-sse-subscription";

/**
 * KServe 서빙 엔드포인트 실시간 SSE 이벤트를 구독하여 TanStack Query 캐시를 동기화하는 훅입니다.
 */
export function useServingEvents(
  clusterId: string,
  namespace: string = "kserve-test",
) {
  const queryClient = useQueryClient();

  useSseSubscription<{
    clusterId: string;
    namespace: string;
    name?: string;
    eventType?: string;
  }>({
    path: "/mlops/serving/events",
    queryParams: { clusterId, namespace },
    events: ["serving-updated"],
    enabled: Boolean(clusterId),
    onMessage: () => {
      queryClient.invalidateQueries({
        queryKey: ["serving-endpoints", clusterId, namespace],
      });
    },
  });
}

/**
 * KServe InferenceService 서빙 엔드포인트 목록을 조회하고 실시간 SSE 이벤트 발생 시 캐시를 갱신하는 훅입니다.
 */
export function useServingEndpoints(
  clusterId: string,
  namespace: string = "kserve-test",
) {
  useServingEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["serving-endpoints", clusterId, namespace],
    queryFn: () => getServingEndpoints(clusterId, namespace),
    enabled: Boolean(clusterId),
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
