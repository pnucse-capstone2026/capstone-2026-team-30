import { ApiPropertyOptional } from "@nestjs/swagger";
import { IncidentStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/**
 * 배포 차단 인시던트 목록 조회 쿼리 파라미터 DTO
 */
export class ListIncidentsQueryDto {
  @ApiPropertyOptional({
    description: "조회 대상 클러스터 식별자",
    example: "production-us-east-1",
  })
  @IsOptional()
  @IsString()
  clusterId?: string;

  @ApiPropertyOptional({
    description: "특정 네임스페이스 필터링",
    example: "mlops-serving",
  })
  @IsOptional()
  @IsString()
  namespace?: string;

  @ApiPropertyOptional({
    enum: IncidentStatus,
    description: "인시던트 처리 상태 필터링",
    example: IncidentStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @ApiPropertyOptional({
    description: "GitOps 애플리케이션 이름 필터링 (ArgoCD, Flux 등)",
    example: "production-recommender",
  })
  @IsOptional()
  @IsString()
  gitopsAppName?: string;

  @ApiPropertyOptional({
    description: "차단 정책 이름 필터링",
    example: "disallow-privileged-containers",
  })
  @IsOptional()
  @IsString()
  policyName?: string;

  @ApiPropertyOptional({
    description: "페이지 번호 (1부터 시작)",
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "페이지당 노출 항목 수",
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
