import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PlatformModuleId,
  ModuleMetadataDto,
  SystemModulesResponseDto,
} from "./system.types";

/**
 * 플랫폼 모듈 활성화 상태 및 시스템 역량을 제공하는 서비스
 */
@Injectable()
export class SystemService {
  private readonly modules: Record<PlatformModuleId, ModuleMetadataDto>;

  /**
   * 환경 변수 설정을 기반으로 모듈별 메타데이터를 초기화합니다.
   *
   * @param configService 환경 변수 접근을 위한 ConfigService
   */
  constructor(private readonly configService: ConfigService) {
    const isModuleEnabled = (envVar: string, defaultVal = true): boolean => {
      const val = this.configService.get<string>(envVar);
      if (val === undefined || val === null || val === "") {
        return defaultVal;
      }
      return val.toLowerCase() !== "false";
    };

    this.modules = {
      core: {
        id: "core",
        name: "Core Governance",
        description:
          "Kyverno 정책 엔진, 위반 탐지, 예외 라이프사이클 및 다중 클러스터 관리",
        enabled: true,
        required: true,
      },
      mlops: {
        id: "mlops",
        name: "MLOps Platform",
        description:
          "Kubeflow 노트북, 파이프라인, KServe 모델 서빙 및 GPU FinOps 거버넌스",
        enabled: isModuleEnabled("MODULE_MLOPS_ENABLED"),
        required: false,
      },
      aiAgent: {
        id: "aiAgent",
        name: "AI Policy Assistant",
        description:
          "AWS Bedrock 기반 정책 분석, Enforce 차단 진단 및 예외 추천 코파일럿",
        enabled: isModuleEnabled("MODULE_AI_AGENT_ENABLED"),
        required: false,
      },
      simulation: {
        id: "simulation",
        name: "Policy Simulation Lab",
        description: "배포 전 정책 Dry-run 및 안전성 검증 샌드박스",
        enabled: isModuleEnabled("MODULE_SIMULATION_ENABLED"),
        required: false,
      },
      gitops: {
        id: "gitops",
        name: "GitOps Policy Sync",
        description: "GitHub PR 자동 동기화 및 양방향 정책 형상 관리",
        enabled: isModuleEnabled("MODULE_GITOPS_ENABLED"),
        required: false,
      },
    };
  }

  /**
   * 전체 플랫폼 모듈 메타데이터 목록을 반환합니다.
   *
   * @returns 모듈별 메타데이터 매핑 응답 객체
   */
  getModules(): SystemModulesResponseDto {
    return { modules: this.modules };
  }

  /**
   * 특정 모듈의 활성화 여부를 조회합니다.
   *
   * @param moduleId 확인할 모듈 식별자
   * @returns 모듈 활성화 여부
   */
  isModuleEnabled(moduleId: PlatformModuleId): boolean {
    return this.modules[moduleId]?.enabled ?? false;
  }
}
