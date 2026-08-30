import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

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

  @ApiPropertyOptional({ description: "특정 규칙 이름 필터링" })
  @IsOptional()
  @IsString()
  ruleName?: string;

  @ApiPropertyOptional({
    description: "특정 리소스 종류 필터링 (Pod, Deployment 등)",
  })
  @IsOptional()
  @IsString()
  resourceKind?: string;

  @ApiPropertyOptional({
    enum: ViolationSeverityFilter,
    description: "위반 심각도 필터링",
  })
  @IsOptional()
  @IsEnum(ViolationSeverityFilter)
  severity?: ViolationSeverityFilter;

  @ApiPropertyOptional({
    enum: ViolationStatusFilter,
    description: "처리 상태 필터링",
  })
  @IsOptional()
  @IsEnum(ViolationStatusFilter)
  status?: ViolationStatusFilter;

  @ApiPropertyOptional({
    description: "예외 신청 상태 필터링 (none, requested, approved)",
  })
  @IsOptional()
  @IsString()
  exceptionStatus?: string;

  @ApiPropertyOptional({ description: "조회 시작 일시 (ISO8601 문맥)" })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: "조회 종료 일시 (ISO8601 문맥)" })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: "정책명, 리소스명, 에러 메시지 검색어" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "페이지 번호 (기본값: 1)", default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: "페이지 당 항목 수 (기본값: 50)",
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: "정렬 기준 필드 (detectedAt, severity, policyName 등)",
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: "정렬 방향 (asc 또는 desc)",
    default: "desc",
  })
  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc";
}
