import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPipelineRun,
  getPipelineRunDetail,
  getPipelineRunLogs,
  getPipelineRuns,
  getPipelineTemplates,
  CreateRunInput,
} from "@/lib/pipelines-api";

export function usePipelineTemplates(clusterId: string = "default") {
  return useQuery({
    queryKey: ["pipeline-templates", clusterId],
    queryFn: () => getPipelineTemplates(clusterId),
    staleTime: 1000 * 60 * 10,
  });
}

export function usePipelineRuns(
  clusterId: string,
  namespace: string = "kubeflow",
) {
  return useQuery({
    queryKey: ["pipeline-runs", clusterId, namespace],
    queryFn: () => getPipelineRuns(clusterId, namespace),
    enabled: Boolean(clusterId),
    refetchInterval: 5000,
  });
}

export function usePipelineRunDetail(
  runId: string | null,
  clusterId: string = "default",
  namespace: string = "kubeflow",
) {
  return useQuery({
    queryKey: ["pipeline-run-detail", runId, clusterId, namespace],
    queryFn: () => getPipelineRunDetail(runId!, clusterId, namespace),
    enabled: Boolean(runId),
    refetchInterval: 3000,
  });
}

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
    refetchInterval: 3000,
  });
}

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
