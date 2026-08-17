import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";

export enum ViolationSeverityFilter {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

export enum ViolationStatusFilter {
  OPEN = "open",
  IN_REVIEW = "inReview",
  RESOLVED = "resolved",
}

/**
 * Kyverno 정책 위반 내역 조회 쿼리 DTO
 */
export class ListViolationsQueryDto {
  @ApiPropertyOptional({ description: "특정 클러스터 식별자 필터링" })
  @IsOptional()
  @IsString()
  clusterId?: string;

  @ApiPropertyOptional({ description: "특정 네임스페이스 필터링" })
  @IsOptional()
  @IsString()
  namespace?: string;

  @ApiPropertyOptional({ description: "특정 정책 이름 필터링" })
  @IsOptional()
  @IsString()
  policyName?: string;

  @ApiPropertyOptional({ enum: ViolationSeverityFilter, description: "위반 심각도 필터링" })
  @IsOptional()
  @IsEnum(ViolationSeverityFilter)
  severity?: ViolationSeverityFilter;

  @ApiPropertyOptional({ enum: ViolationStatusFilter, description: "처리 상태 필터링" })
  @IsOptional()
  @IsEnum(ViolationStatusFilter)
  status?: ViolationStatusFilter;

  @ApiPropertyOptional({ description: "정책명, 리소스명, 에러 메시지 검색어" })
  @IsOptional()
  @IsString()
  search?: string;
}
