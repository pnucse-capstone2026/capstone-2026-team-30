import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createPipelineRun,
  getPipelineRunDetail,
  getPipelineRunLogs,
  getPipelineRuns,
  getPipelineTemplates,
  CreateRunInput,
} from "@/lib/pipelines-api";
import { useSseSubscription } from "./use-sse-subscription";

/**
 * 등록된 KFP 파이프라인 템플릿 목록을 조회하는 훅입니다.
 */
export function usePipelineTemplates(clusterId: string = "default") {
  return useQuery({
    queryKey: ["pipeline-templates", clusterId],
    queryFn: () => getPipelineTemplates(clusterId),
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * 파이프라인 Run 목록을 조회하고 실시간 SSE 이벤트 발생 시 캐시를 갱신하는 훅입니다.
 */
export function usePipelineRuns(
  clusterId: string,
  namespace: string = "kubeflow",
) {
  const queryClient = useQueryClient();

  useSseSubscription<{ clusterId: string; namespace: string; runId?: string }>({
    path: "/mlops/pipelines/events",
    queryParams: { clusterId, namespace },
    events: ["pipeline-updated"],
    enabled: Boolean(clusterId),
    onMessage: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["pipeline-runs", clusterId, namespace],
      });
      if (data?.runId) {
        queryClient.invalidateQueries({
          queryKey: ["pipeline-run-detail", data.runId],
        });
      }
    },
  });

  return useQuery({
    queryKey: ["pipeline-runs", clusterId, namespace],
    queryFn: () => getPipelineRuns(clusterId, namespace),
    enabled: Boolean(clusterId),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}

/**
 * 단일 파이프라인 Run 상세 및 DAG 스텝 상태를 조회하며 SSE 이벤트 수신 시 캐시를 갱신하는 훅입니다.
 */
export function usePipelineRunDetail(
  runId: string | null,
  clusterId: string = "default",
  namespace: string = "kubeflow",
) {
  const queryClient = useQueryClient();

  useSseSubscription<{ clusterId: string; namespace: string; runId?: string }>({
    path: "/mlops/pipelines/events",
    queryParams: { clusterId, namespace },
    events: ["pipeline-updated"],
    enabled: Boolean(runId && clusterId),
    onMessage: (data) => {
      if (!data?.runId || data.runId === runId) {
        queryClient.invalidateQueries({
          queryKey: ["pipeline-run-detail", runId, clusterId, namespace],
        });
        queryClient.invalidateQueries({
          queryKey: ["pipeline-run-logs", runId],
        });
      }
    },
  });

  return useQuery({
    queryKey: ["pipeline-run-detail", runId, clusterId, namespace],
    queryFn: () => getPipelineRunDetail(runId!, clusterId, namespace),
    enabled: Boolean(runId),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}

/**
 * 특정 파이프라인 스텝 Pod의 로그를 조회하는 단발성 쿼리 훅입니다. (무한 폴링 refetchInterval 제거됨)
 */
export function usePipelineRunLogs(
  runId: string | null,
  podName: string | null,
  containerName?: string,
  clusterId: string = "default",
  namespace: string = "kubeflow",
) {
  return useQuery({
    queryKey: [
      "pipeline-run-logs",
      runId,
      podName,
      containerName,
      clusterId,
      namespace,
    ],
    queryFn: () =>
      getPipelineRunLogs(runId!, podName!, containerName, clusterId, namespace),
    enabled: Boolean(runId && podName),
  });
}

/**
 * 특정 파이프라인 execution step Pod의 로그 단편을 실시간 SSE로 스트리밍 받아 누적하는 커스텀 훅입니다.
 */
export function usePipelineRunLogStream(
  runId: string | null,
  podName: string | null,
  containerName?: string,
  clusterId: string = "default",
  namespace: string = "kubeflow",
) {
  const [logs, setLogs] = useState<string[]>([]);

  useSseSubscription<{ line: string }>({
    path: `/mlops/pipelines/runs/${runId ?? ""}/logs/stream`,
    queryParams: { podName, containerName, clusterId, namespace },
    events: ["log-step"],
    enabled: Boolean(runId && podName),
    onMessage: (data) => {
      if (data?.line) {
        setLogs((prev) => [...prev, data.line]);
      }
    },
  });

  return { logs };
}

/**
 * 신규 파이프라인 Run 생성을 위한 뮤테이션 훅입니다.
 */
export function useCreatePipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRunInput) => createPipelineRun(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["pipeline-runs", variables.clusterId, variables.namespace],
      });
    },
  });
}
