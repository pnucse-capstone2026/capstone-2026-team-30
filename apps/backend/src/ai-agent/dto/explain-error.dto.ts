import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

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
   * 분석 응답 소요 시간 (밀리초)
   */
  @ApiPropertyOptional({
    description: "Response latency in milliseconds",
  })
  latencyMs?: number;
}
