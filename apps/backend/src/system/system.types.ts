import { ApiProperty } from "@nestjs/swagger";

/**
 * 플랫폼 모듈 식별자 타입
 */
export type PlatformModuleId =
  | "core"
  | "mlops"
  | "aiAgent"
  | "simulation"
  | "gitops";

/**
 * 개별 플랫폼 모듈 메타데이터 DTO
 */
export class ModuleMetadataDto {
  @ApiProperty({
    description: "모듈 고유 식별자",
    example: "mlops",
  })
  id!: PlatformModuleId;

  @ApiProperty({
    description: "모듈 표시 이름",
    example: "MLOps Platform",
  })
  name!: string;

  @ApiProperty({
    description: "모듈 상세 설명",
    example: "Kubeflow 노트북, 파이프라인, 서빙 및 GPU FinOps 관리 기능",
  })
  description!: string;

  @ApiProperty({
    description: "모듈 활성화 여부",
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: "플랫폼 필수 모듈 여부 (비활성화 불가 여부)",
    example: false,
  })
  required!: boolean;
}

/**
 * 플랫폼 모듈 목록 조회 응답 DTO
 */
export class SystemModulesResponseDto {
  @ApiProperty({
    description: "플랫폼 모듈별 메타데이터 매핑 객체",
    type: Object,
  })
  modules!: Record<PlatformModuleId, ModuleMetadataDto>;
}
