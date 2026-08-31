import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";

/**
 * Kyverno 정책 신규 생성을 위한 요청 DTO
 */
export class CreatePolicyDto {
  @ApiProperty({
    description: "정책 이름 (Kubernetes DNS-1123 규격)",
    example: "require-resource-limits",
  })
  @IsNotEmpty({ message: "정책 이름은 필수 항목입니다." })
  @IsString({ message: "정책 이름은 문자열이어야 합니다." })
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message: "정책 이름은 소문자, 숫자, 하이픈(-)만 포함할 수 있습니다.",
  })
  name!: string;

  @ApiProperty({
    description: "정책을 배포할 대상 클러스터 식별자",
    example: "kyverno-eks-hub",
  })
  @IsNotEmpty({ message: "클러스터 식별자는 필수 항목입니다." })
  @IsString({ message: "클러스터 식별자는 문자열이어야 합니다." })
  clusterId!: string;

  @ApiProperty({
    description: "정책 스코프 (ClusterPolicy | Policy)",
    enum: ["ClusterPolicy", "Policy"],
    example: "ClusterPolicy",
  })
  @IsEnum(["ClusterPolicy", "Policy"], {
    message: "정책 범위는 ClusterPolicy 또는 Policy여야 합니다.",
  })
  scope!: "ClusterPolicy" | "Policy";

  @ApiPropertyOptional({
    description: "정책이 적용될 네임스페이스 (Policy 스코프인 경우 필수)",
    example: "default",
  })
  @IsOptional()
  @IsString({ message: "네임스페이스는 문자열이어야 합니다." })
  namespace?: string;

  @ApiProperty({
    description: "정책 유형 (validate | mutate | generate | verifyImages)",
    enum: ["validate", "mutate", "generate", "verifyImages"],
    example: "validate",
  })
  @IsEnum(["validate", "mutate", "generate", "verifyImages"], {
    message: "올바른 정책 유형을 선택해야 합니다.",
  })
  type!: "validate" | "mutate" | "generate" | "verifyImages";

  @ApiProperty({
    description: "동작 모드 (enforce | audit)",
    enum: ["enforce", "audit"],
    example: "audit",
  })
  @IsEnum(["enforce", "audit"], {
    message: "동작 모드는 enforce 또는 audit여야 합니다.",
  })
  mode!: "enforce" | "audit";

  @ApiPropertyOptional({
    description: "정책 설명 및 도입 목적",
    example: "운영 워크로드에 CPU와 memory requests/limits 설정을 강제합니다.",
  })
  @IsOptional()
  @IsString({ message: "정책 설명은 문자열이어야 합니다." })
  description?: string;

  @ApiProperty({
    description: "정책 규칙(Rule) 이름",
    example: "validate-resource-limits",
  })
  @IsNotEmpty({ message: "규칙 이름은 필수 항목입니다." })
  @IsString({ message: "규칙 이름은 문자열이어야 합니다." })
  ruleName!: string;

  @ApiProperty({
    description: "정책 검사 대상 리소스 종류 (쉼표 구분 또는 단일 리소스)",
    example: "Pod, Deployment",
  })
  @IsNotEmpty({ message: "적용 리소스 종류는 필수 항목입니다." })
  @IsString({ message: "적용 리소스 종류는 문자열이어야 합니다." })
  matchKinds!: string;

  @ApiPropertyOptional({
    description: "정책 위반 시 노출할 사용자 안내 메시지",
    example: "CPU 및 Memory resource limits 설정이 필요합니다.",
  })
  @IsOptional()
  @IsString({ message: "위반 메시지는 문자열이어야 합니다." })
  message?: string;

  @ApiPropertyOptional({
    description: "사용자가 직접 입력한 원본 YAML 매니페스트 (선택)",
  })
  @IsOptional()
  @IsString()
  rawYaml?: string;
}
