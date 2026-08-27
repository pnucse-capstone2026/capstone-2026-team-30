import { Test, TestingModule } from "@nestjs/testing";
import { PipelinesController } from "./pipelines.controller";
import { PipelinesService } from "./pipelines.service";
import { AuthenticatedUser } from "../../auth/auth.types";

import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";

describe("PipelinesController", () => {
  let controller: PipelinesController;
  let mockPipelinesService: Partial<PipelinesService>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "dev@example.com",
    role: Role.ADMIN,
    clusterIds: ["default"],
  };

  beforeEach(async () => {
    mockPipelinesService = {
      getPipelineTemplates: jest.fn().mockResolvedValue([]),
      createRun: jest.fn().mockResolvedValue({
        id: "run-1",
        pipelineId: "pipe-1",
        name: "test-run",
        status: "Running",
        clusterId: "default",
        namespace: "kubeflow",
        createdAt: "2026-08-27T10:00:00Z",
      }),
      getRuns: jest.fn().mockResolvedValue([]),
      getRunDetail: jest.fn().mockResolvedValue({
        id: "run-1",
        pipelineId: "pipe-1",
        name: "test-run",
        status: "Running",
        clusterId: "default",
        namespace: "kubeflow",
        createdAt: "2026-08-27T10:00:00Z",
      }),
      getPodLogs: jest.fn().mockResolvedValue("pod log output"),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PipelinesController],
      providers: [
        {
          provide: PipelinesService,
          useValue: mockPipelinesService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PipelinesController>(PipelinesController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getTemplates", () => {
    it("should return pipeline templates", async () => {
      const result = await controller.getTemplates("default", mockUser);
      expect(result).toEqual([]);
      expect(mockPipelinesService.getPipelineTemplates).toHaveBeenCalledWith(
        "default",
        mockUser,
      );
    });
  });

  describe("createRun", () => {
    it("should trigger a new pipeline run", async () => {
      const dto = {
        pipelineId: "pipe-1",
        runName: "test-run",
        clusterId: "default",
        namespace: "kubeflow",
      };
      const result = await controller.createRun(dto, mockUser);
      expect(result.id).toBe("run-1");
      expect(mockPipelinesService.createRun).toHaveBeenCalledWith(
        dto,
        mockUser,
      );
    });
  });

  describe("getRunLogs", () => {
    it("should return pod log payload", async () => {
      const result = await controller.getRunLogs(
        "run-1",
        { podName: "test-pod", tailLines: 100 },
        "default",
        "kubeflow",
        mockUser,
      );
      expect(result).toEqual({ logs: "pod log output" });
    });
  });
});
