import { Test, TestingModule } from "@nestjs/testing";
import { AiAgentService } from "./ai-agent.service";
import { BedrockService } from "./bedrock.service";

describe("AiAgentService", () => {
  let service: AiAgentService;
  let bedrockService: jest.Mocked<BedrockService>;

  beforeEach(async () => {
    const mockBedrockService = {
      invokeClaude: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAgentService,
        {
          provide: BedrockService,
          useValue: mockBedrockService,
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
    expect(result.resolutionSteps).toHaveLength(1);
    expect(result.suggestedFixYaml).toBeDefined();
  });

  it("should fallback gracefully when Bedrock throws an error", async () => {
    bedrockService.invokeClaude.mockRejectedValue(
      new Error("AWS credentials error"),
    );

    const result = await service.explainKyvernoError({
      errorMessage:
        "action: deny, rule check-read-only-root-filesystem failed: rootFS must be read-only",
    });

    // AWS Bedrock 연동 장애 상황에서도 사용자 응답이 차단되지 않고 스터브 가이드가 반환됩니다.
    expect(result.summary).toContain("컨테이너 파일시스템");
    expect(result.resolutionSteps.length).toBeGreaterThan(0);
    expect(result.governanceRationale).toBeDefined();
  });
});
