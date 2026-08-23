import { Injectable, Logger } from "@nestjs/common";
import {
  AnalysisMode,
  AnalysisTaskScope,
  ExplainKyvernoErrorDto,
} from "../dto/explain-error.dto";

/**
 * AI 분석 평가 결과 인터페이스
 */
export interface WorkloadEvaluationResult {
  /**
   * 판별된 AI 분석 실행 모드 (SINGLE_AGENT 또는 MASTER_SUBAGENT)
   */
  mode: AnalysisMode;
  /**
   * 판별된 분석 작업 범위 (SINGLE_RESOURCE, MULTI_POLICY, CLUSTER_WIDE)
   */
  scope: AnalysisTaskScope;
  /**
   * 평가 판별 사유
   */
  reason: string;
}

/**
 * 작업 규모 및 클러스터 정보에 따라 AI 분석 실행 모드(Single vs Master-Subagent)를 판별하는 평가 서비스
 */
@Injectable()
export class WorkloadEvaluatorService {
  private readonly logger = new Logger(WorkloadEvaluatorService.name);

  /**
   * 입력된 오류 분석 요청 DTO를 기반으로 단순 경량 평가 규칙을 적용하여 분석 모드와 작업 스코프를 결정합니다.
   *
   * @param dto Kyverno 오류 메시지, 정책 YAML, 리소스 매니페스트 및 클러스터 컨텍스트 DTO
   * @returns 판별된 실행 모드, 작업 스코프 및 판별 사유
   */
  evaluate(dto: ExplainKyvernoErrorDto): WorkloadEvaluationResult {
    // 1. DTO에 명시적 taskScope가 주어진 경우 우대 적용
    if (dto.taskScope) {
      const mode =
        dto.taskScope === AnalysisTaskScope.SINGLE_RESOURCE
          ? AnalysisMode.SINGLE_AGENT
          : AnalysisMode.MASTER_SUBAGENT;

      this.logger.log(
        `Workload evaluated by explicit taskScope: mode=${mode}, scope=${dto.taskScope}`,
      );

      return {
        mode,
        scope: dto.taskScope,
        reason: `Explicit taskScope provided: ${dto.taskScope}`,
      };
    }

    // 2. 위반 건수가 2건을 초과하는 경우 다중 정책 스코프 지정
    if (dto.violationCount && dto.violationCount > 2) {
      this.logger.log(
        `Workload evaluated by violationCount (${dto.violationCount} > 2): mode=${AnalysisMode.MASTER_SUBAGENT}`,
      );

      return {
        mode: AnalysisMode.MASTER_SUBAGENT,
        scope: AnalysisTaskScope.MULTI_POLICY,
        reason: `Multiple violations detected (${dto.violationCount} > 2)`,
      };
    }

    // 3. 메시지 또는 매니페스트 크기/복잡도 평가 (3000자 초과 시 복합 작업으로 간주)
    const combinedLength =
      (dto.errorMessage?.length || 0) +
      (dto.policyYaml?.length || 0) +
      (dto.resourceManifest?.length || 0) +
      (dto.clusterContext?.length || 0);

    if (combinedLength >= 3000) {
      this.logger.log(
        `Workload evaluated by combined payload length (${combinedLength} chars >= 3000): mode=${AnalysisMode.MASTER_SUBAGENT}`,
      );

      return {
        mode: AnalysisMode.MASTER_SUBAGENT,
        scope: AnalysisTaskScope.MULTI_POLICY,
        reason: `Large context payload length (${combinedLength} characters)`,
      };
    }

    // 4. 기본값: 단일 리소스 경량 분석 (SINGLE_AGENT)
    this.logger.log(
      `Workload evaluated as lightweight single resource: mode=${AnalysisMode.SINGLE_AGENT}`,
    );

    return {
      mode: AnalysisMode.SINGLE_AGENT,
      scope: AnalysisTaskScope.SINGLE_RESOURCE,
      reason: "Standard lightweight single resource policy error",
    };
  }
}
