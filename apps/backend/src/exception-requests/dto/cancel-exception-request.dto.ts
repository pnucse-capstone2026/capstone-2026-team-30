import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class CancelExceptionRequestDto {
  @ApiPropertyOptional({
    description: "취소 또는 회수 사유",
    example: "보안 패치 완료 또는 긴급 사유로 인한 배포된 예외 회수",
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
