import { Test, TestingModule } from "@nestjs/testing";
import { PipelinesService } from "./pipelines.service";
import { KFPAdapter } from "./kfp.adapter";
import { AuthenticatedUser } from "../../auth/auth.types";
import { BusinessException } from "../../common/errors/business.exception";

describe("PipelinesService", () => {
  let service: PipelinesService;
  let mockKfpAdapter: Partial<KFPAdapter>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "dev@example.com",
    role: "ADMIN",
    clusterIds: ["default"],
  };

  beforeEach(async () => {
    mockKfpAdapter = {
      listPipelineTemplates: jest.fn().mockResolvedValue([
        {
          id: "pipe-1",
          name: "Pipeline 1",
          description: "Desc",
          createdAt: "2026-08-01T00:00:00Z",
          parameters: [],
        },
      ]),
      createPipelineRun: jest.fn().mockResolvedValue({
        id: "run-1",
        pipelineId: "pipe-1",
        name: "test-run",
        status: "Running",
        clusterId: "default",
        namespace: "kubeflow",
        createdAt: "2026-08-27T10:00:00Z",
      }),
      listPipelineRuns: jest.fn().mockResolvedValue([]),
      getPipelineRun: jest.fn().mockResolvedValue({
        id: "run-1",
        pipelineId: "pipe-1",
        name: "test-run",
        status: "Running",
        clusterId: "default",
        namespace: "kubeflow",
        createdAt: "2026-08-27T10:00:00Z",
      }),
      getPodLogs: jest.fn().mockResolvedValue("sample pod log"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelinesService,
        {
          provide: KFPAdapter,
          useValue: mockKfpAdapter,
        },
      ],
    }).compile();

    service = module.get<PipelinesService>(PipelinesService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getPipelineTemplates", () => {
    it("should return pipeline templates when user has cluster access", async () => {
      const templates = await service.getPipelineTemplates("default", mockUser);
      expect(templates.length).toBe(1);
    });

    it("should throw BusinessException if user lacks cluster access", async () => {
      const unauthorizedUser: AuthenticatedUser = {
        ...mockUser,
        clusterIds: ["cluster-other"],
      };

      await expect(
        service.getPipelineTemplates("default", unauthorizedUser),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe("createRun", () => {
    it("should call adapter to create a pipeline run", async () => {
      const dto = {
        pipelineId: "pipe-1",
        runName: "test-run",
        clusterId: "default",
        namespace: "kubeflow",
      };

      const run = await service.createRun(dto, mockUser);
      expect(run.id).toBe("run-1");
      expect(mockKfpAdapter.createPipelineRun).toHaveBeenCalledWith(dto);
    });
  });
});
