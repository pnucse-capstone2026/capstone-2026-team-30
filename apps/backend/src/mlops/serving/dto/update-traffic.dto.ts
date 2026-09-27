import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

/**
 * Canary 배포 트래픽 비율 업데이트 요청 DTO입니다.
 */
export class UpdateTrafficSplitDto {
  @ApiProperty({
    description: "Canary 버전 트래픽 제어 비율 (0 ~ 100%)",
    example: 30,
  })
  @IsInt()
  @Min(0)
  @Max(100)
  canaryTrafficPercent!: number;
}
