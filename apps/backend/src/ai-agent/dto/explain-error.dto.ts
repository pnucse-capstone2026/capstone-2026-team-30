import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

/**
 * AI 분석 작업 스코프 (단일 리소스 / 다중 정책 / 클러스터 전역)
 */
export enum AnalysisTaskScope {
  SINGLE_RESOURCE = "SINGLE_RESOURCE",
  MULTI_POLICY = "MULTI_POLICY",
  CLUSTER_WIDE = "CLUSTER_WIDE",
}

/**
 * AI 분석 실행 모드 (단일 에이전트 / 마스터-서브 에이전트)
 */
export enum AnalysisMode {
  SINGLE_AGENT = "SINGLE_AGENT",
  MASTER_SUBAGENT = "MASTER_SUBAGENT",
}

/**
 * Kyverno 오류 해석 요청 DTO
 */
export class ExplainKyvernoErrorDto {
  /**
   * Kyverno에서 발생한 차단/경고 오류 메시지
   */
  @ApiProperty({
    description: "Kyverno policy validation error message",
    example:
      "action: deny, rule check-read-only-root-filesystem failed: rootFS must be read-only",
  })
  @IsString()
  @IsNotEmpty()
  errorMessage!: string;

  /**
   * 검증 대상이 된 Kyverno 정책(Policy 또는 ClusterPolicy) YAML 문자열
   */
  @ApiPropertyOptional({
    description: "Kyverno Policy YAML definition",
    example: "apiVersion: kyverno.io/v1\nkind: ClusterPolicy\n...",
  })
  @IsString()
  @IsOptional()
  policyYaml?: string;

  /**
   * 배포/적용 시도했던 쿠버네티스 리소스 매니페스트 YAML 문자열
   */
  @ApiPropertyOptional({
    description: "Kubernetes Resource Manifest YAML created by user",
    example: "apiVersion: apps/v1\nkind: Deployment\n...",
  })
  @IsString()
  @IsOptional()
  resourceManifest?: string;

  /**
   * 현재 클러스터 상태 및 추가 컨텍스트 (K8s 버전, 네임스페이스 정보 등)
   */
  @ApiPropertyOptional({
    description:
      "Current Kubernetes cluster status or contextual environment info",
    example:
      "Namespace: dev-team-a, Kubernetes Version: v1.30.2, Enforce Mode: Active",
  })
  @IsString()
  @IsOptional()
  clusterContext?: string;

  /**
   * 명시적 분석 작업 범위 지정 (옵션: SINGLE_RESOURCE, MULTI_POLICY, CLUSTER_WIDE)
   */
  @ApiPropertyOptional({
    description: "Optional explicit task scope for workload evaluation",
    enum: AnalysisTaskScope,
    example: AnalysisTaskScope.SINGLE_RESOURCE,
  })
  @IsEnum(AnalysisTaskScope)
  @IsOptional()
  taskScope?: AnalysisTaskScope;

  /**
   * 요청에 포함된 위반 개수 (옵션, 기본값: 1)
   */
  @ApiPropertyOptional({
    description: "Number of policy violations included in request",
    example: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  violationCount?: number;
}

/**
 * Kyverno 오류 해석 결과 응답 DTO
 */
export class KyvernoErrorExplanationResultDto {
  /**
   * 쉬운 언어로 풀어낸 오류 발생 원인 요약
   */
  @ApiProperty({
    description:
      "User friendly explanation of why the Kyverno policy denied the request",
  })
  summary!: string;

  /**
   * 문제 해결 방법 및 권장 조치 가이드
   */
  @ApiProperty({
    description:
      "Step-by-step resolution guide for non-platform team developers",
  })
  resolutionSteps!: string[];

  /**
   * 수정된 매니페스트 예시 또는 권장 설정 (YAML)
   */
  @ApiPropertyOptional({
    description: "Suggested manifest YAML snippet with fix applied",
  })
  suggestedFixYaml?: string;

  /**
   * 해당 정책이 요구되는 보안 및 클러스터 거버넌스 배경 설명
   */
  @ApiProperty({
    description: "Why this policy exists in the cluster governance model",
  })
  governanceRationale!: string;

  /**
   * 해설 결과를 제공한 프로바이더 (BEDROCK: Bedrock AI, RULE_ENGINE_FALLBACK: 룰 기반 템플릿)
   */
  @ApiPropertyOptional({
    description: "Source provider of the explanation result",
    enum: ["BEDROCK", "RULE_ENGINE_FALLBACK"],
  })
  provider?: "BEDROCK" | "RULE_ENGINE_FALLBACK";

  /**
   * 선택 및 적용된 AI 분석 실행 모드 (SINGLE_AGENT: 단일 에이전트, MASTER_SUBAGENT: 마스터-서브 에이전트)
   */
  @ApiPropertyOptional({
    description: "Execution mode determined by Workload Evaluator",
    enum: AnalysisMode,
    example: AnalysisMode.SINGLE_AGENT,
  })
  analysisMode?: AnalysisMode;

  /**
   * 판별된 분석 작업 범위 (SINGLE_RESOURCE, MULTI_POLICY, CLUSTER_WIDE)
   */
  @ApiPropertyOptional({
    description: "Evaluated task scope",
    enum: AnalysisTaskScope,
    example: AnalysisTaskScope.SINGLE_RESOURCE,
  })
  taskScope?: AnalysisTaskScope;

  /**
   * 분석 응답 소요 시간 (밀리초)
   */
  @ApiPropertyOptional({
    description: "Response latency in milliseconds",
  })
  latencyMs?: number;
}
