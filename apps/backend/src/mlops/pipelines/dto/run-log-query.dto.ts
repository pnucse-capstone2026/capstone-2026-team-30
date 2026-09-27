import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";

/**
 * 파이프라인 단계별 Pod 컨테이너 로그 조회 쿼리 DTO입니다.
 */
export class RunLogQueryDto {
  @ApiProperty({
    description: "조회할 Pod 이름",
    example: "resnet50-run-pod-1a2b3",
  })
  @IsString()
  @IsNotEmpty()
  podName!: string;

  @ApiPropertyOptional({ description: "조회할 컨테이너 이름", example: "main" })
  @IsString()
  @IsOptional()
  containerName?: string;

  @ApiPropertyOptional({
    description: "출력할 마지막 라인 수",
    example: 500,
    default: 200,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  tailLines?: number = 200;
}
