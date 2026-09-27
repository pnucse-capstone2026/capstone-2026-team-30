import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { NotebooksService } from "./notebooks.service";
import { KubeflowAdapter } from "./kubeflow.adapter";
import { BusinessException } from "../../common/errors/business.exception";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { Role } from "@prisma/client";

describe("NotebooksService", () => {
  let service: NotebooksService;
  let mockAdapter: jest.Mocked<KubeflowAdapter>;

  const mockAdminUser: AuthenticatedUser = {
    id: "user-admin",
    email: "admin@example.com",
    role: Role.ADMIN,
    clusterIds: ["cluster-1"],
  };

  const mockNormalUser: AuthenticatedUser = {
    id: "user-1",
    email: "user@example.com",
    role: Role.REQUESTER,
    clusterIds: ["cluster-1"],
  };

  beforeEach(async () => {
    mockAdapter = {
      listNotebooks: jest.fn(),
      getNotebook: jest.fn(),
      createNotebook: jest.fn(),
      stopNotebook: jest.fn(),
      startNotebook: jest.fn(),
      deleteNotebook: jest.fn(),
      ensureWorkspacePvc: jest.fn(),
      watchNotebooks: jest.fn(),
    } as unknown as jest.Mocked<KubeflowAdapter>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotebooksService,
        {
          provide: KubeflowAdapter,
          useValue: mockAdapter,
        },
      ],
    }).compile();

    service = module.get<NotebooksService>(NotebooksService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getPresets", () => {
    it("should return hardware and framework presets", () => {
      const presets = service.getPresets();
      expect(presets.hardwareTiers.length).toBeGreaterThan(0);
      expect(presets.frameworkImages.length).toBeGreaterThan(0);
    });
  });

  describe("listNotebooks", () => {
    it("should return mapped notebooks when user has access", async () => {
      mockAdapter.listNotebooks.mockResolvedValue([
        {
          apiVersion: "kubeflow.org/v1",
          kind: "Notebook",
          metadata: { name: "nb-1", namespace: "default" },
          spec: {
            template: {
              spec: { containers: [{ name: "nb-1", image: "test:latest" }] },
            },
          },
        },
      ]);

      const result = await service.listNotebooks(
        "cluster-1",
        "default",
        mockNormalUser,
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("nb-1");
      expect(result[0].status).toBe("Running");
    });

    it("should allow access for admin user regardless of clusterIds", async () => {
      mockAdapter.listNotebooks.mockResolvedValue([]);
      const result = await service.listNotebooks(
        "cluster-2",
        "default",
        mockAdminUser,
      );
      expect(result).toEqual([]);
    });

    it("should throw BusinessException if user lacks cluster access", async () => {
      const unauthorizedUser: AuthenticatedUser = {
        ...mockNormalUser,
        clusterIds: ["other-cluster"],
      };

      await expect(
        service.listNotebooks("cluster-1", "default", unauthorizedUser),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe("createNotebook", () => {
    it("should create notebook successfully with presets and pvc", async () => {
      mockAdapter.getNotebook.mockResolvedValue(null);
      mockAdapter.ensureWorkspacePvc.mockResolvedValue();
      mockAdapter.createNotebook.mockResolvedValue({
        apiVersion: "kubeflow.org/v1",
        kind: "Notebook",
        metadata: { name: "new-nb", namespace: "default" },
        spec: {
          template: {
            spec: { containers: [{ name: "new-nb", image: "pytorch" }] },
          },
        },
      });

      const dto = {
        name: "new-nb",
        namespace: "default",
        clusterId: "cluster-1",
        hardwareTier: "CPU_SMALL",
        frameworkImage: "JUPYTER_PYTORCH",
        storageGb: 10,
      };

      const result = await service.createNotebook(dto, mockNormalUser);

      expect(result.name).toBe("new-nb");
      expect(mockAdapter.ensureWorkspacePvc).toHaveBeenCalledWith(
        "cluster-1",
        "default",
        "new-nb-workspace-pvc",
        10,
      );
      expect(mockAdapter.createNotebook).toHaveBeenCalledWith(
        "cluster-1",
        "default",
        expect.objectContaining({
          metadata: expect.objectContaining({
            labels: expect.objectContaining({
              "app.kubernetes.io/name": "new-nb",
              team: "devops",
            }),
          }),
          spec: expect.objectContaining({
            template: expect.objectContaining({
              metadata: expect.objectContaining({
                labels: expect.objectContaining({
                  "app.kubernetes.io/name": "new-nb",
                  team: "devops",
                }),
              }),
            }),
          }),
        }),
      );
    });

    it("should create notebook successfully with CUSTOM hardware tier", async () => {
      mockAdapter.getNotebook.mockResolvedValue(null);
      mockAdapter.ensureWorkspacePvc.mockResolvedValue();
      mockAdapter.createNotebook.mockImplementation(
        async (_, __, manifest) => manifest,
      );

      const dto = {
        name: "custom-nb",
        namespace: "default",
        clusterId: "cluster-1",
        hardwareTier: "CUSTOM",
        frameworkImage: "JUPYTER_PYTORCH",
        customCpu: 4,
        customMemoryGb: 16,
        customGpu: 0,
        storageGb: 50,
      };

      const result = await service.createNotebook(dto, mockNormalUser);

      expect(result.name).toBe("custom-nb");
      expect(result.cpuLimit).toBe("4");
      expect(result.memoryLimit).toBe("16Gi");
      expect(result.gpuLimit).toBe("0");
      expect(mockAdapter.ensureWorkspacePvc).toHaveBeenCalledWith(
        "cluster-1",
        "default",
        "custom-nb-workspace-pvc",
        50,
      );
      expect(mockAdapter.createNotebook).toHaveBeenCalled();
    });

    it("should throw GPU_QUOTA_EXCEEDED when GPU tier or customGpu is requested in CPU cluster", async () => {
      const gpuDto = {
        name: "gpu-nb",
        namespace: "default",
        clusterId: "cluster-1",
        hardwareTier: "GPU_T4_STANDARD",
        frameworkImage: "JUPYTER_PYTORCH",
      };

      await expect(
        service.createNotebook(gpuDto, mockNormalUser),
      ).rejects.toThrow(BusinessException);

      const customGpuDto = {
        name: "custom-gpu-nb",
        namespace: "default",
        clusterId: "cluster-1",
        hardwareTier: "CUSTOM",
        frameworkImage: "JUPYTER_PYTORCH",
        customGpu: 1,
      };

      await expect(
        service.createNotebook(customGpuDto, mockNormalUser),
      ).rejects.toThrow(BusinessException);
    });

    it("should throw error if notebook name already exists", async () => {
      mockAdapter.getNotebook.mockResolvedValue({
        apiVersion: "kubeflow.org/v1",
        kind: "Notebook",
        metadata: { name: "existing-nb" },
        spec: {
          template: {
            spec: { containers: [{ name: "existing-nb", image: "test" }] },
          },
        },
      });

      const dto = {
        name: "existing-nb",
        clusterId: "cluster-1",
        hardwareTier: "CPU_SMALL",
        frameworkImage: "JUPYTER_PYTORCH",
      };

      await expect(service.createNotebook(dto, mockNormalUser)).rejects.toThrow(
        BusinessException,
      );
    });

    it("should throw error for invalid preset ID", async () => {
      mockAdapter.getNotebook.mockResolvedValue(null);

      const dto = {
        name: "invalid-preset-nb",
        clusterId: "cluster-1",
        hardwareTier: "INVALID_TIER",
        frameworkImage: "JUPYTER_PYTORCH",
      };

      await expect(service.createNotebook(dto, mockNormalUser)).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe("stopNotebook & startNotebook", () => {
    it("should stop existing notebook", async () => {
      mockAdapter.getNotebook.mockResolvedValue({
        apiVersion: "kubeflow.org/v1",
        kind: "Notebook",
        metadata: { name: "nb-1" },
        spec: {
          template: { spec: { containers: [{ name: "nb-1", image: "test" }] } },
        },
      });
      mockAdapter.stopNotebook.mockResolvedValue({
        apiVersion: "kubeflow.org/v1",
        kind: "Notebook",
        metadata: {
          name: "nb-1",
          annotations: { "kubeflow-resource-stopped": "true" },
        },
        spec: {
          template: { spec: { containers: [{ name: "nb-1", image: "test" }] } },
        },
      });

      const result = await service.stopNotebook(
        "cluster-1",
        "default",
        "nb-1",
        mockNormalUser,
      );

      expect(result.status).toBe("Stopped");
    });
  });

  describe("watchNotebookEvents", () => {
    it("should transform adapter watch stream to SSE message events", (done) => {
      const mockManifest = {
        apiVersion: "kubeflow.org/v1",
        kind: "Notebook",
        metadata: { name: "nb-1", namespace: "default" },
        spec: {
          template: {
            spec: { containers: [{ name: "nb-1", image: "test:latest" }] },
          },
        },
      };

      mockAdapter.watchNotebooks.mockReturnValue(
        of({ type: "MODIFIED", object: mockManifest }),
      );

      const stream$ = service.watchNotebookEvents(
        "cluster-1",
        "default",
        mockNormalUser,
      );

      stream$.subscribe((event) => {
        expect(event.type).toBe("notebook-updated");
        expect(event.data).toMatchObject({
          action: "MODIFIED",
          clusterId: "cluster-1",
          namespace: "default",
        });
        done();
      });
    });
  });
});
