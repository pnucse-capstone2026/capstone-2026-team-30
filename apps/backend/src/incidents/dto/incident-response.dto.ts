import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IncidentStatus } from "@prisma/client";

/**
 * 배포 차단 인시던트 응답 DTO
 */
export class DeploymentIncidentDto {
  @ApiProperty({
    description: "인시던트 고유 ID (UUID v7)",
    example: "018f4a2b-...",
  })
  id: string;

  @ApiProperty({
    description: "대상 쿠버네티스 클러스터 식별자",
    example: "production-us-east-1",
  })
  clusterId: string;

  @ApiProperty({ description: "리소스 네임스페이스", example: "mlops-serving" })
  namespace: string;

  @ApiProperty({
    description: "차단된 쿠버네티스 리소스 종류",
    example: "Deployment",
  })
  resourceKind: string;

  @ApiProperty({
    description: "차단된 쿠버네티스 리소스 이름",
    example: "deepseek-serving-v2",
  })
  resourceName: string;

  @ApiProperty({
    description: "차단을 트리거한 Kyverno 정책 이름",
    example: "disallow-privileged-containers",
  })
  policyName: string;

  @ApiPropertyOptional({
    description: "차단된 세부 정책 규칙 이름",
    example: "require-non-root-user",
  })
  ruleName?: string | null;

  @ApiProperty({ description: "Kyverno Admission Webhook 차단 상세 사유" })
  blockReason: string;

  @ApiPropertyOptional({
    description: "연계된 ArgoCD 애플리케이션 이름",
    example: "deepseek-production",
  })
  argoAppName?: string | null;

  @ApiPropertyOptional({
    description: "차단 발생 당시의 Git 커밋 해시",
    example: "7f8a9b2c...",
  })
  gitCommitSha?: string | null;

  @ApiPropertyOptional({
    description: "연동된 Git 리포지토리 URL",
    example: "https://github.com/org/gitops-infra",
  })
  gitRepository?: string | null;

  @ApiProperty({
    enum: IncidentStatus,
    description: "인시던트 진행 및 해결 상태",
    example: IncidentStatus.ACTIVE,
  })
  status: IncidentStatus;

  @ApiProperty({
    description: "동일 리소스에 대한 누적 차단 횟수 (Deduplication 카운터)",
    example: 5,
  })
  blockCount: number;

  @ApiProperty({ description: "최초 차단 발생 시각" })
  firstBlockedAt: Date;

  @ApiProperty({ description: "가장 최근 차단 발생 시각" })
  lastBlockedAt: Date;

  @ApiPropertyOptional({ description: "인시던트 해결/무시 처리 시각" })
  resolvedAt?: Date | null;

  @ApiPropertyOptional({ description: "연동된 PolicyExceptionRequest ID" })
  exceptionId?: string | null;

  @ApiPropertyOptional({ description: "기타 원문 K8s 이벤트 상세 메타데이터" })
  metadata?: Record<string, any> | null;

  @ApiProperty({ description: "생성 시각" })
  createdAt: Date;

  @ApiProperty({ description: "수정 시각" })
  updatedAt: Date;
}

/**
 * 인시던트 목록 페이징 응답 DTO
 */
export class PaginatedIncidentsResponseDto {
  @ApiProperty({ type: [DeploymentIncidentDto], description: "인시던트 목록" })
  items: DeploymentIncidentDto[];

  @ApiProperty({ description: "전체 항목 수", example: 42 })
  total: number;

  @ApiProperty({ description: "현재 페이지", example: 1 })
  page: number;

  @ApiProperty({ description: "페이지당 노출 항목 수", example: 20 })
  limit: number;

  @ApiProperty({ description: "전체 페이지 수", example: 3 })
  totalPages: number;
}
