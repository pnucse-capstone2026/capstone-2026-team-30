import { ApiProperty } from "@nestjs/swagger";

/**
 * Kyverno 정책 요약 정보 DTO
 */
export class PolicySummaryDto {
  @ApiProperty({ description: "고유 정책 식별자 (클러스터 및 스코프 포함)", example: "kyverno-eks-hub:ClusterPolicy::disallow-latest-tag" })
  id!: string;

  @ApiProperty({ description: "정책 이름", example: "disallow-latest-tag" })
  name!: string;

  @ApiProperty({ description: "클러스터 식별자", example: "kyverno-eks-hub" })
  clusterId!: string;

  @ApiProperty({ description: "클러스터 표시명", example: "Hub Production" })
  clusterDisplayName!: string;

  @ApiProperty({ description: "정책 스코프 (ClusterPolicy | Policy)", example: "ClusterPolicy" })
  scope!: "ClusterPolicy" | "Policy";

  @ApiProperty({ description: "네임스페이스 (ClusterPolicy의 경우 null)", example: null, nullable: true })
  namespace!: string | null;

  @ApiProperty({ description: "동작 모드 (enforce | audit)", example: "enforce" })
  mode!: "enforce" | "audit";

  @ApiProperty({ description: "정책 유형 (validate | mutate | generate | verifyImages)", example: "validate" })
  type!: "validate" | "mutate" | "generate" | "verifyImages";

  @ApiProperty({ description: "규칙(Rules) 수", example: 1 })
  ruleCount!: number;

  @ApiProperty({ description: "규칙 이름 목록", example: ["disallow-latest-tag"] })
  rules!: string[];

  @ApiProperty({ description: "정책 활성 상태 (active | warning | draft)", example: "active" })
  status!: "active" | "warning" | "draft";

  @ApiProperty({ description: "정책 설명", example: "재현 가능한 배포를 위해 latest 이미지 태그 사용을 제한합니다." })
  description!: string;

  @ApiProperty({ description: "생성 일시", example: "2026-08-19T05:22:00.000Z" })
  createdAt!: string;
}
