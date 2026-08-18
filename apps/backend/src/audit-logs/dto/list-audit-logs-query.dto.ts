import { ApiPropertyOptional } from "@nestjs/swagger";
import { AuditActorType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/**
 * 감사 로그 목록 페이징 및 필터링 쿼리 DTO
 */
export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ description: "페이지 번호 (1부터 시작)", default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: "페이지당 항목 수", default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: "감사 작업 유형 (예: EXCEPTION_REQUEST_CREATED, USER_CLUSTERS_UPDATED)" })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: "대상 엔티티 종류 (예: EXCEPTION_REQUEST, USER)" })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ description: "대상 엔티티 식별자" })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({ enum: AuditActorType, description: "행위자 유형 (USER | SYSTEM)" })
  @IsOptional()
  @IsEnum(AuditActorType)
  actorType?: AuditActorType;

  @ApiPropertyOptional({ description: "특정 사용자 식별자" })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: "조회 시작 일시 (ISO-8601 문자열)", example: "2026-08-01T00:00:00Z" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: "조회 종료 일시 (ISO-8601 문자열)", example: "2026-08-31T23:59:59Z" })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: "액션명 또는 엔티티 식별자 검색어" })
  @IsOptional()
  @IsString()
  search?: string;
}
