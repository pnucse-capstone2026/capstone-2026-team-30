import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class NotebookListQueryDto {
  @ApiPropertyOptional({
    description: "조회 대상 Kubernetes 클러스터 ID",
    example: "cluster-us-east-1a",
  })
  @IsString()
  @IsNotEmpty()
  clusterId: string;

  @ApiPropertyOptional({
    description: "조회 대상 네임스페이스 (기본값: 'default')",
    example: "default",
    default: "default",
  })
  @IsString()
  @IsOptional()
  namespace?: string = "default";
}
