import { Test, TestingModule } from "@nestjs/testing";
import { ServingController } from "./serving.controller";
import { ServingService } from "./serving.service";
import { AuthenticatedUser } from "../../auth/auth.types";
import { ModelFramework } from "./dto/deploy-model.dto";

import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";

describe("ServingController", () => {
  let controller: ServingController;
  let mockServingService: Partial<ServingService>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "dev@example.com",
    role: Role.ADMIN,
    clusterIds: ["default"],
  };

  beforeEach(async () => {
    mockServingService = {
      getEndpoints: jest.fn().mockResolvedValue([]),
      deployModel: jest.fn().mockResolvedValue({
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
        canaryTrafficPercent: 30,
        createdAt: "2026-08-27T12:00:00Z",
      }),
      deleteEndpoint: jest.fn().mockResolvedValue(undefined),
      testPrediction: jest.fn().mockResolvedValue({
        success: true,
        output: { predictions: [0.95] },
        latencyMs: 25,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServingController],
      providers: [
        {
          provide: ServingService,
          useValue: mockServingService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ServingController>(ServingController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("deployModel", () => {
    it("should deploy new serving endpoint", async () => {
      const dto = {
        name: "resnet50-v1",
        framework: ModelFramework.PYTORCH,
        storageUri: "s3://ml-models/resnet50",
        clusterId: "default",
        namespace: "kserve-test",
      };

      const result = await controller.deployModel(dto, mockUser);
      expect(result.name).toBe("resnet50-v1");
    });
  });

  describe("updateTraffic", () => {
    it("should update traffic split", async () => {
      const result = await controller.updateTraffic(
        "resnet50-v1",
        { canaryTrafficPercent: 30 },
        "default",
        "kserve-test",
        mockUser,
      );
      expect(result.canaryTrafficPercent).toBe(30);
    });
  });
});
