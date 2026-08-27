import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export enum ModelFramework {
  PYTORCH = "pytorch",
  ONNX = "onnx",
  TENSORFLOW = "tensorflow",
  SKLEARN = "sklearn",
}

/**
 * KServe InferenceService 모델 배포 요청 DTO입니다.
 */
export class DeployModelDto {
  @ApiProperty({
    description: "배포할 모델 엔드포인트 명칭 (KServe InferenceService 이름)",
    example: "resnet50-v1",
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: "모델 프레임워크 타겟 (pytorch, onnx, tensorflow, sklearn)",
    enum: ModelFramework,
    example: ModelFramework.PYTORCH,
  })
  @IsEnum(ModelFramework)
  @IsNotEmpty()
  framework!: ModelFramework;

  @ApiProperty({
    description: "S3 또는 MinIO 모델 바이너리 artifact 경로 URI",
    example: "s3://ml-models/resnet50/v1/model.pt",
  })
  @IsString()
  @IsNotEmpty()
  storageUri!: string;

  @ApiPropertyOptional({
    description: "최소 파드 복제본 수 (0 설정 시 Scale-to-Zero 지원)",
    example: 0,
    default: 1,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  minReplicas?: number = 1;

  @ApiPropertyOptional({
    description: "최대 파드 복제본 수",
    example: 5,
    default: 3,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxReplicas?: number = 3;

  @ApiPropertyOptional({
    description: "Canary 트래픽 할당 비율 (%)",
    example: 20,
    default: 100,
  })
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  canaryTrafficPercent?: number = 100;

  @ApiProperty({
    description: "배포 대상 클러스터 식별자",
    example: "default",
  })
  @IsString()
  @IsNotEmpty()
  clusterId!: string;

  @ApiProperty({
    description: "배포 대상 네임스페이스",
    example: "kserve-test",
  })
  @IsString()
  @IsNotEmpty()
  namespace!: string;
}
