import { ApiProperty } from "@nestjs/swagger";

/**
 * Kyverno 정책 위반 요약 정보 DTO
 */
export class ViolationSummaryDto {
  @ApiProperty({
    description: "고유 위반 식별자",
    example: "kyverno-eks-hub:polr-ns-payments:0",
  })
  id!: string;

  @ApiProperty({ description: "클러스터 식별자", example: "kyverno-eks-hub" })
  clusterId!: string;

  @ApiProperty({
    description: "클러스터 표시명",
    example: "Hub Production (us-east-1)",
  })
  clusterDisplayName!: string;

  @ApiProperty({ description: "네임스페이스", example: "payments" })
  namespace!: string;

  @ApiProperty({
    description: "위반된 정책 이름",
    example: "disallow-latest-tag",
  })
  policyName!: string;

  @ApiProperty({
    description: "위반된 규칙(Rule) 이름",
    example: "require-image-tag",
  })
  ruleName!: string;

  @ApiProperty({ description: "대상 리소스 종류 (Kind)", example: "Pod" })
  resourceKind!: string;

  @ApiProperty({
    description: "대상 리소스 이름",
    example: "payment-api-7b89f",
  })
  resourceName!: string;

  @ApiProperty({
    description: "위반 심각도 (critical | high | medium | low | info)",
    example: "high",
  })
  severity!: "critical" | "high" | "medium" | "low" | "info";

  @ApiProperty({
    description: "위반 상태 (open | inReview | resolved)",
    example: "open",
  })
  status!: "open" | "inReview" | "resolved";

  @ApiProperty({
    description: "위반 상세 메시지",
    example: "Using the :latest tag is prohibited.",
  })
  message!: string;

  @ApiProperty({
    description: "탐지 일시",
    example: "2026-08-19T05:30:00.000Z",
  })
  detectedAt!: string;

  @ApiProperty({
    description: "출처 PolicyReport 이름",
    example: "polr-ns-payments",
  })
  reportName!: string;

  @ApiProperty({
    description: "예외 처리 상태 (none | requested | approved)",
    example: "none",
    required: false,
  })
  exceptionStatus?: "none" | "requested" | "approved";

  @ApiProperty({
    description: "연관된 예외 신청 식별자",
    example: "exc-123456",
    required: false,
  })
  relatedExceptionId?: string;
}
