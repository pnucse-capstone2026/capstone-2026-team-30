import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";

/**
 * 정책 위반 처리 상태 변경 요청 DTO
 */
export class UpdateViolationStatusDto {
  @ApiProperty({
    description: "변경할 정책 위반 처리 상태",
    enum: ["open", "inReview", "resolved"],
    example: "inReview",
  })
  @IsEnum(["open", "inReview", "resolved"])
  status!: "open" | "inReview" | "resolved";

  @ApiPropertyOptional({
    description: "상태 변경 사유 또는 관리자 메모",
    example: "해당 보안 취약점 조치 계획 검토 완료",
  })
  @IsString()
  @IsOptional()
  note?: string;
}
