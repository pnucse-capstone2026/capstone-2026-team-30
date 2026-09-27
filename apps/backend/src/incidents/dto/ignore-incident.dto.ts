import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 인시던트 수동 무시(IGNORED) 처리 요청 DTO
 */
export class IgnoreIncidentDto {
  @ApiPropertyOptional({
    description: "인시던트를 무시 처리하는 사유 또는 비고",
    example:
      "일시적인 스테이징 테스트 매니페스트 변경으로 인한 차단이므로 무시 처리함.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
