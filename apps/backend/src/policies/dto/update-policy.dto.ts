import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsObject, IsOptional, IsString } from "class-validator";

/**
 * Kyverno 정책 수정을 위한 요청 DTO
 */
export class UpdatePolicyDto {
  @ApiPropertyOptional({
    description: "정책 동작 모드 (enforce | audit)",
    enum: ["enforce", "audit"],
    example: "enforce",
  })
  @IsOptional()
  @IsEnum(["enforce", "audit"], {
    message: "동작 모드는 enforce 또는 audit여야 합니다.",
  })
  mode?: "enforce" | "audit";

  @ApiPropertyOptional({
    description: "정책 설명 및 도입 목적",
    example: "운영 워크로드에 리소스 제한 강제 및 감사",
  })
  @IsOptional()
  @IsString({ message: "정책 설명은 문자열이어야 합니다." })
  description?: string;

  @ApiPropertyOptional({
    description: "정책이 적용될 네임스페이스 (Policy 스코프인 경우)",
    example: "default",
  })
  @IsOptional()
  @IsString({ message: "네임스페이스는 문자열이어야 합니다." })
  namespace?: string;

  @ApiPropertyOptional({
    description: "사용자가 수정한 원본 YAML 매니페스트 (선택)",
  })
  @IsOptional()
  @IsString()
  rawYaml?: string;

  @ApiPropertyOptional({
    description: "JSON 형태의 전체 매니페스트 객체 (선택)",
  })
  @IsOptional()
  @IsObject()
  manifest?: Record<string, unknown>;
}
