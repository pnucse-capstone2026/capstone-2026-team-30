import {
  AnalysisMode,
  AnalysisTaskScope,
  ExplainKyvernoErrorDto,
} from "../dto/explain-error.dto";
import { WorkloadEvaluatorService } from "./workload-evaluator.service";

describe("WorkloadEvaluatorService", () => {
  let evaluator: WorkloadEvaluatorService;

  beforeEach(() => {
    evaluator = new WorkloadEvaluatorService();
  });

  it("should return SINGLE_AGENT and SINGLE_RESOURCE for simple lightweight requests", () => {
    const dto: ExplainKyvernoErrorDto = {
      errorMessage: "action: deny, rule check-root-user failed",
    };

    const result = evaluator.evaluate(dto);

    expect(result.mode).toBe(AnalysisMode.SINGLE_AGENT);
    expect(result.scope).toBe(AnalysisTaskScope.SINGLE_RESOURCE);
  });

  it("should honor explicit taskScope if provided in DTO", () => {
    const dto: ExplainKyvernoErrorDto = {
      errorMessage: "action: deny",
      taskScope: AnalysisTaskScope.CLUSTER_WIDE,
    };

    const result = evaluator.evaluate(dto);

    expect(result.mode).toBe(AnalysisMode.MASTER_SUBAGENT);
    expect(result.scope).toBe(AnalysisTaskScope.CLUSTER_WIDE);
  });

  it("should return MASTER_SUBAGENT if violationCount is greater than 2", () => {
    const dto: ExplainKyvernoErrorDto = {
      errorMessage: "action: deny",
      violationCount: 5,
    };

    const result = evaluator.evaluate(dto);

    expect(result.mode).toBe(AnalysisMode.MASTER_SUBAGENT);
    expect(result.scope).toBe(AnalysisTaskScope.MULTI_POLICY);
  });

  it("should return MASTER_SUBAGENT if combined payload length is >= 3000 chars", () => {
    const dto: ExplainKyvernoErrorDto = {
      errorMessage: "action: deny",
      policyYaml: "a".repeat(2000),
      resourceManifest: "b".repeat(1500),
    };

    const result = evaluator.evaluate(dto);

    expect(result.mode).toBe(AnalysisMode.MASTER_SUBAGENT);
    expect(result.scope).toBe(AnalysisTaskScope.MULTI_POLICY);
  });
});
