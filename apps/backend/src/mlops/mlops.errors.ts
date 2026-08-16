import type { BusinessErrorDefinition } from "../common/errors/business-error";

/**
 * MLOps 도메인 비즈니스 에러 카탈로그 정의.
 * Kubeflow Notebook 생명주기 및 리소스 할당 예외를 상수로 정의합니다.
 */
export const MLOPS_ERROR = {
  NOTEBOOK_NOT_FOUND: {
    code: "MLOPS_NOTEBOOK_NOT_FOUND",
    message: "Target Kubeflow Notebook instance was not found.",
  },
  NOTEBOOK_ALREADY_EXISTS: {
    code: "MLOPS_NOTEBOOK_ALREADY_EXISTS",
    message:
      "A Notebook instance with the same name already exists in this namespace.",
  },
  GPU_QUOTA_EXCEEDED: {
    code: "MLOPS_GPU_QUOTA_EXCEEDED",
    message:
      "Requested GPU resources exceed the allowed quota for your cluster.",
  },
  CLUSTER_ACCESS_DENIED: {
    code: "MLOPS_CLUSTER_ACCESS_DENIED",
    message:
      "User does not have access to the specified cluster for MLOps resources.",
  },
  INVALID_PRESET: {
    code: "MLOPS_INVALID_PRESET",
    message: "Specified hardware tier or framework image preset is invalid.",
  },
  NOTEBOOK_CREATION_FAILED: {
    code: "MLOPS_NOTEBOOK_CREATION_FAILED",
    message:
      "Failed to create Kubeflow Notebook resource in Kubernetes API server.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
