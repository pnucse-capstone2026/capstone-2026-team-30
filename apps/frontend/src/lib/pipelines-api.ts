import { requestWithAuth } from "./api-client";

export type PipelineTemplate = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  parameters: Array<{
    name: string;
    defaultValue?: string;
    description?: string;
  }>;
};

export type PipelineDagNode = {
  id: string;
  displayName: string;
  status: "Pending" | "Running" | "Succeeded" | "Failed" | "Skipped";
  podName?: string;
  containerName?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type PipelineRun = {
  id: string;
  pipelineId: string;
  name: string;
  status: "Pending" | "Running" | "Succeeded" | "Failed" | "Terminated";
  clusterId: string;
  namespace: string;
  createdAt: string;
  finishedAt?: string;
  parameters?: Record<string, unknown>;
  nodes?: PipelineDagNode[];
};

export type CreateRunInput = {
  pipelineId: string;
  runName: string;
  parameters?: Record<string, unknown>;
  clusterId: string;
  namespace: string;
};

/**
 * Kubeflow Pipelines (KFP) API Client
 */
export async function getPipelineTemplates(
  clusterId: string = "default",
): Promise<PipelineTemplate[]> {
  const query = new URLSearchParams({ clusterId });
  return requestWithAuth<PipelineTemplate[]>(
    `/mlops/pipelines/templates?${query.toString()}`,
  );
}

export async function getPipelineRuns(
  clusterId: string = "default",
  namespace: string = "kubeflow",
): Promise<PipelineRun[]> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<PipelineRun[]>(
    `/mlops/pipelines/runs?${query.toString()}`,
  );
}

export async function createPipelineRun(
  input: CreateRunInput,
): Promise<PipelineRun> {
  return requestWithAuth<PipelineRun>("/mlops/pipelines/runs", {
    method: "POST",
    body: input,
  });
}

export async function getPipelineRunDetail(
  runId: string,
  clusterId: string = "default",
  namespace: string = "kubeflow",
): Promise<PipelineRun> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<PipelineRun>(
    `/mlops/pipelines/runs/${encodeURIComponent(runId)}?${query.toString()}`,
  );
}

export async function getPipelineRunLogs(
  runId: string,
  podName: string,
  containerName?: string,
  clusterId: string = "default",
  namespace: string = "kubeflow",
): Promise<string> {
  const queryParams: Record<string, string> = { podName, clusterId, namespace };
  if (containerName) queryParams.containerName = containerName;
  const query = new URLSearchParams(queryParams);

  const res = await requestWithAuth<{ logs: string }>(
    `/mlops/pipelines/runs/${encodeURIComponent(runId)}/logs?${query.toString()}`,
  );
  return res.logs;
}
