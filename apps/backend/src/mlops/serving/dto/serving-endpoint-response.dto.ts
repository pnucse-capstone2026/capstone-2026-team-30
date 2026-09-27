import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * KServe InferenceService 서빙 엔드포인트 응답 DTO입니다.
 */
export class InferenceServiceResponseDto {
  @ApiProperty({ description: "서빙 엔드포인트 이름", example: "resnet50-v1" })
  name!: string;

  @ApiProperty({ description: "네임스페이스", example: "kserve-test" })
  namespace!: string;

  @ApiProperty({ description: "클러스터 ID", example: "default" })
  clusterId!: string;

  @ApiProperty({ description: "프레임워크 타겟", example: "pytorch" })
  framework!: string;

  @ApiProperty({
    description: "S3 모델 경로 URI",
    example: "s3://ml-models/resnet50/v1/model.pt",
  })
  storageUri!: string;

  @ApiProperty({ description: "서빙 상태", example: "Ready" })
  status!: "Ready" | "NotReady" | "Creating" | "Failed";

  @ApiPropertyOptional({
    description: "공개 HTTP Predict URL",
    example:
      "http://resnet50-v1.kserve-test.example.com/v1/models/resnet50-v1:predict",
  })
  url?: string;

  @ApiProperty({ description: "최소 복제본 수", example: 0 })
  minReplicas!: number;

  @ApiProperty({ description: "최대 복제본 수", example: 3 })
  maxReplicas!: number;

  @ApiProperty({ description: "Canary 트래픽 분할 비율 (%)", example: 20 })
  canaryTrafficPercent!: number;

  @ApiProperty({ description: "생성 일시", example: "2026-08-27T12:00:00Z" })
  createdAt!: string;
}

/**
 * 대화형 모델 API 예측 테스트 요청/응답 DTO입니다.
 */
export class PredictPayloadTestDto {
  @ApiProperty({
    description: "InferenceService 입력 텐서 파라미터 JSON",
    example: { instances: [[0.1, 0.2, 0.3, 0.4]] },
  })
  payload!: Record<string, unknown>;
}

export class PredictResultDto {
  @ApiProperty({ description: "예측 성공 여부", example: true })
  success!: boolean;

  @ApiProperty({
    description: "InferenceService 모델 응답 텐서 JSON",
    example: { predictions: [[0.85, 0.1, 0.05]] },
  })
  output!: Record<string, unknown>;

  @ApiProperty({ description: "응답 지연 시간 (ms)", example: 42 })
  latencyMs!: number;
}
