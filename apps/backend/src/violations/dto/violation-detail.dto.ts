import { ApiProperty } from "@nestjs/swagger";
import { ViolationSummaryDto } from "./violation-summary.dto";

/**
 * Kyverno 정책 위반 상세 명세 DTO (AI 에이전트 연동 및 원본 결과 포함)
 */
export class ViolationDetailDto extends ViolationSummaryDto {
  @ApiProperty({ description: "권장 해결 방안 요약" })
  recommendation!: string;

  @ApiProperty({ description: "위반된 리소스 JSON 스펙" })
  resourceSpec!: Record<string, unknown>;

  @ApiProperty({ description: "PolicyReport 원본 result 객체" })
  rawResult!: Record<string, unknown>;

  @ApiProperty({
    description: "위반 처리 및 감사 이력 타임라인",
    example: [
      {
        label: "탐지됨",
        at: "2026-08-19T05:30:00.000Z",
        description: "정책 위반이 감지되었습니다.",
      },
    ],
    required: false,
  })
  events?: Array<{
    label: string;
    at: string;
    description: string;
  }>;
}
