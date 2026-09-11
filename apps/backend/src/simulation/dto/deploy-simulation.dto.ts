import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

/**
 * 시뮬레이션 배포 실행 요청 DTO
 */
export class DeploySimulationDto {
  /**
   * 사전 정의된 시나리오 식별자 (예: disallow-latest-tag, disallow-privileged 등)
   */
  @ApiPropertyOptional({
    description: "사전 정의된 시뮬레이션 시나리오 ID",
    example: "disallow-latest-tag",
  })
  @IsOptional()
  @IsString()
  scenarioId?: string;

  /**
   * 사용자가 직접 입력한 커스텀 Kubernetes YAML 매니페스트 (선택사항)
   */
  @ApiPropertyOptional({
    description: "사용자 커스텀 매니페스트 YAML 문자열",
    example: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: my-test-pod\n...",
  })
  @IsOptional()
  @IsString()
  customYaml?: string;

  /**
   * 배포 대상 네임스페이스 (기본값: governance-testbed)
   */
  @ApiPropertyOptional({
    description: "배포 대상 네임스페이스",
    default: "governance-testbed",
    example: "governance-testbed",
  })
  @IsOptional()
  @IsString()
  namespace?: string;

  /**
   * 대상 클러스터 ID (기본값: default)
   */
  @ApiPropertyOptional({
    description: "배포 대상 클러스터 ID",
    default: "default",
    example: "default",
  })
  @IsOptional()
  @IsString()
  clusterId?: string;
}

/**
 * 시뮬레이션 시나리오 정의 응답 DTO
 */
export interface SimulationScenario {
  id: string;
  title: string;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  targetPolicy: string;
  expectedResult: "BLOCKED" | "AUDIT_VIOLATION" | "PASSED";
  description: string;
  namespace: string;
  yaml: string;
}

/**
 * 시뮬레이션 실행 결과 응답 DTO
 */
export interface SimulationDeployResult {
  scenarioId?: string;
  status: "BLOCKED" | "ALLOWED";
  allowed: boolean;
  message: string;
  blockedReason?: string;
  policyName?: string;
  ruleName?: string;
  resourceKind?: string;
  resourceName?: string;
  namespace: string;
  timestamp: string;
  exceptionApplicable: boolean;
  suggestedException?: {
    policyName: string;
    ruleName?: string;
    resourceKind: string;
    resourceName: string;
    namespace: string;
  };
}
