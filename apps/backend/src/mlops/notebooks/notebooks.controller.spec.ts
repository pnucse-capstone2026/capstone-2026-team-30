import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { NotebooksController } from "./notebooks.controller";
import { NotebooksService } from "./notebooks.service";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { Role } from "@prisma/client";
import { NotebookPresetsResponseDto } from "./dto/notebook-preset.dto";
import { NotebookResponseDto } from "./dto/notebook-response.dto";

describe("NotebooksController", () => {
  let controller: NotebooksController;
  let mockService: jest.Mocked<NotebooksService>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "user@example.com",
    role: Role.REQUESTER,
    clusterIds: ["cluster-1"],
  };

  beforeEach(async () => {
    mockService = {
      getPresets: jest.fn(),
      listNotebooks: jest.fn(),
      getNotebook: jest.fn(),
      createNotebook: jest.fn(),
      stopNotebook: jest.fn(),
      startNotebook: jest.fn(),
      deleteNotebook: jest.fn(),
      getNotebookUrl: jest.fn(),
      watchNotebookEvents: jest.fn(),
    } as unknown as jest.Mocked<NotebooksService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotebooksController],
      providers: [
        {
          provide: NotebooksService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotebooksController>(NotebooksController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getPresets", () => {
    it("should return presets from service", () => {
      const mockPresets: NotebookPresetsResponseDto = {
        hardwareTiers: [],
        frameworkImages: [],
      };
      mockService.getPresets.mockReturnValue(mockPresets);

      expect(controller.getPresets()).toEqual(mockPresets);
    });
  });

  describe("listNotebooks", () => {
    it("should return notebooks from service", async () => {
      mockService.listNotebooks.mockResolvedValue([]);
      const result = await controller.listNotebooks(
        { clusterId: "cluster-1", namespace: "default" },
        mockUser,
      );
      expect(result).toEqual([]);
      expect(mockService.listNotebooks).toHaveBeenCalledWith(
        "cluster-1",
        "default",
        mockUser,
      );
    });
  });

  describe("createNotebook", () => {
    it("should delegate creation to service", async () => {
      const dto = {
        name: "test-nb",
        clusterId: "cluster-1",
        hardwareTier: "CPU_SMALL",
        frameworkImage: "JUPYTER_PYTORCH",
      };
      const mockCreated: NotebookResponseDto = {
        name: "test-nb",
        namespace: "default",
        clusterId: "cluster-1",
        status: "Running",
        image: "test",
        hardwareTier: "CPU_SMALL",
        cpuLimit: "1.0",
        memoryLimit: "2Gi",
        gpuLimit: "0",
      };
      mockService.createNotebook.mockResolvedValue(mockCreated);

      const result = await controller.createNotebook(dto, mockUser);

      expect(result.name).toBe("test-nb");
      expect(mockService.createNotebook).toHaveBeenCalledWith(dto, mockUser);
    });
  });

  describe("watchEvents", () => {
    it("should delegate event stream creation to service", () => {
      const mockObservable = of({ type: "notebook-updated", data: {} });
      mockService.watchNotebookEvents.mockReturnValue(mockObservable);

      const result = controller.watchEvents("cluster-1", "default", mockUser);

      expect(result).toBe(mockObservable);
      expect(mockService.watchNotebookEvents).toHaveBeenCalledWith(
        "cluster-1",
        "default",
        mockUser,
      );
    });
  });
});
