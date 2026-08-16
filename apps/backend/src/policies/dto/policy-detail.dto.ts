import { ApiProperty } from "@nestjs/swagger";
import { PolicySummaryDto } from "./policy-summary.dto";

/**
 * Kyverno 정책 상세 명세 DTO
 */
export class PolicyDetailDto extends PolicySummaryDto {
  @ApiProperty({ description: "정책 spec 객체" })
  spec!: Record<string, unknown>;

  @ApiProperty({ description: "자동 생성된 워크로드 autogen 규칙 목록", example: ["autogen-disallow-latest-tag"] })
  autogenRules!: string[];

  @ApiProperty({ description: "정책의 전체 원본 YAML / JSON 문자열" })
  rawJson!: Record<string, unknown>;
}
