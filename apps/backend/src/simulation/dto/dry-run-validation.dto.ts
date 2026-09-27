import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Kyverno 정책 위반 세부 사항
 */
export interface KyvernoViolationDetail {
  /** 위반된 정책명 (ClusterPolicy / Policy) */
  policyName: string;
  /** 위반된 규칙명 */
  ruleName?: string;
  /** 차단 사유 설명 */
  reason: string;
  /** 매니페스트 내 위반 경로 (예: /spec/containers/0/image/) */
  path?: string;
}

/**
 * Kyverno 웹훅 에러 파싱 결과
 */
export interface ParsedKyvernoError {
  policyName?: string;
  ruleName?: string;
  reason?: string;
  violations: KyvernoViolationDetail[];
}

/**
 * 개별 쿠버네티스 리소스의 Server-Side Dry-Run 검증 결과
 */
export class ResourceDryRunResult {
  @ApiProperty({ description: "리소스 API 버전 (예: apps/v1, v1)" })
  apiVersion: string;

  @ApiProperty({ description: "리소스 종류 (예: Deployment, Pod, Service)" })
  kind: string;

  @ApiProperty({ description: "리소스 이름" })
  name: string;

  @ApiProperty({ description: "타겟 네임스페이스" })
  namespace: string;

  @ApiProperty({ description: "어드미션 통과 허용 여부" })
  allowed: boolean;

  @ApiProperty({
    description: "검증 결과 상태",
    enum: ["PASSED", "BLOCKED", "ERROR"],
  })
  status: "PASSED" | "BLOCKED" | "ERROR";

  @ApiPropertyOptional({ description: "결과 메시지" })
  message?: string;

  @ApiPropertyOptional({ description: "차단 사유 (Kyverno denied 사유)" })
  blockedReason?: string;

  @ApiProperty({
    description: "발견된 정책 위반 세부 목록",
    type: [Object],
  })
  violations: KyvernoViolationDetail[];

  @ApiPropertyOptional({ description: "원시 에러 응답 내용 (디버깅용)" })
  rawError?: string;
}

/**
 * 다중 리소스 매니페스트 일괄 Server-Side Dry-Run 종합 검증 결과
 */
export class ManifestDryRunValidationResult {
  @ApiProperty({
    description: "전체 리소스 유효성 통과 여부 (차단 및 에러 0건)",
  })
  valid: boolean;

  @ApiProperty({ description: "전체 리소스 어드미션 허용 여부 (차단 0건)" })
  allowed: boolean;

  @ApiProperty({ description: "검증된 총 리소스 수" })
  totalResources: number;

  @ApiProperty({ description: "Kyverno 어드미션에 의해 차단된 리소스 수" })
  blockedCount: number;

  @ApiProperty({ description: "정상 통과된 리소스 수" })
  passedCount: number;

  @ApiProperty({ description: "파싱 또는 K8s API 오류가 발생한 리소스 수" })
  errorCount: number;

  @ApiProperty({
    description: "개별 리소스별 상세 검증 결과 목록",
    type: [ResourceDryRunResult],
  })
  results: ResourceDryRunResult[];

  @ApiProperty({
    description: "취합된 모든 Kyverno 정책 위반 목록",
    type: [Object],
  })
  allViolations: KyvernoViolationDetail[];
}
