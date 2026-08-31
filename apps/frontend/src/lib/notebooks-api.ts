import { requestWithAuth } from "@/lib/api-client";

export type NotebookStatus = "Running" | "Stopped" | "Pending" | "Failed";

export type NotebookItem = {
  name: string;
  namespace: string;
  clusterId: string;
  status: NotebookStatus;
  image: string;
  hardwareTier: string;
  cpuLimit: string;
  memoryLimit: string;
  gpuLimit: string;
  url?: string;
  createdAt?: string;
};

export type HardwareTierPreset = {
  id: string;
  name: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  gpuLimit: string;
  isGpuRequired: boolean;
};

export type FrameworkImagePreset = {
  id: string;
  name: string;
  image: string;
  type: "JupyterLab" | "RStudio" | "VSCode";
};

export type NotebookPresets = {
  hardwareTiers: HardwareTierPreset[];
  frameworkImages: FrameworkImagePreset[];
};

export type CreateNotebookInput = {
  name: string;
  namespace?: string;
  clusterId: string;
  hardwareTier: string;
  frameworkImage: string;
  storageGb?: number;
  customCpu?: number;
  customMemoryGb?: number;
  customGpu?: number;
};

export async function getNotebookPresets(): Promise<NotebookPresets> {
  return requestWithAuth<NotebookPresets>("/mlops/notebooks/presets");
}

export async function getNotebooks(
  clusterId: string,
  namespace: string = "default",
): Promise<NotebookItem[]> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<NotebookItem[]>(
    `/mlops/notebooks?${query.toString()}`,
  );
}

export async function getNotebook(
  name: string,
  clusterId: string,
  namespace: string = "default",
): Promise<NotebookItem> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<NotebookItem>(
    `/mlops/notebooks/${encodeURIComponent(name)}?${query.toString()}`,
  );
}

export async function createNotebook(
  input: CreateNotebookInput,
): Promise<NotebookItem> {
  return requestWithAuth<NotebookItem>("/mlops/notebooks", {
    method: "POST",
    body: input,
  });
}

export async function stopNotebook(
  name: string,
  clusterId: string,
  namespace: string = "default",
): Promise<NotebookItem> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<NotebookItem>(
    `/mlops/notebooks/${encodeURIComponent(name)}/stop?${query.toString()}`,
    { method: "POST" },
  );
}

export async function startNotebook(
  name: string,
  clusterId: string,
  namespace: string = "default",
): Promise<NotebookItem> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<NotebookItem>(
    `/mlops/notebooks/${encodeURIComponent(name)}/start?${query.toString()}`,
    { method: "POST" },
  );
}

export async function deleteNotebook(
  name: string,
  clusterId: string,
  namespace: string = "default",
): Promise<void> {
  const query = new URLSearchParams({ clusterId, namespace });
  await requestWithAuth<void>(
    `/mlops/notebooks/${encodeURIComponent(name)}?${query.toString()}`,
    { method: "DELETE" },
  );
}

export async function getNotebookUrl(
  name: string,
  clusterId: string,
  namespace: string = "default",
): Promise<{ url: string }> {
  const query = new URLSearchParams({ clusterId, namespace });
  return requestWithAuth<{ url: string }>(
    `/mlops/notebooks/${encodeURIComponent(name)}/url?${query.toString()}`,
  );
}
