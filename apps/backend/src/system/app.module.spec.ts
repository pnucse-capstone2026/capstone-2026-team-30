jest.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: jest.fn(() => jest.fn()),
}));

import { getOptionalModules } from "../app.module";
import { MlopsModule } from "../mlops/mlops.module";
import { SimulationModule } from "../simulation/simulation.module";
import { AiAgentModule } from "../ai-agent/ai-agent.module";
import { GitOpsModule } from "../gitops/gitops.module";

describe("AppModule 동적 모듈 로딩 검증", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("환경 변수가 없을 때 모든 선택 모듈(MLOps, Simulation, AiAgent, GitOps)이 기본 로드되어야 한다", () => {
    delete process.env.MODULE_MLOPS_ENABLED;
    delete process.env.MODULE_SIMULATION_ENABLED;
    delete process.env.MODULE_AI_AGENT_ENABLED;
    delete process.env.MODULE_GITOPS_ENABLED;

    const modules = getOptionalModules();
    expect(modules).toContain(MlopsModule);
    expect(modules).toContain(SimulationModule);
    expect(modules).toContain(AiAgentModule);
    expect(modules).toContain(GitOpsModule);
  });

  it("MODULE_MLOPS_ENABLED=false일 때 MlopsModule이 로드 목록에서 제외되어야 한다", () => {
    process.env.MODULE_MLOPS_ENABLED = "false";

    const modules = getOptionalModules();
    expect(modules).not.toContain(MlopsModule);
    expect(modules).toContain(SimulationModule);
    expect(modules).toContain(AiAgentModule);
    expect(modules).toContain(GitOpsModule);
  });

  it("모든 선택 모듈을 비활성화하면 빈 배열이 반환되어야 한다", () => {
    process.env.MODULE_MLOPS_ENABLED = "false";
    process.env.MODULE_SIMULATION_ENABLED = "false";
    process.env.MODULE_AI_AGENT_ENABLED = "false";
    process.env.MODULE_GITOPS_ENABLED = "false";

    const modules = getOptionalModules();
    expect(modules).toHaveLength(0);
  });
});
