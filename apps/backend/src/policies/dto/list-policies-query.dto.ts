import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";

export enum PolicyTypeFilter {
  VALIDATE = "validate",
  MUTATE = "mutate",
  GENERATE = "generate",
  VERIFY_IMAGES = "verifyImages",
}

export enum PolicyModeFilter {
  ENFORCE = "enforce",
  AUDIT = "audit",
}

export enum PolicyScopeFilter {
  CLUSTER = "ClusterPolicy",
  NAMESPACED = "Policy",
}

/**
 * Kyverno 정책 목록 조회 쿼리 파라미터 DTO
 */
export class ListPoliciesQueryDto {
  @ApiPropertyOptional({ description: "특정 클러스터 식별자로 필터링" })
  @IsOptional()
  @IsString()
  clusterId?: string;

  @ApiPropertyOptional({
    description: "특정 네임스페이스로 필터링 (Namespaced Policy인 경우)",
  })
  @IsOptional()
  @IsString()
  namespace?: string;

  @ApiPropertyOptional({
    enum: PolicyTypeFilter,
    description: "정책 유형 필터링",
  })
  @IsOptional()
  @IsEnum(PolicyTypeFilter)
  type?: PolicyTypeFilter;

  @ApiPropertyOptional({
    enum: PolicyModeFilter,
    description: "동작 모드 필터링 (enforce | audit)",
  })
  @IsOptional()
  @IsEnum(PolicyModeFilter)
  mode?: PolicyModeFilter;

  @ApiPropertyOptional({
    enum: PolicyScopeFilter,
    description: "정책 스코프 필터링 (ClusterPolicy | Policy)",
  })
  @IsOptional()
  @IsEnum(PolicyScopeFilter)
  scope?: PolicyScopeFilter;

  @ApiPropertyOptional({ description: "정책 이름 또는 설명 검색어" })
  @IsOptional()
  @IsString()
  search?: string;
}
