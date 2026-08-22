import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AiAgentService } from "./ai-agent.service";
import { BedrockService } from "./bedrock.service";
import { KyvernoRuleTemplateEngine } from "./rule-template.engine";

describe("AiAgentService", () => {
  let service: AiAgentService;
  let bedrockService: jest.Mocked<BedrockService>;

  beforeEach(async () => {
    const mockBedrockService = {
      invokeClaude: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue("3500"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAgentService,
        KyvernoRuleTemplateEngine,
        {
          provide: BedrockService,
          useValue: mockBedrockService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiAgentService>(AiAgentService);
    bedrockService = module.get(BedrockService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should parse valid JSON response from Bedrock model", async () => {
    const mockResponse = JSON.stringify({
      summary: "루트 파일시스템이 읽기 전용으로 설정되어야 합니다.",
      resolutionSteps: ["readOnlyRootFilesystem을 true로 설정하세요."],
      suggestedFixYaml: "securityContext:\n  readOnlyRootFilesystem: true",
      governanceRationale: "클러스터 침입 및 파일 변경 방지 목적으로 규정됨",
    });

    bedrockService.invokeClaude.mockResolvedValue(mockResponse);

    const result = await service.explainKyvernoError({
      errorMessage: "action: deny, rule check-read-only-root-filesystem failed",
    });

    expect(result.summary).toContain("루트 파일시스템");
    expect(result.provider).toBe("BEDROCK");
    expect(result.resolutionSteps).toHaveLength(1);
    expect(result.suggestedFixYaml).toBeDefined();
  });

  it("should fallback gracefully to rule template engine when Bedrock throws an error", async () => {
    bedrockService.invokeClaude.mockRejectedValue(
      new Error("AWS credentials error"),
    );

    const result = await service.explainKyvernoError({
      errorMessage:
        "action: deny, rule check-read-only-root-filesystem failed: rootFS must be read-only",
    });

    expect(result.summary).toContain("읽기 전용");
    expect(result.provider).toBe("RULE_ENGINE_FALLBACK");
    expect(result.resolutionSteps.length).toBeGreaterThan(0);
    expect(result.governanceRationale).toBeDefined();
  });

  it("should fallback when Bedrock API times out", async () => {
    // 10초 대기하도록 하여 3.5초 타임아웃 유발
    bedrockService.invokeClaude.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("{}"), 10000)),
    );

    const result = await service.explainKyvernoError({
      errorMessage:
        "disallow-latest-tag rule failed: image tag latest is not allowed",
    });

    expect(result.summary).toContain("latest");
    expect(result.provider).toBe("RULE_ENGINE_FALLBACK");
  }, 10000);
});
