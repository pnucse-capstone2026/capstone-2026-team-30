import { Test, TestingModule } from "@nestjs/testing";
import { KServeAdapter } from "./kserve.adapter";
import { ClusterProvider } from "../../kubernetes/cluster-provider";

import { ModelFramework } from "./dto/deploy-model.dto";

describe("KServeAdapter", () => {
  let adapter: KServeAdapter;
  let mockClusterProvider: Partial<ClusterProvider>;
  let mockCustomObjectsApi: {
    listNamespacedCustomObject: jest.Mock;
    getNamespacedCustomObject: jest.Mock;
    createNamespacedCustomObject: jest.Mock;
    patchNamespacedCustomObject: jest.Mock;
    deleteNamespacedCustomObject: jest.Mock;
  };

  beforeEach(async () => {
    mockCustomObjectsApi = {
      listNamespacedCustomObject: jest.fn(),
      getNamespacedCustomObject: jest.fn(),
      createNamespacedCustomObject: jest.fn(),
      patchNamespacedCustomObject: jest.fn(),
      deleteNamespacedCustomObject: jest.fn(),
    };

    mockClusterProvider = {
      get: jest.fn().mockReturnValue({
        customObjectsApi: mockCustomObjectsApi,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KServeAdapter,
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
      ],
    }).compile();

    adapter = module.get<KServeAdapter>(KServeAdapter);
  });

  it("should be defined", () => {
    expect(adapter).toBeDefined();
  });

  describe("listInferenceServices", () => {
    it("should return mapped list of InferenceServices", async () => {
      mockCustomObjectsApi.listNamespacedCustomObject.mockResolvedValue({
        items: [
          {
            metadata: {
              name: "resnet50-v1",
              namespace: "kserve-test",
              creationTimestamp: "2026-08-27T12:00:00Z",
            },
            spec: {
              predictor: {
                pytorch: { storageUri: "s3://ml-models/resnet50.pt" },
                minReplicas: 0,
                maxReplicas: 3,
              },
            },
            status: {
              conditions: [{ type: "Ready", status: "True" }],
            },
          },
        ],
      });

      const result = await adapter.listInferenceServices(
        "default",
        "kserve-test",
      );
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("resnet50-v1");
      expect(result[0].framework).toBe("pytorch");
      expect(result[0].minReplicas).toBe(0);
    });
  });

  describe("createInferenceService", () => {
    it("should issue create custom object request", async () => {
      const dto = {
        name: "onnx-model-v1",
        framework: ModelFramework.ONNX,
        storageUri: "s3://ml-models/onnx-v1",
        clusterId: "default",
        namespace: "kserve-test",
      };

      mockCustomObjectsApi.createNamespacedCustomObject.mockResolvedValue({
        metadata: { name: "onnx-model-v1", namespace: "kserve-test" },
        spec: { predictor: { onnx: { storageUri: "s3://ml-models/onnx-v1" } } },
      });

      const result = await adapter.createInferenceService(dto);
      expect(result.name).toBe("onnx-model-v1");
      expect(result.framework).toBe("onnx");
    });
  });
});
