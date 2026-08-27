import { Test, TestingModule } from "@nestjs/testing";
import { WorkloadDiagnosticService } from "./workload-diagnostic.service";
import { BedrockService } from "../../ai-agent/bedrock.service";
import { MlopsIntentParserService } from "./mlops-intent-parser.service";
import { WorkloadResourceType } from "./dto/diagnose-workload.dto";

describe("WorkloadDiagnosticService", () => {
  let service: WorkloadDiagnosticService;
  let bedrockService: jest.Mocked<BedrockService>;

  beforeEach(async () => {
    const mockBedrockService = {
      invokeClaude: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkloadDiagnosticService,
        MlopsIntentParserService,
        {
          provide: BedrockService,
          useValue: mockBedrockService,
        },
      ],
    }).compile();

    service = module.get<WorkloadDiagnosticService>(WorkloadDiagnosticService);
    bedrockService = module.get(BedrockService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should diagnose CUDA OOM using fallback rule engine when Bedrock fails", async () => {
    bedrockService.invokeClaude.mockRejectedValue(new Error("Bedrock timeout"));

    const result = await service.diagnoseWorkload({
      resourceType: WorkloadResourceType.NOTEBOOK,
      resourceName: "failed-nb",
      namespace: "default",
      podLogs:
        "torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 12.00 GiB",
      k8sEvents: ["OOMKilled: Terminated process 1234"],
    });

    expect(result.detectedErrorCode).toBe("CUDA_OOM");
    expect(result.provider).toBe("RULE_ENGINE_FALLBACK");
    expect(result.recommendedFixes.length).toBeGreaterThan(0);
    expect(result.recommendedFixes[0].actionType).toBe("REDUCE_BATCH_SIZE");
  });

  it("should diagnose using Bedrock response when Bedrock succeeds", async () => {
    const mockDiagnosisJson = JSON.stringify({
      rootCause: "CUDA VRAM 부족",
      summary: "GPU 메모리가 부족하여 학습 실패",
      detailedDiagnosis: "Tensor 할당량 초과",
      detectedErrorCode: "CUDA_OOM",
      recommendedFixes: [
        {
          title: "GPU 증설",
          description: "2개 GPU로 증설",
          actionType: "UPGRADE_GPU_TIER",
        },
      ],
    });

    bedrockService.invokeClaude.mockResolvedValue(mockDiagnosisJson);

    const result = await service.diagnoseWorkload({
      resourceType: WorkloadResourceType.PIPELINE_RUN,
      resourceName: "train-run-1",
      namespace: "default",
      podLogs: "CUDA out of memory",
    });

    expect(result.detectedErrorCode).toBe("CUDA_OOM");
    expect(result.provider).toBe("BEDROCK");
    expect(result.rootCause).toBe("CUDA VRAM 부족");
  });
});
