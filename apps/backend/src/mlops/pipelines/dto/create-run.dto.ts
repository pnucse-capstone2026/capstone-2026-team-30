import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

/**
 * Kubeflow Pipelines (KFP) 파이프라인 트리거 실행 요청 DTO입니다.
 */
export class CreateRunDto {
  @ApiProperty({
    description: "실행할 파이프라인 템플릿 식별자",
    example: "pipe-resnet50-train",
  })
  @IsString()
  @IsNotEmpty()
  pipelineId!: string;

  @ApiProperty({
    description: "파이프라인 실행(Run) 인스턴스 이름",
    example: "resnet50-train-run-20260827",
  })
  @IsString()
  @IsNotEmpty()
  runName!: string;

  @ApiPropertyOptional({
    description: "파이프라인 단계별 입력 하이퍼파라미터 및 데이터셋 경로",
    example: {
      learning_rate: "0.001",
      batch_size: "32",
      dataset_uri: "s3://ml-datasets/cifar10",
    },
  })
  @IsObject()
  @IsOptional()
  parameters?: Record<string, unknown>;

  @ApiProperty({
    description: "실행 대상 K8s 클러스터 식별자",
    example: "default",
  })
  @IsString()
  @IsNotEmpty()
  clusterId!: string;

  @ApiProperty({
    description: "실행 대상 K8s 네임스페이스",
    example: "kubeflow",
  })
  @IsString()
  @IsNotEmpty()
  namespace!: string;
}
