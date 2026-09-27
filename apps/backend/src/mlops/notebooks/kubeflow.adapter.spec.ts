import { Test, TestingModule } from "@nestjs/testing";
import { KubeflowAdapter } from "./kubeflow.adapter";
import { ClusterProvider } from "../../kubernetes/cluster-provider";

describe("KubeflowAdapter", () => {
  let adapter: KubeflowAdapter;
  let mockClusterProvider: { get: jest.Mock };
  let mockCustomApi: {
    listNamespacedCustomObject: jest.Mock;
    getNamespacedCustomObject: jest.Mock;
    createNamespacedCustomObject: jest.Mock;
    patchNamespacedCustomObject: jest.Mock;
    deleteNamespacedCustomObject: jest.Mock;
  };
  let mockCoreApi: {
    readNamespacedPersistentVolumeClaim: jest.Mock;
    createNamespacedPersistentVolumeClaim: jest.Mock;
  };

  beforeEach(async () => {
    mockCustomApi = {
      listNamespacedCustomObject: jest.fn(),
      getNamespacedCustomObject: jest.fn(),
      createNamespacedCustomObject: jest.fn(),
      patchNamespacedCustomObject: jest.fn(),
      deleteNamespacedCustomObject: jest.fn(),
    };

    mockCoreApi = {
      readNamespacedPersistentVolumeClaim: jest.fn(),
      createNamespacedPersistentVolumeClaim: jest.fn(),
    };

    mockClusterProvider = {
      get: jest.fn().mockReturnValue({
        customObjectsApi: mockCustomApi,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KubeflowAdapter,
        {
          provide: ClusterProvider,
          useValue: mockClusterProvider,
        },
      ],
    }).compile();

    adapter = module.get<KubeflowAdapter>(KubeflowAdapter);

    // Mock getCoreV1Api private method for PVC testing
    jest
      .spyOn(
        adapter as unknown as { getCoreV1Api: () => typeof mockCoreApi },
        "getCoreV1Api",
      )
      .mockReturnValue(mockCoreApi as never);
  });

  it("should be defined", () => {
    expect(adapter).toBeDefined();
  });

  describe("listNotebooks", () => {
    it("should return a list of notebook manifests", async () => {
      const mockNotebooks = [
        {
          apiVersion: "kubeflow.org/v1",
          kind: "Notebook",
          metadata: { name: "nb-1", namespace: "default" },
          spec: {
            template: {
              spec: { containers: [{ name: "nb-1", image: "test" }] },
            },
          },
        },
      ];
      mockCustomApi.listNamespacedCustomObject.mockResolvedValue({
        items: mockNotebooks,
      });

      const result = await adapter.listNotebooks("cluster-1", "default");

      expect(result).toEqual(mockNotebooks);
      expect(mockCustomApi.listNamespacedCustomObject).toHaveBeenCalledWith({
        group: "kubeflow.org",
        version: "v1",
        namespace: "default",
        plural: "notebooks",
      });
    });

    it("should return empty array on 404 error", async () => {
      const error = new Error("Not Found");
      (error as { code?: number }).code = 404;
      mockCustomApi.listNamespacedCustomObject.mockRejectedValue(error);

      const result = await adapter.listNotebooks("cluster-1", "default");

      expect(result).toEqual([]);
    });
  });

  describe("getNotebook", () => {
    it("should return notebook details when found", async () => {
      const mockNotebook = {
        apiVersion: "kubeflow.org/v1",
        kind: "Notebook",
        metadata: { name: "my-notebook", namespace: "default" },
        spec: {
          template: {
            spec: { containers: [{ name: "my-notebook", image: "test" }] },
          },
        },
      };
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue(mockNotebook);

      const result = await adapter.getNotebook(
        "cluster-1",
        "default",
        "my-notebook",
      );

      expect(result).toEqual(mockNotebook);
    });

    it("should return null on 404 error", async () => {
      const error = new Error("Not Found");
      (error as { code?: number }).code = 404;
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(error);

      const result = await adapter.getNotebook(
        "cluster-1",
        "default",
        "my-notebook",
      );

      expect(result).toBeNull();
    });
  });

  describe("ensureWorkspacePvc", () => {
    it("should skip creation if PVC already exists", async () => {
      mockCoreApi.readNamespacedPersistentVolumeClaim.mockResolvedValue({
        metadata: { name: "my-pvc" },
      });

      await adapter.ensureWorkspacePvc("cluster-1", "default", "my-pvc", 10);

      expect(
        mockCoreApi.readNamespacedPersistentVolumeClaim,
      ).toHaveBeenCalledWith({
        name: "my-pvc",
        namespace: "default",
      });
      expect(
        mockCoreApi.createNamespacedPersistentVolumeClaim,
      ).not.toHaveBeenCalled();
    });

    it("should create new PVC if 404 Not Found", async () => {
      const error = new Error("Not Found");
      (error as { code?: number }).code = 404;
      mockCoreApi.readNamespacedPersistentVolumeClaim.mockRejectedValue(error);
      mockCoreApi.createNamespacedPersistentVolumeClaim.mockResolvedValue({});

      await adapter.ensureWorkspacePvc("cluster-1", "default", "my-pvc", 20);

      expect(
        mockCoreApi.createNamespacedPersistentVolumeClaim,
      ).toHaveBeenCalledWith({
        namespace: "default",
        body: expect.objectContaining({
          apiVersion: "v1",
          kind: "PersistentVolumeClaim",
          metadata: expect.objectContaining({ name: "my-pvc" }),
          spec: expect.objectContaining({
            resources: { requests: { storage: "20Gi" } },
          }),
        }),
      });
    });
  });
});
