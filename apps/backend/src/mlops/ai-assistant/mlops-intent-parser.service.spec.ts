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
});
