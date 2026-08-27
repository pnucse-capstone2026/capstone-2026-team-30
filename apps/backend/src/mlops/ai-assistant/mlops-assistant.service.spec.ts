import { Test, TestingModule } from "@nestjs/testing";
import { MlopsAssistantService } from "./mlops-assistant.service";
import { BedrockService } from "../../ai-agent/bedrock.service";
import { MlopsIntentParserService } from "./mlops-intent-parser.service";

describe("MlopsAssistantService", () => {
  let service: MlopsAssistantService;
  let bedrockService: jest.Mocked<BedrockService>;

  beforeEach(async () => {
    const mockBedrockService = {
      invokeClaude: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MlopsAssistantService,
        MlopsIntentParserService,
        {
          provide: BedrockService,
          useValue: mockBedrockService,
        },
      ],
    }).compile();

    service = module.get<MlopsAssistantService>(MlopsAssistantService);
    bedrockService = module.get(BedrockService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should process chat and return proposed action on successful Bedrock response", async () => {
    const mockLlmJson = JSON.stringify({
      replyText: "PyTorch 노트북 생성을 도와드리겠습니다.",
      intent: "CREATE_NOTEBOOK",
      extractedParams: {
        name: "test-notebook",
        hardwareTier: "GPU_T4_STANDARD",
        frameworkImage: "JUPYTER_PYTORCH",
      },
      recommendations: ["GPU 할당 규정을 확인하세요."],
    });

    bedrockService.invokeClaude.mockResolvedValue(mockLlmJson);

    const response = await service.processChat({
      message: "PyTorch 노트북 하나 띄워줘",
    });

    expect(response.intent).toBe("CREATE_NOTEBOOK");
    expect(response.replyText).toContain("PyTorch 노트북");
    expect(response.proposedAction).toBeDefined();
    expect(response.proposedAction?.actionType).toBe("CREATE_NOTEBOOK");
    expect(response.provider).toBe("BEDROCK");
  });

  it("should fallback to rule engine when Bedrock invocation fails", async () => {
    bedrockService.invokeClaude.mockRejectedValue(
      new Error("Bedrock connection error"),
    );

    const response = await service.processChat({
      message: "PyTorch GPU 노트북 생성해줘",
    });

    expect(response.intent).toBe("CREATE_NOTEBOOK");
    expect(response.provider).toBe("RULE_ENGINE_FALLBACK");
    expect(response.proposedAction).toBeDefined();
  });
});
