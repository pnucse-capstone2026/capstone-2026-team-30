import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
} from "class-validator";

export enum WorkloadResourceType {
  NOTEBOOK = "NOTEBOOK",
  PIPELINE_RUN = "PIPELINE_RUN",
  KSERVE_SERVICE = "KSERVE_SERVICE",
}

/**
 * MLOps 워크로드 실패 진단 요청 DTO
 */
export class DiagnoseWorkloadRequestDto {
  @IsEnum(WorkloadResourceType)
  resourceType!: WorkloadResourceType;

  @IsString()
  @IsNotEmpty()
  resourceName!: string;

  @IsString()
  @IsNotEmpty()
  namespace!: string;

  @IsString()
  @IsOptional()
  podLogs?: string;

  @IsArray()
  @IsOptional()
  k8sEvents?: string[];
}

export interface RecommendedFix {
  title: string;
  description: string;
  actionType?: string;
  payload?: Record<string, unknown>;
}

/**
 * MLOps 워크로드 실패 진단 응답 DTO
 */
export class DiagnoseWorkloadResponseDto {
  rootCause!: string;
  summary!: string;
  detailedDiagnosis!: string;
  recommendedFixes!: RecommendedFix[];
  detectedErrorCode?: string;
  provider?: "BEDROCK" | "RULE_ENGINE_FALLBACK";
}
