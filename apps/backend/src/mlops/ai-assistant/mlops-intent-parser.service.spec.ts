import { Test, TestingModule } from "@nestjs/testing";
import { MlopsIntentParserService } from "./mlops-intent-parser.service";

describe("MlopsIntentParserService", () => {
  let service: MlopsIntentParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MlopsIntentParserService],
    }).compile();

    service = module.get<MlopsIntentParserService>(MlopsIntentParserService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("parseJsonFromLlmOutput", () => {
    it("should parse valid raw JSON text", () => {
      const rawText = `{"replyText": "Hello", "intent": "CREATE_NOTEBOOK"}`;
      const result = service.parseJsonFromLlmOutput(rawText);
      expect(result).toEqual({ replyText: "Hello", intent: "CREATE_NOTEBOOK" });
    });

    it("should parse JSON enclosed in markdown code blocks", () => {
      const rawText =
        '```json\n{"replyText": "Test", "intent": "RUN_PIPELINE"}\n```';
      const result = service.parseJsonFromLlmOutput(rawText);
      expect(result).toEqual({ replyText: "Test", intent: "RUN_PIPELINE" });
    });

    it("should return null for invalid JSON string", () => {
      const rawText = "Invalid text response without JSON";
      const result = service.parseJsonFromLlmOutput(rawText);
      expect(result).toBeNull();
    });
  });

  describe("buildProposedAction", () => {
    it("should build CREATE_NOTEBOOK proposed action", () => {
      const action = service.buildProposedAction("CREATE_NOTEBOOK", {
        name: "my-notebook",
        hardwareTier: "GPU_T4_STANDARD",
        frameworkImage: "JUPYTER_PYTORCH",
      });

      expect(action).toBeDefined();
      expect(action?.actionType).toBe("CREATE_NOTEBOOK");
      expect(action?.payload.name).toBe("my-notebook");
      expect(action?.payload.hardwareTier).toBe("GPU_T4_STANDARD");
    });

    it("should build DEPLOY_SERVED_MODEL proposed action", () => {
      const action = service.buildProposedAction("DEPLOY_SERVED_MODEL", {
        name: "resnet-serving",
        framework: "PYTORCH",
      });

      expect(action).toBeDefined();
      expect(action?.actionType).toBe("DEPLOY_SERVED_MODEL");
      expect(action?.payload.name).toBe("resnet-serving");
    });
  });
});
