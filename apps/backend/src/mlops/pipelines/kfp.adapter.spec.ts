import { Test, TestingModule } from "@nestjs/testing";
import { KFPAdapter } from "./kfp.adapter";
import { ClusterProvider } from "../../kubernetes/cluster-provider";

describe("KFPAdapter", () => {
  let adapter: KFPAdapter;
  let mockClusterProvider: Partial<ClusterProvider>;
  let mockCustomObjectsApi: { listNamespacedCustomObject: jest.Mock };

  beforeEach(async () => {
    mockCustomObjectsApi = {
      listNamespacedCustomObject: jest.fn(),
    };

    mockClusterProvider = {
      get: jest.fn().mockReturnValue({
        customObjectsApi: mockCustomObjectsApi,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KFPAdapter,
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
      ],
    }).compile();

    adapter = module.get<KFPAdapter>(KFPAdapter);
  });

  it("should be defined", () => {
    expect(adapter).toBeDefined();
  });

  describe("listPipelineTemplates", () => {
    it("should return pipeline template presets", async () => {
      const templates = await adapter.listPipelineTemplates("default");
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty("id");
      expect(templates[0]).toHaveProperty("name");
    });
  });

  describe("createPipelineRun", () => {
    it("should create a new pipeline run with DAG nodes", async () => {
      const dto = {
        pipelineId: "pipe-resnet50-train",
        runName: "test-run",
        clusterId: "default",
        namespace: "kubeflow",
        parameters: { learning_rate: "0.001" },
      };

      const result = await adapter.createPipelineRun(dto);
      expect(result).toHaveProperty("id");
      expect(result.name).toBe("test-run");
      expect(result.status).toBe("Running");
      expect(result.nodes?.length).toBeGreaterThan(0);
    });
  });

  describe("listPipelineRuns", () => {
    it("should return list of workflow runs from customObjectsApi", async () => {
      mockCustomObjectsApi.listNamespacedCustomObject.mockResolvedValue({
        items: [
          {
            metadata: {
              uid: "run-1",
              name: "resnet50-run-1",
              creationTimestamp: "2026-08-27T10:00:00Z",
              labels: { "pipeline/id": "pipe-resnet50-train" },
            },
            status: { phase: "Succeeded" },
          },
        ],
      });

      const runs = await adapter.listPipelineRuns("default", "kubeflow");
      expect(runs.length).toBe(1);
      expect(runs[0].id).toBe("run-1");
      expect(runs[0].status).toBe("Succeeded");
    });
  });
});
