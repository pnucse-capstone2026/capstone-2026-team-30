import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

/**
 * Kubeflow Notebook 신규 생성을 위한 요청 DTO 클래스입니다.
 */
export class CreateNotebookDto {
  @ApiProperty({
    description: "노트북 인스턴스 명칭 (DNS 호환 소문자/하이픈 식별자)",
    example: "analysis-workspace-01",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message:
      "name must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character",
  })
  name: string;

  @ApiPropertyOptional({
    description: "프로비저닝 대상 Kubernetes 네임스페이스",
    example: "default",
    default: "default",
  })
  @IsString()
  @IsOptional()
  namespace?: string = "default";

  @ApiProperty({
    description: "대상 Kubernetes 클러스터 ID",
    example: "cluster-us-east-1a",
  })
  @IsString()
  @IsNotEmpty()
  clusterId: string;

  @ApiProperty({
    description: "하드웨어 티어 프리셋 ID (e.g. CPU_SMALL, GPU_T4_STANDARD)",
    example: "CPU_MEDIUM",
  })
  @IsString()
  @IsNotEmpty()
  hardwareTier: string;

  @ApiProperty({
    description:
      "머신러닝 프레임워크/런타임 이미지 프리셋 ID (e.g. JUPYTER_PYTORCH, JUPYTER_TENSORFLOW, RSTUDIO)",
    example: "JUPYTER_PYTORCH",
  })
  @IsString()
  @IsNotEmpty()
  frameworkImage: string;

  @ApiPropertyOptional({
    description: "사용자 홈 디렉토리 영구 스토리지 용량 (GB 단위)",
    example: 20,
    default: 10,
  })
  @IsInt()
  @Min(5)
  @Max(500)
  @IsOptional()
  storageGb?: number = 10;
}
