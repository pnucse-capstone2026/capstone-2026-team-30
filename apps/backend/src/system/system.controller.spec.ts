import { Test, TestingModule } from "@nestjs/testing";
import { SystemController } from "./system.controller";
import { SystemService } from "./system.service";
import { SystemModulesResponseDto } from "./system.types";

describe("SystemController", () => {
  let controller: SystemController;
  let service: SystemService;

  const mockModulesResponse: SystemModulesResponseDto = {
    modules: {
      core: {
        id: "core",
        name: "Core Governance",
        description: "Core Kyverno engine",
        enabled: true,
        required: true,
      },
      mlops: {
        id: "mlops",
        name: "MLOps Platform",
        description: "MLOps notebooks and policies",
        enabled: false,
        required: false,
      },
      aiAgent: {
        id: "aiAgent",
        name: "AI Policy Assistant",
        description: "Bedrock AI assistant",
        enabled: true,
        required: false,
      },
      simulation: {
        id: "simulation",
        name: "Policy Simulation Lab",
        description: "Dry-run simulator",
        enabled: true,
        required: false,
      },
      gitops: {
        id: "gitops",
        name: "GitOps Policy Sync",
        description: "GitHub PR sync",
        enabled: true,
        required: false,
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        {
          provide: SystemService,
          useValue: {
            getModules: jest.fn().mockReturnValue(mockModulesResponse),
          },
        },
      ],
    }).compile();

    controller = module.get<SystemController>(SystemController);
    service = module.get<SystemService>(SystemService);
  });

  it("GET /system/modules 호출 시 시스템 서비스의 모듈 메타데이터를 반환해야 한다", () => {
    const result = controller.getModules();
    expect(result).toEqual(mockModulesResponse);
    expect(service.getModules).toHaveBeenCalledTimes(1);
  });
});
