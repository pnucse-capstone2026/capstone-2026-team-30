import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { KyvernoViolationDetail } from "../../simulation/dto/dry-run-validation.dto";

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
   * Kyverno에서 발생한 차단/경고 오류 메시지 (선택사항, 사전 검증 시 생략 가능)
   */
  @ApiPropertyOptional({
    description:
      "Kyverno policy validation error message (optional for pre-deployment checks)",
    example:
      "action: deny, rule check-read-only-root-filesystem failed: rootFS must be read-only",
  })
  @IsString()
  @IsOptional()
  errorMessage?: string;

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
   * 진단 대상 클러스터 식별자 (선택, 미지정 시 기본 활성 클러스터 자동 선택)
   */
  @ApiPropertyOptional({
    description:
      "Target Kubernetes cluster ID to inspect active governance policies",
    example: "eks-prod-us-east-1",
  })
  @IsString()
  @IsOptional()
  clusterId?: string;

  /**
   * 대상 네임스페이스 (선택, 미지정 시 매니페스트 네임스페이스 또는 default)
   */
  @ApiPropertyOptional({
    description: "Target Kubernetes namespace",
    example: "governance-testbed",
  })
  @IsString()
  @IsOptional()
  namespace?: string;

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

  /**
   * 1차 자가 교정 시도 시 생성했던 매니페스트 YAML 문자열 (피드백 재시도용)
   */
  @ApiPropertyOptional({
    description:
      "Previous attempted manifest YAML generated during self-correction loop",
    example: "apiVersion: v1\nkind: Pod\n...",
  })
  @IsString()
  @IsOptional()
  previousAttemptYaml?: string;

  /**
   * 1차 교정본에 대한 Server-Side Dry-Run 재검증 실패 피드백 및 위반 사유
   */
  @ApiPropertyOptional({
    description:
      "Feedback and error details from dry-run re-validation failure",
    example:
      "Policy 'disallow-latest-tag' rule 'require-image-tag' still failed: image tag cannot be latest",
  })
  @IsString()
  @IsOptional()
  validationFeedback?: string;
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
  suggestedFixYaml?: string | null;

  /**
   * 해당 정책이 요구되는 보안 및 클러스터 거버넌스 배경 설명
   */
  @ApiProperty({
    description: "Why this policy exists in the cluster governance model",
  })
  governanceRationale!: string;

  /**
   * 매니페스트가 클러스터 거버넌스 정책을 완벽히 준수하는지 여부 (위반이 없을 시 true)
   */
  @ApiPropertyOptional({
    description:
      "Whether the resource manifest is fully compliant with cluster governance policies",
    example: true,
  })
  isCompliant?: boolean;

  /**
   * 종합 진단 결과 상태 (COMPLIANT: 정상 준수, BLOCKED: 정책 차단, ERROR: 인프라/API 오류)
   */
  @ApiPropertyOptional({
    description: "Diagnostic assessment status (COMPLIANT, BLOCKED, or ERROR)",
    example: "COMPLIANT",
  })
  status?: "COMPLIANT" | "BLOCKED" | "ERROR";

  /**
   * 통과 및 검증 완료된 거버넌스 규칙/표준 목록
   */
  @ApiPropertyOptional({
    description: "List of passed governance rules or compliance details",
  })
  passedRules?: string[];

  /**
   * 감지된 Kyverno 정책 위반 세부 목록
   */
  @ApiPropertyOptional({
    description: "Detected violation details",
  })
  violations?: KyvernoViolationDetail[];

  /**
   * 해설 결과를 제공한 프로바이더 (BEDROCK, OPENAI, RULE_ENGINE_FALLBACK 등)
   */
  @ApiPropertyOptional({
    description:
      "Source provider of the explanation result (e.g. BEDROCK, OPENAI, RULE_ENGINE_FALLBACK)",
    example: "BEDROCK",
  })
  provider?: string;

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
