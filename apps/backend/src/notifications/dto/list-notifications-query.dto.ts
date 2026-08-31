import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";

/**
 * 알림 목록 조회 쿼리 파라미터 DTO
 */
export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    description:
      "알림 유형 필터 (exception, violation, cluster, audit, policy)",
    example: "exception",
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: "중요도 필터 (info, warning, critical, success)",
    example: "warning",
  })
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiPropertyOptional({
    description: "읽음 여부 필터 (true: 읽음, false: 미읽음)",
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  read?: boolean;

  @ApiPropertyOptional({
    description: "제목 및 내용 검색 키워드",
    example: "예외",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
