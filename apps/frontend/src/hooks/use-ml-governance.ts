import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getGpuQuotas,
  getGovernanceSettings,
  getMlGovernanceOverview,
  getMlPolicyViolations,
  triggerIdleMonitor,
  updateGovernanceSettings,
  GovernanceSettings,
} from "@/lib/ml-governance-api";
import { useSseSubscription } from "./use-sse-subscription";

/**
 * MLOps 거버넌스 및 GPU 쿼터 실시간 SSE 이벤트를 구독하여 TanStack Query 캐시를 최신화하는 훅입니다.
 * 단일 SSE 연결에서 도메인 이벤트별(governance-updated, gpu-quota-changed, policy-violation-detected) 캐시 무효화를 처리합니다.
 *
 * @param clusterId 조회 대상 클러스터 ID
 * @param namespace 조회 대상 네임스페이스
 */
export function useMlGovernanceEvents(
  clusterId?: string,
  namespace: string = "default",
) {
  const queryClient = useQueryClient();

  useSseSubscription({
    path: "/mlops/governance/events",
    queryParams: { clusterId: clusterId || "default", namespace },
    events: [
      "governance-updated",
      "gpu-quota-changed",
      "policy-violation-detected",
    ],
    eventHandlers: {
      "governance-updated": () => {
        queryClient.invalidateQueries({
          queryKey: ["ml-governance-overview", clusterId, namespace],
        });
        queryClient.invalidateQueries({
          queryKey: ["gpu-quotas", clusterId, namespace],
        });
        queryClient.invalidateQueries({
          queryKey: ["ml-violations", clusterId, namespace],
        });
        queryClient.invalidateQueries({
          queryKey: ["ml-governance-settings"],
        });
      },
      "gpu-quota-changed": () => {
        queryClient.invalidateQueries({
          queryKey: ["gpu-quotas", clusterId, namespace],
        });
        queryClient.invalidateQueries({
          queryKey: ["ml-governance-overview", clusterId, namespace],
        });
      },
      "policy-violation-detected": () => {
        queryClient.invalidateQueries({
          queryKey: ["ml-violations", clusterId, namespace],
        });
        queryClient.invalidateQueries({
          queryKey: ["ml-governance-overview", clusterId, namespace],
        });
      },
    },
    enabled: Boolean(clusterId),
  });
}

/**
 * MLOps 리소스 거버넌스 및 FinOps 비용 지표 개요를 조회하며, 실시간 SSE 스트림으로 캐시를 갱신합니다.
 *
 * @param clusterId 대상 클러스터 ID
 * @param namespace 대상 네임스페이스
 */
export function useMlGovernanceOverview(
  clusterId: string = "default",
  namespace: string = "default",
) {
  useMlGovernanceEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["ml-governance-overview", clusterId, namespace],
    queryFn: () => getMlGovernanceOverview(clusterId, namespace),
    enabled: Boolean(clusterId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * 클러스터/네임스페이스 단위 GPU 쿼터 현황을 조회하며, 실시간 SSE 스트림으로 캐시를 갱신합니다.
 *
 * @param clusterId 대상 클러스터 ID
 * @param namespace 대상 네임스페이스
 */
export function useGpuQuotas(
  clusterId: string = "default",
  namespace: string = "default",
) {
  useMlGovernanceEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["gpu-quotas", clusterId, namespace],
    queryFn: () => getGpuQuotas(clusterId, namespace),
    enabled: Boolean(clusterId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * MLOps 정책 위반 보고서 내역을 조회하며, 실시간 SSE 스트림으로 캐시를 갱신합니다.
 *
 * @param clusterId (선택) 클러스터 ID
 * @param namespace (선택) 네임스페이스
 */
export function useMlPolicyViolations(clusterId?: string, namespace?: string) {
  useMlGovernanceEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["ml-violations", clusterId, namespace],
    queryFn: () => getMlPolicyViolations(clusterId, namespace),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * 유휴 워크로드 자동 중지 설정을 조회합니다.
 */
export function useGovernanceSettings() {
  return useQuery({
    queryKey: ["ml-governance-settings"],
    queryFn: () => getGovernanceSettings(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * 유휴 워크로드 자동 중지 설정을 변경하는 뮤테이션 훅입니다.
 */
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

/**
 * 유휴 워크로드 자동 중지 감시를 수동으로 즉시 트리거하는 뮤테이션 훅입니다.
 */
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
