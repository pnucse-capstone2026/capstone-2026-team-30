import { Test, TestingModule } from "@nestjs/testing";
import { GpuQuotaService } from "./gpu-quota.service";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";

describe("GpuQuotaService", () => {
  let service: GpuQuotaService;
  let kubeflowAdapter: jest.Mocked<KubeflowAdapter>;

  beforeEach(async () => {
    const mockClusterProvider = {
      get: jest.fn().mockReturnValue({ customObjectsApi: {} }),
      list: jest
        .fn()
        .mockReturnValue([{ id: "default", displayName: "Local Cluster" }]),
    };

    const mockKubeflowAdapter = {
      listNotebooks: jest.fn().mockResolvedValue([
        {
          metadata: { name: "nb-1", namespace: "default" },
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: "main",
                    image: "jupyter/scipy-notebook:latest",
                    resources: { limits: { "nvidia.com/gpu": "2" } },
                  },
                ],
              },
            },
          },
        },
        {
          metadata: {
            name: "nb-2",
            namespace: "default",
            annotations: { "kubeflow-resource-stopped": "true" },
          },
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: "main",
                    image: "jupyter/scipy-notebook:latest",
                    resources: { limits: { "nvidia.com/gpu": "4" } },
                  },
                ],
              },
            },
          },
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GpuQuotaService,
        { provide: ClusterProvider, useValue: mockClusterProvider },
        { provide: KubeflowAdapter, useValue: mockKubeflowAdapter },
      ],
    }).compile();

    service = module.get<GpuQuotaService>(GpuQuotaService);
    kubeflowAdapter = module.get(KubeflowAdapter);
  });

  it("should calculate GPU quota accurately ignoring stopped notebooks", async () => {
    const status = await service.getGpuQuotaStatus("default", "default");
    expect(status.clusterId).toBe("default");
    expect(status.totalLimit).toBe(16);
    expect(status.usedGpus).toBe(2);
    expect(status.availableGpus).toBe(14);
    expect(status.usagePercentage).toBe(13);
  });

  it("should handle error gracefully and return fallback defaults", async () => {
    kubeflowAdapter.listNotebooks.mockRejectedValueOnce(
      new Error("K8s API error"),
    );
    const status = await service.getGpuQuotaStatus("default", "default");
    expect(status.usedGpus).toBe(0);
    expect(status.totalLimit).toBe(16);
    expect(status.availableGpus).toBe(16);
  });
});
