import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * 파이프라인 템플릿 정보 응답 DTO입니다.
 */
export class PipelineTemplateDto {
  @ApiProperty({
    description: "파이프라인 식별자",
    example: "pipe-resnet50-train",
  })
  id!: string;

  @ApiProperty({
    description: "파이프라인 명칭",
    example: "ResNet-50 Image Classification Pipeline",
  })
  name!: string;

  @ApiProperty({
    description: "파이프라인 설명",
    example: "End-to-end model training pipeline",
  })
  description!: string;

  @ApiProperty({ description: "등록 일시", example: "2026-08-01T00:00:00Z" })
  createdAt!: string;

  @ApiProperty({
    description: "기본 정의된 파라미터 규격",
    example: [
      {
        name: "learning_rate",
        defaultValue: "0.001",
        description: "Learning rate",
      },
    ],
  })
  parameters!: Array<{
    name: string;
    defaultValue?: string;
    description?: string;
  }>;
}

/**
 * 파이프라인 단일 노드/단계(DAG Node) 실행 상태 DTO입니다.
 */
export class PipelineDagNodeDto {
  @ApiProperty({ description: "노드/스텝 식별자", example: "train-model-step" })
  id!: string;

  @ApiProperty({
    description: "노드 Display Name",
    example: "Train ResNet50 Model",
  })
  displayName!: string;

  @ApiProperty({ description: "실행 상태", example: "Succeeded" })
  status!: "Pending" | "Running" | "Succeeded" | "Failed" | "Skipped";

  @ApiPropertyOptional({
    description: "해당 스텝의 Pod 이름",
    example: "resnet50-run-pod-1a2b3",
  })
  podName?: string;

  @ApiPropertyOptional({ description: "컨테이너 이름", example: "main" })
  containerName?: string;

  @ApiPropertyOptional({
    description: "시작 일시",
    example: "2026-08-27T10:00:00Z",
  })
  startedAt?: string;

  @ApiPropertyOptional({
    description: "종료 일시",
    example: "2026-08-27T10:15:00Z",
  })
  finishedAt?: string;
}

/**
 * 파이프라인 실행(Run) 인스턴스 정보 응답 DTO입니다.
 */
export class PipelineRunDto {
  @ApiProperty({ description: "실행 인스턴스 ID", example: "run-98765432" })
  id!: string;

  @ApiProperty({ description: "파이프라인 ID", example: "pipe-resnet50-train" })
  pipelineId!: string;

  @ApiProperty({
    description: "실행 인스턴스 이름",
    example: "resnet50-train-run-20260827",
  })
  name!: string;

  @ApiProperty({ description: "전체 파이프라인 상태", example: "Running" })
  status!: "Pending" | "Running" | "Succeeded" | "Failed" | "Terminated";

  @ApiProperty({ description: "실행 대상 클러스터 ID", example: "default" })
  clusterId!: string;

  @ApiProperty({ description: "실행 대상 네임스페이스", example: "kubeflow" })
  namespace!: string;

  @ApiProperty({ description: "시작 일시", example: "2026-08-27T10:00:00Z" })
  createdAt!: string;

  @ApiPropertyOptional({
    description: "종료 일시",
    example: "2026-08-27T10:20:00Z",
  })
  finishedAt?: string;

  @ApiPropertyOptional({
    description: "전달된 파라미터",
    example: { learning_rate: "0.001" },
  })
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "DAG 단계별 상태 목록",
    type: [PipelineDagNodeDto],
  })
  nodes?: PipelineDagNodeDto[];
}
