import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { SystemService } from "./system.service";

describe("SystemService", () => {
  const createServiceWithEnv = async (env: Record<string, string>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => env[key]),
          },
        },
      ],
    }).compile();

    return module.get<SystemService>(SystemService);
  };

  describe("기본값 (모든 모듈 기본 활성화)", () => {
    let service: SystemService;

    beforeEach(async () => {
      service = await createServiceWithEnv({});
    });

    it("Core 모듈은 항상 활성화 및 필수 상태여야 한다", () => {
      const { modules } = service.getModules();
      expect(modules.core.enabled).toBe(true);
      expect(modules.core.required).toBe(true);
      expect(service.isModuleEnabled("core")).toBe(true);
    });

    it("환경 변수가 없을 때 MLOps, AI Agent, Simulation, GitOps는 기본적으로 활성화되어야 한다", () => {
      const { modules } = service.getModules();
      expect(modules.mlops.enabled).toBe(true);
      expect(modules.aiAgent.enabled).toBe(true);
      expect(modules.simulation.enabled).toBe(true);
      expect(modules.gitops.enabled).toBe(true);

      expect(service.isModuleEnabled("mlops")).toBe(true);
      expect(service.isModuleEnabled("aiAgent")).toBe(true);
      expect(service.isModuleEnabled("simulation")).toBe(true);
      expect(service.isModuleEnabled("gitops")).toBe(true);
    });
  });

  describe("선택적 모듈 비활성화 환경", () => {
    it("MODULE_MLOPS_ENABLED=false일 때 MLOps 모듈만 비활성화되어야 한다", async () => {
      const service = await createServiceWithEnv({
        MODULE_MLOPS_ENABLED: "false",
      });
      const { modules } = service.getModules();

      expect(modules.mlops.enabled).toBe(false);
      expect(service.isModuleEnabled("mlops")).toBe(false);

      // Core 및 타 모듈은 영향받지 않아야 함
      expect(modules.core.enabled).toBe(true);
      expect(modules.aiAgent.enabled).toBe(true);
    });

    it("대소문자 구분 없이 'FALSE' 값도 올바르게 비활성화 처리해야 한다", async () => {
      const service = await createServiceWithEnv({
        MODULE_AI_AGENT_ENABLED: "False",
        MODULE_SIMULATION_ENABLED: "FALSE",
      });
      const { modules } = service.getModules();

      expect(modules.aiAgent.enabled).toBe(false);
      expect(modules.simulation.enabled).toBe(false);
    });
  });
});
