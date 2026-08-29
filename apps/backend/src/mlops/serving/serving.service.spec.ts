import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { ServingService } from "./serving.service";
import { KServeAdapter } from "./kserve.adapter";
import { AuthenticatedUser } from "../../auth/auth.types";
import { BusinessException } from "../../common/errors/business.exception";
import { ModelFramework } from "./dto/deploy-model.dto";

describe("ServingService", () => {
  let service: ServingService;
  let mockKserveAdapter: Partial<KServeAdapter>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "dev@example.com",
    role: "ADMIN",
    clusterIds: ["default"],
  };

  beforeEach(async () => {
    mockKserveAdapter = {
      listInferenceServices: jest.fn().mockResolvedValue([]),
      watchInferenceServiceEvents: jest.fn().mockReturnValue(
        of({
          event: "serving-updated",
          data: {
            eventType: "MODIFIED",
            clusterId: "default",
            namespace: "kserve-test",
            name: "resnet50-v1",
          },
        }),
      ),
      createInferenceService: jest.fn().mockResolvedValue({
        name: "resnet50-v1",
        namespace: "kserve-test",
        clusterId: "default",
        framework: "pytorch",
        storageUri: "s3://ml-models/resnet50",
        status: "Ready",
        minReplicas: 1,
        maxReplicas: 3,
        canaryTrafficPercent: 100,
        createdAt: "2026-08-27T12:00:00Z",
      }),
      updateTrafficSplit: jest.fn().mockResolvedValue({
        name: "resnet50-v1",
        namespace: "kserve-test",
        clusterId: "default",
        framework: "pytorch",
        storageUri: "s3://ml-models/resnet50",
        status: "Ready",
        minReplicas: 1,
        maxReplicas: 3,
        canaryTrafficPercent: 20,
        createdAt: "2026-08-27T12:00:00Z",
      }),
      deleteInferenceService: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServingService,
        {
          provide: KServeAdapter,
          useValue: mockKserveAdapter,
        },
      ],
    }).compile();

    service = module.get<ServingService>(ServingService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("deployModel", () => {
    it("should deploy model successfully with valid S3 storageUri", async () => {
      const dto = {
        name: "resnet50-v1",
        framework: ModelFramework.PYTORCH,
        storageUri: "s3://ml-models/resnet50",
        clusterId: "default",
        namespace: "kserve-test",
      };

      const result = await service.deployModel(dto, mockUser);
      expect(result.name).toBe("resnet50-v1");
    });

    it("should throw BusinessException for invalid storageUri schema", async () => {
      const dto = {
        name: "resnet50-v1",
        framework: ModelFramework.PYTORCH,
        storageUri: "http://invalid-path/model",
        clusterId: "default",
        namespace: "kserve-test",
      };

      await expect(service.deployModel(dto, mockUser)).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe("updateTrafficSplit", () => {
    it("should update canary traffic percent", async () => {
      const result = await service.updateTrafficSplit(
        "default",
        "kserve-test",
        "resnet50-v1",
        20,
        mockUser,
      );
      expect(result.canaryTrafficPercent).toBe(20);
    });
  });

  describe("subscribeEvents", () => {
    it("should subscribe to serving SSE events and return MessageEvent stream", (done) => {
      service
        .subscribeEvents("default", "kserve-test", mockUser)
        .subscribe((event) => {
          expect(event.type).toBe("serving-updated");
          const parsed = JSON.parse(event.data as string);
          expect(parsed.name).toBe("resnet50-v1");
          expect(parsed.clusterId).toBe("default");
          done();
        });
    });
  });
});
