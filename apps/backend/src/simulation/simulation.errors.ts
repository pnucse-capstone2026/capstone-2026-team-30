import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const SIMULATION_ERROR = {
  INVALID_YAML: {
    code: "SIMULATION_INVALID_YAML",
    message: "유효하지 않은 YAML 형식입니다.",
  },
  SCENARIO_NOT_FOUND: {
    code: "SIMULATION_SCENARIO_NOT_FOUND",
    message: "지정된 시뮬레이션 시나리오를 찾을 수 없습니다.",
  },
  DEPLOYMENT_FAILED: {
    code: "SIMULATION_DEPLOYMENT_FAILED",
    message: "시뮬레이션 리소스 배포 중 오류가 발생했습니다.",
  },
  CLEANUP_FAILED: {
    code: "SIMULATION_CLEANUP_FAILED",
    message: "시뮬레이션 리소스 정리 중 오류가 발생했습니다.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
