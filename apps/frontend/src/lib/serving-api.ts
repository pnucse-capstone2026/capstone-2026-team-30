import { requestWithAuth } from "./api-client";

export type InferenceServiceEndpoint = {
  name: string;
  namespace: string;
  clusterId: string;
  framework: "pytorch" | "onnx" | "tensorflow" | "sklearn";
  storageUri: string;
  status: "Ready" | "NotReady" | "Creating" | "Failed";
  url?: string;
  minReplicas: number;
  maxReplicas: number;
  canaryTrafficPercent: number;
  createdAt: string;
};

export type DeployModelInput = {
  name: string;
  framework: "pytorch" | "onnx" | "tensorflow" | "sklearn";
  storageUri: string;
  minReplicas?: number;
  maxReplicas?: number;
  canaryTrafficPercent?: number;
  clusterId: string;
  namespace: string;
};

export type PredictTestResult = {
  success: boolean;
  output: Record<string, unknown>;
  latencyMs: number;
};

/**
 * KServe Model Serving Center API Client
 */
export async function getServingEndpoints(
  clusterId: string = "default",
  namespace: string = "kserve-test",
): Promise<InferenceServiceEndpoint[]> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<InferenceServiceEndpoint[]>(
    `/mlops/serving/endpoints?${query.toString()}`,
  );
}

export async function deployModelEndpoint(
  input: DeployModelInput,
): Promise<InferenceServiceEndpoint> {
  return requestWithAuth<InferenceServiceEndpoint>("/mlops/serving/deploy", {
    method: "POST",
    body: input,
  });
}

export async function updateCanaryTraffic(
  name: string,
  canaryTrafficPercent: number,
  clusterId: string = "default",
  namespace: string = "kserve-test",
): Promise<InferenceServiceEndpoint> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<InferenceServiceEndpoint>(
    `/mlops/serving/endpoints/${encodeURIComponent(name)}/traffic?${query.toString()}`,
    {
      method: "PATCH",
      body: { canaryTrafficPercent },
    },
  );
}

export async function deleteServingEndpoint(
  name: string,
  clusterId: string = "default",
  namespace: string = "kserve-test",
): Promise<void> {
  const query = new URLSearchParams({ clusterId, namespace });
  await requestWithAuth<void>(
    `/mlops/serving/endpoints/${encodeURIComponent(name)}?${query.toString()}`,
    { method: "DELETE" },
  );
}

export async function testModelPrediction(
  name: string,
  payload: Record<string, unknown>,
  clusterId: string = "default",
  namespace: string = "kserve-test",
): Promise<PredictTestResult> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<PredictTestResult>(
    `/mlops/serving/endpoints/${encodeURIComponent(name)}/test?${query.toString()}`,
    {
      method: "POST",
      body: { payload },
    },
  );
}
